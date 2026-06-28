-- Migrate the legacy atproto-DID identity model to opaque UUID user_ids.
--
-- Production (migrations <= 007) stores the raw atproto DID directly in every
-- author/actor column (notes.author_id, comments.author_id, reposts.reposter_id,
-- notifications.recipient_id / actor_id). This migration:
--   1. mints one fresh UUID per distinct DID,
--   2. creates the users + atproto identities rows,
--   3. REWRITES every author/actor column from the DID to that UUID,
--   4. redefines the mention-notification triggers to resolve a mentioned
--      provider account id (DID) → the recipient's UUID.
--
-- NOT rewritten: the `mentions TEXT[]` columns. Mentions keep storing the
-- provider account id (the DID, via the `@[did:...]` sentinel) because the
-- editor/renderer only knows the DID, never the recipient's UUID. The triggers
-- (below) and get-index-v2 do the account-id → user_id resolution at read time.

-- ── 1. DID → UUID mapping (transaction-scoped, dropped on commit) ─────────────
CREATE TEMP TABLE _did_map ON COMMIT DROP AS
SELECT DISTINCT v AS did, gen_random_uuid() AS uid
FROM (
  SELECT author_id    AS v FROM notes
  UNION SELECT author_id        FROM comments
  UNION SELECT reposter_id      FROM reposts
  UNION SELECT recipient_id     FROM notifications
  UNION SELECT actor_id         FROM notifications
  -- Sessions so users who logged in but never published still get a user row.
  UNION SELECT did              FROM oauth_session WHERE did IS NOT NULL
) all_dids
WHERE v IS NOT NULL
  AND v LIKE 'did:%';   -- only real atproto DIDs; skips 'local' sentinel etc.

-- ── 2. Create unified users + atproto identities ──────────────────────────────
INSERT INTO users (id)
SELECT uid FROM _did_map
ON CONFLICT (id) DO NOTHING;

INSERT INTO identities (user_id, provider, provider_account_id)
SELECT uid, 'atproto', did FROM _did_map
ON CONFLICT (provider, provider_account_id) DO NOTHING;

-- ── 3. Rewrite every author/actor column DID → UUID (stored as text) ──────────
UPDATE notes         n SET author_id    = m.uid::text FROM _did_map m WHERE n.author_id    = m.did;
UPDATE comments      c SET author_id    = m.uid::text FROM _did_map m WHERE c.author_id    = m.did;
UPDATE reposts       r SET reposter_id  = m.uid::text FROM _did_map m WHERE r.reposter_id  = m.did;
UPDATE notifications x SET recipient_id = m.uid::text FROM _did_map m WHERE x.recipient_id = m.did;
UPDATE notifications x SET actor_id     = m.uid::text FROM _did_map m WHERE x.actor_id     = m.did;

-- ── 4. Mention triggers: resolve mentioned account id (DID) → recipient UUID ──
-- mentions[] holds provider account ids (DIDs). recipient_id must be a UUID, so
-- each mentioned id is resolved through `identities`. Mentions of people who
-- aren't Mustard users resolve to nothing and are skipped (no notification).

CREATE OR REPLACE FUNCTION fn_create_note_mention_notifications()
RETURNS TRIGGER
SECURITY DEFINER
SET search_path = public
LANGUAGE plpgsql AS $$
DECLARE
  mentioned_account_id TEXT;
  recipient_user_id    UUID;
BEGIN
  FOREACH mentioned_account_id IN ARRAY NEW.mentions LOOP
    SELECT user_id INTO recipient_user_id
    FROM identities
    WHERE provider_account_id = mentioned_account_id
    LIMIT 1;

    -- Not a Mustard user, or self-mention (author_id is already a UUID).
    IF recipient_user_id IS NULL OR recipient_user_id::text = NEW.author_id THEN
      CONTINUE;
    END IF;

    INSERT INTO notifications (recipient_id, note_id, comment_id, actor_id, type)
    VALUES (recipient_user_id::text, NEW.id, NULL, NEW.author_id, 'mention')
    ON CONFLICT (recipient_id, note_id)
      WHERE type = 'mention' AND comment_id IS NULL
      DO NOTHING;
  END LOOP;

  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION fn_create_comment_mention_notifications()
RETURNS TRIGGER
SECURITY DEFINER
SET search_path = public
LANGUAGE plpgsql AS $$
DECLARE
  mentioned_account_id TEXT;
  recipient_user_id    UUID;
  note_author          TEXT;
BEGIN
  SELECT author_id INTO note_author FROM notes WHERE id = NEW.note_id;

  FOREACH mentioned_account_id IN ARRAY NEW.mentions LOOP
    SELECT user_id INTO recipient_user_id
    FROM identities
    WHERE provider_account_id = mentioned_account_id
    LIMIT 1;

    IF recipient_user_id IS NULL THEN
      CONTINUE;
    END IF;

    -- Never notify the commenter about their own mention.
    IF recipient_user_id::text = NEW.author_id THEN
      CONTINUE;
    END IF;

    -- The note author already gets a 'comment' notification for this comment.
    IF recipient_user_id::text = note_author THEN
      CONTINUE;
    END IF;

    INSERT INTO notifications (recipient_id, note_id, comment_id, actor_id, type)
    VALUES (recipient_user_id::text, NEW.note_id, NEW.id, NEW.author_id, 'mention')
    ON CONFLICT (recipient_id, comment_id)
      WHERE type = 'mention' AND comment_id IS NOT NULL
      DO NOTHING;
  END LOOP;

  RETURN NEW;
END $$;
