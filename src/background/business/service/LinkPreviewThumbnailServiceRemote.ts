/**
 * Remote persistence for published link-preview thumbnails.
 *
 * Preview metadata stays on `notes.link_preview`; this service handles only
 * bounded WebP objects in Supabase Storage. Objects are immutable and addressed
 * by their SHA-256 content hash inside the author's folder, so that author's
 * notes can safely share identical thumbnails.
 */
import { supabase } from '@/background/supabase-client'
import type { LinkPreview } from '@/shared/model/LinkPreview'
import { cached } from '@fettstorch/jule'

const LINK_PREVIEW_BUCKET = 'link-preview-thumbnails'

const MAX_THUMBNAIL_BYTES = 20 * 1024
const THUMBNAIL_CACHE_TTL_MS = 5 * 60 * 1000
const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}'
const SHA256 = '[0-9a-f]{64}'
const THUMBNAIL_PATH = new RegExp(`^(${UUID})/(${SHA256})\\.webp$`)
const DATA_URL = /^data:(image\/webp);base64,([a-z\d+/]+={0,2})$/i
const IMMUTABLE_CACHE_SECONDS = 365 * 24 * 60 * 60

type PreparedLinkPreviewThumbnail = {
  path: string
  blob: Blob
}

/**
 * Validate the already-bounded author-side thumbnail, derive its immutable
 * content-addressed path, and return trusted publishable preview data. This
 * does not perform remote I/O: the note row must reference the path before the
 * Storage RLS policy permits the upload.
 */
export async function prepareLinkPreviewThumbnail(
  preview: LinkPreview | undefined,
  authorId: string,
): Promise<{ preview?: LinkPreview; thumbnail?: PreparedLinkPreviewThumbnail }> {
  if (!preview) return {}
  const { imageUrl: _imageUrl, imageDataUrl, thumbnailPath, ...metadata } = preview
  const existingPath =
    thumbnailPath && isLinkPreviewThumbnailPathForAuthor(thumbnailPath, authorId)
      ? thumbnailPath
      : undefined
  if (!imageDataUrl) {
    return { preview: { ...metadata, ...(existingPath ? { thumbnailPath: existingPath } : {}) } }
  }

  const decoded = decodeThumbnailDataUrl(imageDataUrl)
  if (!decoded) return { preview: metadata }
  const hash = await sha256Hex(decoded.bytes)
  const path = `${authorId}/${hash}.webp`
  if (!isLinkPreviewThumbnailPathForAuthor(path, authorId)) return { preview: metadata }

  return {
    preview: { ...metadata, thumbnailPath: path, imageDataUrl },
    thumbnail: { path, blob: decoded.blob },
  }
}

/**
 * Ensure a prepared immutable object exists after its note reference has been
 * committed. A HEAD request avoids retransmitting content already stored for
 * another note; a duplicate race is also treated as success.
 */
export async function ensureLinkPreviewThumbnailStored(
  thumbnail: PreparedLinkPreviewThumbnail,
): Promise<boolean> {
  if (!isLinkPreviewThumbnailPath(thumbnail.path)) return false
  const bucket = supabase.storage.from(LINK_PREVIEW_BUCKET)

  try {
    const existing = await bucket.exists(thumbnail.path)
    if (existing.data) return true

    const { error } = await bucket.upload(thumbnail.path, thumbnail.blob, {
      cacheControl: String(IMMUTABLE_CACHE_SECONDS),
      contentType: 'image/webp',
      upsert: false,
    })
    if (!error || isAlreadyStoredError(error)) return true
    console.debug('mustard [link-preview] thumbnail upload failed:', error.message)
  } catch (error) {
    console.debug('mustard [link-preview] thumbnail upload failed:', error)
  }
  return false
}

/** Download one trusted Storage object for progressive CSP-safe card rendering. */
export const loadLinkPreviewThumbnail = cached(
  async (path: string): Promise<string | undefined> => {
    if (!isLinkPreviewThumbnailPath(path)) return undefined
    try {
      const { data } = supabase.storage.from(LINK_PREVIEW_BUCKET).getPublicUrl(path)
      const response = await fetch(data.publicUrl, {
        credentials: 'omit',
        referrerPolicy: 'no-referrer',
      })
      if (!response.ok) return undefined
      const contentLength = Number(response.headers.get('content-length'))
      if (Number.isFinite(contentLength) && contentLength > MAX_THUMBNAIL_BYTES) return undefined
      const blob = await response.blob()
      if (blob.size > MAX_THUMBNAIL_BYTES || blob.type.toLowerCase() !== 'image/webp')
        return undefined
      return `data:image/webp;base64,${toBase64(new Uint8Array(await blob.arrayBuffer()))}`
    } catch (error) {
      console.debug('mustard [link-preview] thumbnail download failed:', error)
      return undefined
    }
  },
  { ttlMs: THUMBNAIL_CACHE_TTL_MS },
)

export async function deleteLinkPreviewThumbnail(path?: string): Promise<void> {
  if (!path || !isLinkPreviewThumbnailPath(path)) return
  const { error } = await supabase.storage.from(LINK_PREVIEW_BUCKET).remove([path])
  if (error) throw new Error(`Failed to delete link preview thumbnail: ${error.message}`)
  loadLinkPreviewThumbnail.evict(path)
}

export function isLinkPreviewThumbnailPath(path: string): boolean {
  return THUMBNAIL_PATH.test(path)
}

export function isLinkPreviewThumbnailPathForAuthor(path: string, authorId: string): boolean {
  const match = path.match(THUMBNAIL_PATH)
  return !!match && match[1]?.toLowerCase() === authorId.toLowerCase()
}

function decodeThumbnailDataUrl(value: string): { bytes: Uint8Array; blob: Blob } | undefined {
  const match = value.match(DATA_URL)
  if (!match?.[1] || !match[2]) return undefined
  try {
    const binary = atob(match[2])
    if (binary.length > MAX_THUMBNAIL_BYTES) return undefined
    const bytes = new Uint8Array(binary.length)
    for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index)
    const mimeType = match[1].toLowerCase()
    return { bytes, blob: new Blob([bytes], { type: mimeType }) }
  } catch {
    return undefined
  }
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const copy = new Uint8Array(bytes.byteLength)
  copy.set(bytes)
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', copy.buffer))
  return Array.from(digest, (byte) => byte.toString(16).padStart(2, '0')).join('')
}

function isAlreadyStoredError(error: {
  status?: number
  statusCode?: string
  message: string
}): boolean {
  return (
    error.status === 409 ||
    ['Duplicate', 'KeyAlreadyExists', 'ResourceAlreadyExists'].includes(error.statusCode ?? '') ||
    /already exists|duplicate/i.test(error.message)
  )
}

function toBase64(bytes: Uint8Array): string {
  let binary = ''
  const chunkSize = 0x8000
  for (let start = 0; start < bytes.length; start += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(start, start + chunkSize))
  }
  return btoa(binary)
}
