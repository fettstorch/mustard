-- Rolling per-account write limits for user-authored content.
--
-- Limits (per Mustard account UUID, both windows must be respected):
--   notes:    20 per rolling minute / 100 per rolling 24 hours
--   comments: 50 per rolling minute / 500 per rolling 24 hours
--
-- Reposts are intentionally unlimited. Their unique (note_id, reposter_id)
-- constraint already makes repeated reposts idempotent.

CREATE SCHEMA IF NOT EXISTS private;

-- Kept outside exposed API schemas. The user FK also removes rate-limit state
-- when delete_account removes the corresponding users row.
CREATE TABLE private.write_events (
  account_id UUID        NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  action     TEXT        NOT NULL CHECK (action IN ('note', 'comment')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX write_events_lookup
  ON private.write_events (account_id, action, created_at DESC);

-- CHECK constraints cannot contain aggregate subqueries directly. This helper
-- is immutable because its result depends only on the supplied array. If its
-- behavior changes, drop and re-add the constraints that reference it.
CREATE OR REPLACE FUNCTION private.text_array_is_unique(p_values TEXT[])
RETURNS BOOLEAN
LANGUAGE SQL
IMMUTABLE
PARALLEL SAFE
STRICT
SET search_path = ''
AS $$
  SELECT pg_catalog.cardinality(p_values) = pg_catalog.count(DISTINCT element)
  FROM pg_catalog.unnest(p_values) AS element;
$$;

CREATE OR REPLACE FUNCTION private.check_write_rate_limit(
  p_account_id UUID,
  p_action     TEXT
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_count_minute INT;
  v_count_day    INT;
  v_limit_minute INT;
  v_limit_day    INT;
BEGIN
  CASE p_action
    WHEN 'note' THEN
      v_limit_minute := 20;
      v_limit_day := 100;
    WHEN 'comment' THEN
      v_limit_minute := 50;
      v_limit_day := 500;
    ELSE
      RAISE EXCEPTION 'Unknown rate-limited action: %', p_action
        USING ERRCODE = '22023';
  END CASE;

  -- Serialize count + insert for this account/action pair so concurrent
  -- requests cannot race past the limit.
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtext(p_account_id::TEXT),
    pg_catalog.hashtext(p_action)
  );

  -- No cron dependency: active accounts prune their own expired events. An
  -- inactive account retains at most one daily allowance per action, and its
  -- rows cascade away when the account is deleted.
  DELETE FROM private.write_events
  WHERE account_id = p_account_id
    AND action = p_action
    AND created_at < pg_catalog.now() - INTERVAL '24 hours';

  SELECT COUNT(*) INTO v_count_minute
  FROM private.write_events
  WHERE account_id = p_account_id
    AND action = p_action
    AND created_at >= pg_catalog.now() - INTERVAL '1 minute';

  IF v_count_minute >= v_limit_minute THEN
    RAISE SQLSTATE 'PGRST' USING
      message = pg_catalog.json_build_object(
        'code', 'MUSTARD_RATE_LIMIT',
        'message', 'Rate limit reached. Please wait a moment and try again.'
      )::TEXT,
      detail = pg_catalog.json_build_object(
        'status', 429,
        'headers', pg_catalog.json_build_object(),
        'status_text', 'Too Many Requests'
      )::TEXT;
  END IF;

  SELECT COUNT(*) INTO v_count_day
  FROM private.write_events
  WHERE account_id = p_account_id
    AND action = p_action;

  IF v_count_day >= v_limit_day THEN
    RAISE SQLSTATE 'PGRST' USING
      message = pg_catalog.json_build_object(
        'code', 'MUSTARD_RATE_LIMIT',
        'message', 'Daily limit reached. Please try again later.'
      )::TEXT,
      detail = pg_catalog.json_build_object(
        'status', 429,
        'headers', pg_catalog.json_build_object(),
        'status_text', 'Too Many Requests'
      )::TEXT;
  END IF;

  INSERT INTO private.write_events (account_id, action)
  VALUES (p_account_id, p_action);
END;
$$;

-- Trigger functions stay in the non-exposed private schema. Trigger invocation
-- does not require clients to call or discover these functions through RPC.
CREATE OR REPLACE FUNCTION private.rate_limit_note_insert()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  jwt_role TEXT;
BEGIN
  jwt_role := NULLIF(
    pg_catalog.current_setting('request.jwt.claims', true),
    ''
  )::JSONB->>'role';

  IF COALESCE(jwt_role, '') = 'authenticated' THEN
    PERFORM private.check_write_rate_limit(NEW.author_id::UUID, 'note');
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION private.rate_limit_comment_insert()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  jwt_role TEXT;
BEGIN
  jwt_role := NULLIF(
    pg_catalog.current_setting('request.jwt.claims', true),
    ''
  )::JSONB->>'role';

  IF COALESCE(jwt_role, '') = 'authenticated' THEN
    PERFORM private.check_write_rate_limit(NEW.author_id::UUID, 'comment');
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION private.check_write_rate_limit(UUID, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION private.rate_limit_note_insert() FROM PUBLIC;
REVOKE ALL ON FUNCTION private.rate_limit_comment_insert() FROM PUBLIC;

CREATE TRIGGER trg_rate_limit_note_insert
  BEFORE INSERT ON public.notes
  FOR EACH ROW
  EXECUTE FUNCTION private.rate_limit_note_insert();

CREATE TRIGGER trg_rate_limit_comment_insert
  BEFORE INSERT ON public.comments
  FOR EACH ROW
  EXECUTE FUNCTION private.rate_limit_comment_insert();

ALTER TABLE public.notes
  ADD CONSTRAINT notes_mentions_max_5
  CHECK (pg_catalog.cardinality(mentions) <= 5) NOT VALID,
  ADD CONSTRAINT notes_mentions_unique
  CHECK (private.text_array_is_unique(mentions)) NOT VALID;

ALTER TABLE public.comments
  ADD CONSTRAINT comments_mentions_max_5
  CHECK (pg_catalog.cardinality(mentions) <= 5) NOT VALID,
  ADD CONSTRAINT comments_mentions_unique
  CHECK (private.text_array_is_unique(mentions)) NOT VALID;
