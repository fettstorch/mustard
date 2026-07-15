-- A stable, bounded Open Graph snapshot for a note's first web link. Original
-- third-party image URLs and data URIs are never published. thumbnailPath is
-- an immutable, per-author content-addressed WebP object, so identical images
-- can be shared safely by several notes from the same author.
ALTER TABLE public.notes
  ADD COLUMN IF NOT EXISTS link_preview JSONB;

ALTER TABLE public.notes
  DROP CONSTRAINT IF EXISTS notes_link_preview_is_bounded_object;

ALTER TABLE public.notes
  ADD CONSTRAINT notes_link_preview_is_bounded_object
  CHECK (
    link_preview IS NULL OR (
      jsonb_typeof(link_preview) = 'object'
      AND link_preview ? 'url'
      AND jsonb_typeof(link_preview->'url') = 'string'
      AND length(link_preview->>'url') <= 2000
      AND octet_length(link_preview::TEXT) <= 4096
      AND NOT (link_preview ?| ARRAY['imageUrl', 'imageDataUrl'])
      AND (
        NOT (link_preview ? 'title')
        OR (
          jsonb_typeof(link_preview->'title') = 'string'
          AND length(link_preview->>'title') <= 200
        )
      )
      AND (
        NOT (link_preview ? 'description')
        OR (
          jsonb_typeof(link_preview->'description') = 'string'
          AND length(link_preview->>'description') <= 300
        )
      )
      AND (
        NOT (link_preview ? 'siteName')
        OR (
          jsonb_typeof(link_preview->'siteName') = 'string'
          AND length(link_preview->>'siteName') <= 80
        )
      )
      AND (
        NOT (link_preview ? 'thumbnailPath')
        OR (
          jsonb_typeof(link_preview->'thumbnailPath') = 'string'
          AND pg_catalog.array_length(
            pg_catalog.string_to_array(link_preview->>'thumbnailPath', '/'),
            1
          ) = 2
          AND pg_catalog.split_part(link_preview->>'thumbnailPath', '/', 1) = author_id
          AND pg_catalog.split_part(link_preview->>'thumbnailPath', '/', 2)
            ~ '^[0-9a-f]{64}\.webp$'
        )
      )
    )
  ) NOT VALID;

CREATE INDEX IF NOT EXISTS idx_notes_link_preview_thumbnail_path
  ON public.notes ((link_preview->>'thumbnailPath'))
  WHERE link_preview ? 'thumbnailPath';

-- Public reads are intentional: notes are public and thumbnails contain no
-- private data. An authenticated author may insert an immutable object only
-- while one of their notes references that exact content-addressed path.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'link-preview-thumbnails',
  'link-preview-thumbnails',
  TRUE,
  20480,
  ARRAY['image/webp']
)
ON CONFLICT (id) DO UPDATE SET
  public = EXCLUDED.public,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

DROP POLICY IF EXISTS "Users upload own link preview thumbnails" ON storage.objects;
DROP POLICY IF EXISTS "Users select own link preview thumbnails" ON storage.objects;
DROP POLICY IF EXISTS "Users update own link preview thumbnails" ON storage.objects;
DROP POLICY IF EXISTS "Users delete own link preview thumbnails" ON storage.objects;

CREATE POLICY "Users upload own link preview thumbnails"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'link-preview-thumbnails'
    AND (storage.foldername(name))[1] = (SELECT auth.jwt()->>'sub')
    AND pg_catalog.array_length(storage.foldername(name), 1) = 1
    AND pg_catalog.lower(storage.extension(name)) = 'webp'
    AND storage.filename(name) ~ '^[0-9a-f]{64}\.webp$'
    AND EXISTS (
      SELECT 1
      FROM public.notes
      WHERE author_id = (SELECT auth.jwt()->>'sub')
        AND link_preview->>'thumbnailPath' = name
    )
  );

CREATE POLICY "Users select own link preview thumbnails"
  ON storage.objects FOR SELECT TO authenticated
  USING (
    bucket_id = 'link-preview-thumbnails'
    AND (storage.foldername(name))[1] = (SELECT auth.jwt()->>'sub')
    AND pg_catalog.array_length(storage.foldername(name), 1) = 1
    AND pg_catalog.lower(storage.extension(name)) = 'webp'
    AND storage.filename(name) ~ '^[0-9a-f]{64}\.webp$'
  );

CREATE POLICY "Users delete own link preview thumbnails"
  ON storage.objects FOR DELETE TO authenticated
  USING (
    bucket_id = 'link-preview-thumbnails'
    AND (storage.foldername(name))[1] = (SELECT auth.jwt()->>'sub')
    AND pg_catalog.array_length(storage.foldername(name), 1) = 1
    AND pg_catalog.lower(storage.extension(name)) = 'webp'
    AND storage.filename(name) ~ '^[0-9a-f]{64}\.webp$'
    AND NOT EXISTS (
      SELECT 1
      FROM public.notes
      WHERE link_preview->>'thumbnailPath' = name
    )
  );
