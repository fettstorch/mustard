-- Subscribe everyone who participates in a note's comment thread to future
-- comments on that note.
--
-- For each new comment, one `comment` notification is created for:
--   * the note author; and
--   * every distinct author of an existing comment on the note.
--
-- The new comment's author is excluded, and UNION de-duplicates a note author
-- who has also commented. The existing partial unique index remains the final
-- retry/concurrency guard for each (recipient, comment).
CREATE OR REPLACE FUNCTION fn_create_comment_notification()
RETURNS TRIGGER
SECURITY DEFINER
SET search_path = public
LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO notifications (recipient_id, note_id, comment_id, actor_id, type)
  SELECT recipients.recipient_id, NEW.note_id, NEW.id, NEW.author_id, 'comment'
  FROM (
    SELECT author_id AS recipient_id
    FROM notes
    WHERE id = NEW.note_id

    UNION

    SELECT author_id AS recipient_id
    FROM comments
    WHERE note_id = NEW.note_id
      AND id <> NEW.id
  ) AS recipients
  WHERE recipients.recipient_id <> NEW.author_id
  ON CONFLICT (recipient_id, comment_id) WHERE type = 'comment' DO NOTHING;

  RETURN NEW;
END $$;

-- A thread participant already receives the `comment` notification above.
-- Suppress a second `mention` row when the same new comment explicitly mentions
-- them. Non-participants still receive mention notifications as before.
CREATE OR REPLACE FUNCTION fn_create_comment_mention_notifications()
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

    IF recipient_user_id IS NULL THEN
      CONTINUE;
    END IF;

    -- Never notify the commenter about their own mention.
    IF recipient_user_id::text = NEW.author_id THEN
      CONTINUE;
    END IF;

    -- The note author and prior commenters already receive one thread
    -- notification for this comment, so do not double-notify them for a mention.
    IF EXISTS (
      SELECT 1
      FROM notes
      WHERE id = NEW.note_id
        AND author_id = recipient_user_id::text
    ) OR EXISTS (
      SELECT 1
      FROM comments
      WHERE note_id = NEW.note_id
        AND id <> NEW.id
        AND author_id = recipient_user_id::text
    ) THEN
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
