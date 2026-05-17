-- Create comments table for storing comments on mustard notes
-- Comments are public: anyone who can see the note can read all its comments,
-- regardless of follow relationship.
CREATE TABLE IF NOT EXISTS comments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  note_id UUID NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
  author_id TEXT NOT NULL,                       -- AT Protocol DID
  content TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now() NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT now() NOT NULL,
  CONSTRAINT comment_content_max_length CHECK (length(content) <= 300)
);

-- Fast lookup of all comments for a given note (the most common query)
CREATE INDEX IF NOT EXISTS idx_comments_note_id ON comments(note_id);

-- Fast lookup of comments authored by a user (for future "my comments" views, etc.)
CREATE INDEX IF NOT EXISTS idx_comments_author_id ON comments(author_id);

-- Enable Row Level Security (RLS)
ALTER TABLE comments ENABLE ROW LEVEL SECURITY;

-- Public read: anyone with the anon key can read all comments
CREATE POLICY "Comments are publicly readable"
  ON comments FOR SELECT
  USING (true);

-- Only the comment's author can insert (must be logged in via Supabase JWT)
CREATE POLICY "Users can insert own comments"
  ON comments FOR INSERT
  WITH CHECK (auth.jwt()->>'sub' = author_id);

-- Only the comment's author can update their own comment
CREATE POLICY "Users can update own comments"
  ON comments FOR UPDATE
  USING (auth.jwt()->>'sub' = author_id);

-- Only the comment's author can delete their own comment
-- (Note authors do NOT have moderation rights — by design)
CREATE POLICY "Users can delete own comments"
  ON comments FOR DELETE
  USING (auth.jwt()->>'sub' = author_id);
