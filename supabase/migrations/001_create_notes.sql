-- Create notes table for storing mustard notes
CREATE TABLE IF NOT EXISTS notes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  author_id TEXT NOT NULL,           -- AT Protocol DID (e.g., "did:plc:...")
  page_url TEXT NOT NULL,            -- Normalized page URL (without query params)
  content TEXT NOT NULL,             -- Note content (up to 300 chars per README)
  anchor_data JSONB NOT NULL,        -- Positioning data: elementId, elementSelector, relativePosition, clickPosition
  updated_at TIMESTAMPTZ DEFAULT now() NOT NULL,
  
  -- Prevent duplicate notes at the same anchor position by the same author
  -- Note: NULL values in elementId/elementSelector are handled by PostgreSQL
  CONSTRAINT unique_note_per_author_page_anchor 
    UNIQUE (author_id, page_url, (anchor_data->>'elementId'), (anchor_data->>'elementSelector'))
);

-- Index for fast queries by page URL (most common query pattern)
CREATE INDEX IF NOT EXISTS idx_notes_page_url ON notes(page_url);

-- Index for fast queries by author ID (for user's own notes, index queries)
CREATE INDEX IF NOT EXISTS idx_notes_author_id ON notes(author_id);

-- Composite index for efficient queries filtering by both page_url and author_id
CREATE INDEX IF NOT EXISTS idx_notes_page_url_author_id ON notes(page_url, author_id);

-- Enable Row Level Security (RLS) - we'll configure policies later if needed
ALTER TABLE notes ENABLE ROW LEVEL SECURITY;

-- For now, allow all operations (we'll restrict via Edge Functions + AT Protocol auth)
-- Later we can add RLS policies for additional security
CREATE POLICY "Allow all operations" ON notes FOR ALL USING (true) WITH CHECK (true);
