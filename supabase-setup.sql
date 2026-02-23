-- Supabase Database Setup for Mustard
-- Execute these commands in the Supabase SQL Editor

-- 1. Create the notes table
CREATE TABLE notes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  author_id TEXT NOT NULL,              -- DID like 'did:plc:xyz...'
  page_url TEXT NOT NULL,
  content TEXT NOT NULL,
  element_selector TEXT,                -- CSS selector (includes #id when element has id)
  relative_position_x REAL NOT NULL,    -- 0-100% relative to element
  relative_position_y REAL NOT NULL,    -- 0-100% relative to element
  click_position_x REAL NOT NULL,       -- viewport width percentage (0-100)
  click_position_y REAL NOT NULL,       -- pixels from top (includes scroll)
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- 2. Create indexes for performance
CREATE INDEX idx_notes_author_id ON notes(author_id);
CREATE INDEX idx_notes_page_url ON notes(page_url);

-- 3. Enable Row Level Security
ALTER TABLE notes ENABLE ROW LEVEL SECURITY;

-- 4. Create RLS policies

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
