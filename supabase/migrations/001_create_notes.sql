-- Create notes table for storing mustard notes
CREATE TABLE IF NOT EXISTS notes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  author_id TEXT NOT NULL,              -- AT Protocol DID (e.g., "did:plc:...")
  page_url TEXT NOT NULL,               -- Normalized page URL (without query params)
  content TEXT NOT NULL,                -- Note content (up to 300 chars)
  element_selector TEXT,                -- CSS selector (includes #id when element has id)
  relative_position_x REAL NOT NULL,    -- 0-100% relative to element
  relative_position_y REAL NOT NULL,    -- 0-100% relative to element
  click_position_x REAL NOT NULL,       -- viewport width percentage (0-100)
  click_position_y REAL NOT NULL,       -- pixels from top (includes scroll)
  updated_at TIMESTAMPTZ DEFAULT now() NOT NULL
);

-- Index for fast queries by page URL (most common query pattern)
CREATE INDEX IF NOT EXISTS idx_notes_page_url ON notes(page_url);

-- Index for fast queries by author ID (for user's own notes, index queries)
CREATE INDEX IF NOT EXISTS idx_notes_author_id ON notes(author_id);

-- Composite index for efficient queries filtering by both page_url and author_id
CREATE INDEX IF NOT EXISTS idx_notes_page_url_author_id ON notes(page_url, author_id);

-- Enable Row Level Security (RLS)
ALTER TABLE notes ENABLE ROW LEVEL SECURITY;

-- Anyone can read notes (public by design)
CREATE POLICY "Notes are publicly readable"
  ON notes FOR SELECT
  USING (true);

-- Only author can insert their own notes
CREATE POLICY "Users can insert own notes"
  ON notes FOR INSERT
  WITH CHECK (auth.jwt()->>'sub' = author_id);

-- Only author can update their own notes
CREATE POLICY "Users can update own notes"
  ON notes FOR UPDATE
  USING (auth.jwt()->>'sub' = author_id);

-- Only author can delete their own notes
CREATE POLICY "Users can delete own notes"
  ON notes FOR DELETE
  USING (auth.jwt()->>'sub' = author_id);
