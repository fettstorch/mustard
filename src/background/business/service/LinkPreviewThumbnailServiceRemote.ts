/**
 * Remote persistence for published link-preview thumbnails.
 *
 * Preview metadata stays on `notes.link_preview`; this service handles only
 * bounded WebP objects in Supabase Storage. Objects are immutable and addressed
 * globally by their SHA-256 content hash, so every author's notes can share
 * identical thumbnails. An authenticated Edge Function verifies the bytes
 * before performing privileged global writes.
 */
import { getSupabaseJwt } from '@/background/auth/SupabaseAuth'
import { supabase } from '@/background/supabase-client'
import type { LinkPreview } from '@/shared/model/LinkPreview'
import { cached } from '@fettstorch/jule'

const LINK_PREVIEW_BUCKET = 'link-preview-thumbnails'
const LINK_PREVIEW_THUMBNAIL_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/link-preview-thumbnail`

const MAX_THUMBNAIL_BYTES = 20 * 1024
const THUMBNAIL_CACHE_TTL_MS = 5 * 60 * 1000
const SHA256 = '[0-9a-f]{64}'
const THUMBNAIL_PATH = new RegExp(`^global/(${SHA256})\\.webp$`)
const DATA_URL = /^data:(image\/webp);base64,([a-z\d+/]+={0,2})$/i

type PreparedLinkPreviewThumbnail = {
  path: string
  blob: Blob
}

/**
 * Validate the already-bounded author-side thumbnail, derive its global
 * content-addressed path, and return trusted publishable preview data. This
 * does not perform remote I/O: the note row must reference the path before the
 * remote service accepts the upload.
 */
export async function prepareLinkPreviewThumbnail(
  preview: LinkPreview | undefined,
): Promise<{ preview?: LinkPreview; thumbnail?: PreparedLinkPreviewThumbnail }> {
  if (!preview) return {}
  const { imageUrl: _imageUrl, imageDataUrl, thumbnailPath, ...metadata } = preview
  const existingPath =
    thumbnailPath && isLinkPreviewThumbnailPath(thumbnailPath) ? thumbnailPath : undefined
  if (!imageDataUrl) {
    return { preview: { ...metadata, ...(existingPath ? { thumbnailPath: existingPath } : {}) } }
  }

  const decoded = decodeThumbnailDataUrl(imageDataUrl)
  if (!decoded) return { preview: metadata }
  const hash = await sha256Hex(decoded.bytes)
  const path = `global/${hash}.webp`
  if (!isLinkPreviewThumbnailPath(path)) return { preview: metadata }

  return {
    preview: { ...metadata, thumbnailPath: path, imageDataUrl },
    thumbnail: { path, blob: decoded.blob },
  }
}

/**
 * Ensure a prepared immutable object exists after its note reference has been
 * committed. A HEAD request avoids invoking the remote write service when any
 * author already stored the same bytes. The remote service re-hashes new bytes
 * before using privileged access to create the shared object.
 */
export async function ensureLinkPreviewThumbnailStored(
  thumbnail: PreparedLinkPreviewThumbnail,
): Promise<boolean> {
  if (!isLinkPreviewThumbnailPath(thumbnail.path)) return false
  const bucket = supabase.storage.from(LINK_PREVIEW_BUCKET)

  try {
    const existing = await bucket.exists(thumbnail.path)
    if (existing.data) return true

    const jwt = await getSupabaseJwt()
    if (!jwt) return false
    const response = await fetch(LINK_PREVIEW_THUMBNAIL_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${jwt}` },
      body: JSON.stringify({
        action: 'ensure',
        path: thumbnail.path,
        imageBase64: toBase64(new Uint8Array(await thumbnail.blob.arrayBuffer())),
      }),
    })
    if (response.ok) return true
    const error = (await response.json().catch(() => ({}))) as { error?: string }
    console.debug(
      'mustard [link-preview] thumbnail upload failed:',
      error.error ?? response.statusText,
    )
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
  const jwt = await getSupabaseJwt()
  if (!jwt) throw new Error('Cannot clean up link preview thumbnail without a session')
  const response = await fetch(LINK_PREVIEW_THUMBNAIL_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${jwt}` },
    body: JSON.stringify({ action: 'cleanup', path }),
  })
  if (!response.ok) {
    const error = (await response.json().catch(() => ({}))) as { error?: string }
    throw new Error(
      `Failed to clean up link preview thumbnail: ${error.error ?? response.statusText}`,
    )
  }
  loadLinkPreviewThumbnail.evict(path)
}

export function isLinkPreviewThumbnailPath(path: string): boolean {
  return THUMBNAIL_PATH.test(path)
}

function decodeThumbnailDataUrl(value: string): { bytes: Uint8Array; blob: Blob } | undefined {
  const match = value.match(DATA_URL)
  if (!match?.[1] || !match[2]) return undefined
  try {
    const binary = atob(match[2])
    if (binary.length > MAX_THUMBNAIL_BYTES) return undefined
    const bytes = new Uint8Array(binary.length)
    for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index)
    if (!isWebp(bytes)) return undefined
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

function isWebp(bytes: Uint8Array): boolean {
  return (
    bytes.length >= 12 &&
    String.fromCharCode(...bytes.subarray(0, 4)) === 'RIFF' &&
    String.fromCharCode(...bytes.subarray(8, 12)) === 'WEBP'
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
