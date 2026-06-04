-- @-mentions: store mentioned DIDs on notes/comments and fan out "mention"
-- notifications to those users (in addition to the existing comment-author
-- notifications). Mentions are stored DID-canonically; the DID list mirrors the
-- `@[did]` sentinels in the content and is what the triggers below read.

-- 1. Mentioned-DID columns ---------------------------------------------------
ALTER TABLE notes ADD COLUMN IF NOT EXISTS mentions TEXT[] NOT NULL DEFAULT '{}';
ALTER TABLE comments ADD COLUMN IF NOT EXISTS mentions TEXT[] NOT NULL DEFAULT '{}';

-- GIN indexes for the mention-visibility lookups in get-index-v2
-- (`mentions @> ARRAY[did]`). Without them, array-containment queries seq-scan
-- every note/comment; GIN indexes each DID element so the scan is index-backed
-- as the tables grow.
CREATE INDEX IF NOT EXISTS idx_notes_mentions ON notes USING GIN (mentions);
CREATE INDEX IF NOT EXISTS idx_comments_mentions ON comments USING GIN (mentions);

-- 2. notifications: add a type + allow note-only (comment-less) rows ----------
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS type TEXT NOT NULL DEFAULT 'comment';
ALTER TABLE notifications ALTER COLUMN comment_id DROP NOT NULL;

-- Drop the old table-level UNIQUE(recipient_id, comment_id) so we can replace it
-- with type-aware partial unique indexes (a recipient may receive BOTH a
-- comment-author notification AND a mention notification).
ALTER TABLE notifications
  DROP CONSTRAINT IF EXISTS notifications_recipient_id_comment_id_key;

-- One comment-author notification per (recipient, comment).
CREATE UNIQUE INDEX IF NOT EXISTS uq_notifications_comment
  ON notifications(recipient_id, comment_id)
  WHERE type = 'comment';

-- One mention notification per (recipient, comment) for comment mentions.
CREATE UNIQUE INDEX IF NOT EXISTS uq_notifications_comment_mention
  ON notifications(recipient_id, comment_id)
  WHERE type = 'mention' AND comment_id IS NOT NULL;

-- One mention notification per (recipient, note) for note mentions.
CREATE UNIQUE INDEX IF NOT EXISTS uq_notifications_note_mention
  ON notifications(recipient_id, note_id)
  WHERE type = 'mention' AND comment_id IS NULL;

-- Integrity: only known types; comment-author rows must reference a comment.
ALTER TABLE notifications
  DROP CONSTRAINT IF EXISTS notifications_type_shape_check;
ALTER TABLE notifications
  ADD CONSTRAINT notifications_type_shape_check
  CHECK (
    type IN ('comment', 'mention')
    AND (type <> 'comment' OR comment_id IS NOT NULL)
  );

-- 3. Comment-author notification trigger: now type-aware -----------------------
-- (Unchanged behavior; updated to set type='comment' explicitly and to use the
-- partial-index arbiter in ON CONFLICT.)
CREATE OR REPLACE FUNCTION fn_create_comment_notification()
RETURNS TRIGGER
SECURITY DEFINER
SET search_path = public
LANGUAGE plpgsql AS $$
DECLARE
  note_author TEXT;
BEGIN
  SELECT author_id INTO note_author
  FROM notes
  WHERE id = NEW.note_id;

  IF note_author IS NULL THEN
    RETURN NEW;
  END IF;

  -- Self-comments don't trigger notifications.
  IF note_author = NEW.author_id THEN
    RETURN NEW;
  END IF;

  INSERT INTO notifications (recipient_id, note_id, comment_id, actor_id, type)
  VALUES (note_author, NEW.note_id, NEW.id, NEW.author_id, 'comment')
  ON CONFLICT (recipient_id, comment_id) WHERE type = 'comment' DO NOTHING;

  RETURN NEW;
END $$;

-- 4. Note mention notifications -----------------------------------------------
-- These fire AFTER INSERT only (mirroring trg_comment_insert_notify).
--
-- LOAD-BEARING ASSUMPTION: the current UI never edits a remote note/comment —
-- publishing always creates a fresh row (no id is sent to the upsert), so the
-- mentions column is only ever written at insert time. The service layer DOES
-- still support UPDATE; this trigger just doesn't react to it.
--
-- DO NOT naively add `OR UPDATE OF mentions` if a remote-editing feature is
-- added later. Two traps:
--   1. mentions added during an edit would never notify (this trigger is INSERT
--      only), so you'd be tempted to add an UPDATE trigger;
--   2. but an UPDATE trigger would RESURRECT dismissed mentions — ON CONFLICT
--      only dedupes against an existing row, and a dismissed notification was
--      deleted, so it has nothing to conflict with and would be re-created.
-- A real editing feature needs to diff old vs new mentions and only notify the
-- newly-added DIDs. ON CONFLICT DO NOTHING here is purely a retry guard.
CREATE OR REPLACE FUNCTION fn_create_note_mention_notifications()
RETURNS TRIGGER
SECURITY DEFINER
SET search_path = public
LANGUAGE plpgsql AS $$
DECLARE
  mentioned_did TEXT;
BEGIN
  FOREACH mentioned_did IN ARRAY NEW.mentions LOOP
    -- Never notify the author about their own mention.
    IF mentioned_did = NEW.author_id THEN
      CONTINUE;
    END IF;

    INSERT INTO notifications (recipient_id, note_id, comment_id, actor_id, type)
    VALUES (mentioned_did, NEW.id, NULL, NEW.author_id, 'mention')
    ON CONFLICT (recipient_id, note_id)
      WHERE type = 'mention' AND comment_id IS NULL
      DO NOTHING;
  END LOOP;

  RETURN NEW;
END $$;

CREATE TRIGGER trg_note_mention_notify
  AFTER INSERT ON notes
  FOR EACH ROW
  EXECUTE FUNCTION fn_create_note_mention_notifications();

-- 5. Comment mention notifications --------------------------------------------
-- The note author already receives a 'comment' notification for every comment on
-- their note, so we must NOT also emit a 'mention' row for them — otherwise a
-- single comment that mentions the note author is double-counted in the badge
-- (one 'comment' + one 'mention' row for the same recipient/comment). Skip both
-- the commenter (self-mention) and the note author here.
CREATE OR REPLACE FUNCTION fn_create_comment_mention_notifications()
RETURNS TRIGGER
SECURITY DEFINER
SET search_path = public
LANGUAGE plpgsql AS $$
DECLARE
  mentioned_did TEXT;
  note_author TEXT;
BEGIN
  SELECT author_id INTO note_author
  FROM notes
  WHERE id = NEW.note_id;

  FOREACH mentioned_did IN ARRAY NEW.mentions LOOP
    -- Never notify the commenter about their own mention.
    IF mentioned_did = NEW.author_id THEN
      CONTINUE;
    END IF;

    -- The note author already gets a 'comment' notification for this comment.
    IF mentioned_did = note_author THEN
      CONTINUE;
    END IF;

    INSERT INTO notifications (recipient_id, note_id, comment_id, actor_id, type)
    VALUES (mentioned_did, NEW.note_id, NEW.id, NEW.author_id, 'mention')
    ON CONFLICT (recipient_id, comment_id)
      WHERE type = 'mention' AND comment_id IS NOT NULL
      DO NOTHING;
  END LOOP;

  RETURN NEW;
END $$;

CREATE TRIGGER trg_comment_mention_notify
  AFTER INSERT ON comments
  FOR EACH ROW
  EXECUTE FUNCTION fn_create_comment_mention_notifications();
