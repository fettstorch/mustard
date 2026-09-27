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
    NULL,
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
