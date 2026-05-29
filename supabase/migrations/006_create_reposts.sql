-- Create reposts table: a repost is a visibility grant, not a new note.
-- It lets a user's followers see an existing note even when they don't follow
-- the note's original author. The note keeps its single original author; the
-- (note_id, reposter_id) pair records "this user vouched for this note".
CREATE TABLE IF NOT EXISTS reposts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  note_id UUID NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
  reposter_id TEXT NOT NULL,                     -- AT Protocol DID
  created_at TIMESTAMPTZ DEFAULT now() NOT NULL,
  UNIQUE (note_id, reposter_id)                  -- a user can repost a note at most once
);

-- "What did the people I follow repost?" — the get-index-v2 visibility query.
CREATE INDEX IF NOT EXISTS idx_reposts_reposter_id ON reposts(reposter_id);

-- "Who reposted this note?" — used when building the reposter list per note.
CREATE INDEX IF NOT EXISTS idx_reposts_note_id ON reposts(note_id);

-- Enable Row Level Security (RLS)
ALTER TABLE reposts ENABLE ROW LEVEL SECURITY;

-- Public read: anyone with the anon key can read all reposts (visibility
-- filtering happens at query time in get-index-v2, same as notes).
CREATE POLICY "Reposts are publicly readable"
  ON reposts FOR SELECT
  USING (true);

-- Only the reposter can create their own repost (must be logged in via Supabase JWT)
CREATE POLICY "Users can insert own reposts"
  ON reposts FOR INSERT
  WITH CHECK (auth.jwt()->>'sub' = reposter_id);

-- Only the reposter can remove their own repost
CREATE POLICY "Users can delete own reposts"
  ON reposts FOR DELETE
  USING (auth.jwt()->>'sub' = reposter_id);
