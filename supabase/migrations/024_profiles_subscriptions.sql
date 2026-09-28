-- Page and author subscriptions. Page keys are the exact canonical keys stored
-- in notes.page_url; AT Protocol post keys are deliberately unsupported for
-- page subscriptions. Author subscriptions still match notes on those keys.

CREATE TABLE subscriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  subscriber_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  page_key TEXT,
  target_user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT now() NOT NULL,
  CONSTRAINT subscriptions_shape_check CHECK (
    (
      kind = 'page'
      AND page_key IS NOT NULL
      AND length(page_key) <= 2000
      AND page_key NOT LIKE 'at://%'
      AND target_user_id IS NULL
    ) OR (
      kind = 'user'
      AND page_key IS NULL
      AND target_user_id IS NOT NULL
      AND subscriber_id <> target_user_id
    )
  )
);

CREATE UNIQUE INDEX uq_subscriptions_page
  ON subscriptions(subscriber_id, page_key)
  WHERE kind = 'page';

CREATE UNIQUE INDEX uq_subscriptions_user
  ON subscriptions(subscriber_id, target_user_id)
  WHERE kind = 'user';

CREATE INDEX idx_subscriptions_page_target
  ON subscriptions(page_key)
  WHERE kind = 'page';

CREATE INDEX idx_subscriptions_user_target
  ON subscriptions(target_user_id)
  WHERE kind = 'user';

-- Keep an authenticated account from growing this globally stored table
-- without bound. The lock makes the count + insert safe under concurrent
-- requests, while the duplicate check preserves idempotent subscribe calls at
-- the limit (the unique indexes still reject the duplicate insert).
CREATE OR REPLACE FUNCTION private.enforce_subscription_limit()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_subscription_count INTEGER;
BEGIN
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtext(NEW.subscriber_id::TEXT),
    pg_catalog.hashtext('subscription')
  );

  IF EXISTS (
    SELECT 1
    FROM public.subscriptions
    WHERE subscriber_id = NEW.subscriber_id
      AND (
        (NEW.kind = 'page' AND kind = 'page' AND page_key = NEW.page_key)
        OR (
          NEW.kind = 'user'
          AND kind = 'user'
          AND target_user_id = NEW.target_user_id
        )
      )
  ) THEN
    RETURN NEW;
  END IF;

  SELECT COUNT(*) INTO v_subscription_count
  FROM public.subscriptions
  WHERE subscriber_id = NEW.subscriber_id;

  IF v_subscription_count >= 500 THEN
    RAISE EXCEPTION 'Subscription limit reached'
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION private.enforce_subscription_limit() FROM PUBLIC;

CREATE TRIGGER trg_enforce_subscription_limit
  BEFORE INSERT ON subscriptions
  FOR EACH ROW
  EXECUTE FUNCTION private.enforce_subscription_limit();

ALTER TABLE subscriptions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Subscribers read own subscriptions"
  ON subscriptions FOR SELECT
  USING (auth.jwt()->>'sub' = subscriber_id::text);

CREATE POLICY "Subscribers create own subscriptions"
  ON subscriptions FOR INSERT
  WITH CHECK (auth.jwt()->>'sub' = subscriber_id::text);

CREATE POLICY "Subscribers delete own subscriptions"
  ON subscriptions FOR DELETE
  USING (auth.jwt()->>'sub' = subscriber_id::text);

GRANT SELECT, INSERT, DELETE ON TABLE subscriptions TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE subscriptions TO service_role;

-- Subscription notifications reuse the existing unread-row lifecycle.
ALTER TABLE notifications
  DROP CONSTRAINT IF EXISTS notifications_type_shape_check;

ALTER TABLE notifications
  ADD CONSTRAINT notifications_type_shape_check
  CHECK (
    type IN ('comment', 'mention', 'subscription')
    AND (type <> 'comment' OR comment_id IS NOT NULL)
    AND (type <> 'subscription' OR comment_id IS NULL)
  );

-- A page and author subscription may both match the same note. They represent
-- one new-note event, so keep one unread row per recipient and note.
CREATE UNIQUE INDEX uq_notifications_subscription
  ON notifications(recipient_id, note_id)
  WHERE type = 'subscription';

CREATE OR REPLACE FUNCTION fn_create_subscription_notifications()
RETURNS TRIGGER
SECURITY DEFINER
SET search_path = public
LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO notifications (recipient_id, note_id, comment_id, actor_id, type)
  SELECT DISTINCT
    subscriptions.subscriber_id::text,
    NEW.id,
    NULL::UUID,
    NEW.author_id,
    'subscription'
  FROM subscriptions
  WHERE subscriptions.subscriber_id::text <> NEW.author_id
    AND (
      (subscriptions.kind = 'page' AND subscriptions.page_key = NEW.page_url)
      OR
      (
        subscriptions.kind = 'user'
        AND subscriptions.target_user_id::text = NEW.author_id
      )
    )
  ON CONFLICT (recipient_id, note_id)
    WHERE type = 'subscription'
    DO NOTHING;

  RETURN NEW;
END $$;

CREATE TRIGGER trg_note_insert_notify_subscribers
  AFTER INSERT ON notes
  FOR EACH ROW
  EXECUTE FUNCTION fn_create_subscription_notifications();
