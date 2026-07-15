import type { SupabaseClient } from 'jsr:@supabase/supabase-js@2'

export const LINK_PREVIEW_BUCKET = 'link-preview-thumbnails'
export const MAX_THUMBNAIL_BYTES = 20 * 1024
export const IMMUTABLE_CACHE_SECONDS = 365 * 24 * 60 * 60

const THUMBNAIL_PATH = /^global\/[0-9a-f]{64}\.webp$/

export function isLinkPreviewThumbnailPath(path: unknown): path is string {
  return typeof path === 'string' && THUMBNAIL_PATH.test(path)
}

export function isWebp(bytes: Uint8Array): boolean {
  return (
    bytes.length >= 12 &&
    String.fromCharCode(...bytes.subarray(0, 4)) === 'RIFF' &&
    String.fromCharCode(...bytes.subarray(8, 12)) === 'WEBP'
  )
}

export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))
  return Array.from(digest, (byte) => byte.toString(16).padStart(2, '0')).join('')
}

/**
 * Remove one shared object only when no published note references it.
 *
 * The bytes are retained during deletion and restored if a note reference
 * races with cleanup. Storage operations cannot share a Postgres transaction,
 * so the post-delete reference check closes that otherwise-stale-reference
 * window without granting clients permission to delete global objects.
 */
export async function cleanupUnreferencedLinkPreviewThumbnail(
  supabase: SupabaseClient,
  path: string,
): Promise<boolean> {
  if (!isLinkPreviewThumbnailPath(path)) return false

  const countReferences = async (): Promise<number> => {
    const { count, error } = await supabase
      .from('notes')
      .select('id', { count: 'exact', head: true })
      .eq('link_preview->>thumbnailPath', path)
    if (error) throw new Error(`Failed to count thumbnail references: ${error.message}`)
    return count ?? 0
  }

  if ((await countReferences()) > 0) return false

  const bucket = supabase.storage.from(LINK_PREVIEW_BUCKET)
  const { data: backup, error: downloadError } = await bucket.download(path)
  if (downloadError) {
    if (isMissingObjectError(downloadError)) return true
    // Without the bytes we cannot repair a concurrent reference safely.
    throw new Error(`Failed to prepare thumbnail cleanup: ${downloadError.message}`)
  }
  if ((await countReferences()) > 0) return false

  const { error: removeError } = await bucket.remove([path])
  if (removeError && !isMissingObjectError(removeError)) {
    throw new Error(`Failed to delete thumbnail: ${removeError.message}`)
  }

  if ((await countReferences()) > 0) {
    const { error: restoreError } = await bucket.upload(path, backup, {
      cacheControl: String(IMMUTABLE_CACHE_SECONDS),
      contentType: 'image/webp',
      upsert: false,
    })
    if (restoreError && !isDuplicateObjectError(restoreError)) {
      throw new Error(`Failed to restore concurrently referenced thumbnail: ${restoreError.message}`)
    }
    return false
  }

  return true
}

export function isDuplicateObjectError(error: {
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

function isMissingObjectError(error: {
  status?: number
  statusCode?: string
  message: string
}): boolean {
  return (
    error.status === 404 ||
    ['NoSuchKey', 'NotFound'].includes(error.statusCode ?? '') ||
    /not found|does not exist/i.test(error.message)
  )
}
