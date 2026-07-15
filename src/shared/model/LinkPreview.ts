/**
 * A small, sanitized snapshot of the first web link in a note.
 *
 * `imageUrl` is the author-side Open Graph source and is never published.
 * `thumbnailPath` is `authorId/sha256.webp` in Mustard's trusted Supabase
 * Storage bucket, allowing one author's identical thumbnails to be shared.
 * `imageDataUrl` is a bounded CSP-safe WebP used only at runtime or in local
 * notes; it is never sent to the public notes table.
 */
export type LinkPreview = {
  url: string
  title?: string
  description?: string
  siteName?: string
  imageUrl?: string
  thumbnailPath?: string
  imageDataUrl?: string
}
