-- Create notifications table for unread comment activity on a user's notes.
-- Semantics: presence in this table == unread. There is no "read" column.
-- Rows are deleted when the recipient acknowledges them (thread expanded on
-- the page that owns the note), or cascade away if the comment/note is deleted.
CREATE TABLE IF NOT EXISTS notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  recipient_id TEXT NOT NULL,                                  -- note author DID
  note_id UUID NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
  comment_id UUID NOT NULL REFERENCES comments(id) ON DELETE CASCADE,
  actor_id TEXT NOT NULL,                                      -- commenter DID
  created_at TIMESTAMPTZ DEFAULT now() NOT NULL,
  UNIQUE (recipient_id, comment_id)
);

-- Fast lookup of all unread for a user, newest first
CREATE INDEX IF NOT EXISTS idx_notifications_recipient
  ON notifications(recipient_id, created_at DESC);

-- Fast "mark seen for this note" delete
CREATE INDEX IF NOT EXISTS idx_notifications_recipient_note
  ON notifications(recipient_id, note_id);

-- Enable Row Level Security (RLS)
ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;

-- Recipient can read their own notifications. Nobody else can.
CREATE POLICY "Recipients read own notifications"
  ON notifications FOR SELECT
  USING (auth.jwt()->>'sub' = recipient_id);

-- Recipient can delete their own notifications (acknowledge / mark-seen).
CREATE POLICY "Recipients delete own notifications"
  ON notifications FOR DELETE
  USING (auth.jwt()->>'sub' = recipient_id);

-- Note: no INSERT or UPDATE policy on purpose. Notifications are created
-- exclusively by the trigger below, which runs as SECURITY DEFINER and
-- therefore bypasses RLS.

-- Trigger function: when someone comments on a note that isn't their own,
-- create a notification row for the note's author.
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

  -- Defensive: if the note vanished mid-insert, skip silently.
  IF note_author IS NULL THEN
    RETURN NEW;
  END IF;

  -- Self-comments don't trigger notifications.
  IF note_author = NEW.author_id THEN
    RETURN NEW;
  END IF;

  INSERT INTO notifications (recipient_id, note_id, comment_id, actor_id)
  VALUES (note_author, NEW.note_id, NEW.id, NEW.author_id)
  ON CONFLICT (recipient_id, comment_id) DO NOTHING;

  RETURN NEW;
END $$;

CREATE TRIGGER trg_comment_insert_notify
  AFTER INSERT ON comments
  FOR EACH ROW
  EXECUTE FUNCTION fn_create_comment_notification();
