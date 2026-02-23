-- Add CHECK constraints for character limits
-- This migration adds database-level validation as a last line of defense

ALTER TABLE notes
  ADD CONSTRAINT content_max_length CHECK (length(content) <= 300),
  ADD CONSTRAINT page_url_max_length CHECK (length(page_url) <= 2000),
  ADD CONSTRAINT element_selector_max_length CHECK (
    element_selector IS NULL OR length(element_selector) <= 500
  );
