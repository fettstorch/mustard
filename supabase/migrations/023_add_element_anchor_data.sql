-- Optional, extensible metadata for the element a note is anchored to.
-- The payload remains generic JSONB so new element types do not require a
-- schema migration or video-specific columns.
ALTER TABLE public.notes
  ADD COLUMN IF NOT EXISTS element_anchor_data JSONB;
