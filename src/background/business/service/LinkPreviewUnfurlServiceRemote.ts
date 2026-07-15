/**
 * Remote author-side link unfurling.
 *
 * This service fetches the first HTTP(S) page in a note, sanitizes its Open
 * Graph metadata, and converts its image to a small CSP-safe WebP data URI. It
 * never persists previews; local-note storage and remote-note publication own
 * that responsibility.
 */
import { extractFirstLinkUrl, extractLinkPreview, normalizeHttpUrl } from '@/shared/link-preview'
import type { LinkPreview } from '@/shared/model/LinkPreview'
import { cached } from '@fettstorch/jule'

const PREVIEW_TIMEOUT_MS = 4_000
const MAX_HTML_BYTES = 256 * 1024
// Source images can be several hundred KB even when the card only needs a
// thumbnail. Download a bounded source, then immediately resize it before it
// crosses the extension boundary or reaches storage.
const MAX_IMAGE_SOURCE_BYTES = 2 * 1024 * 1024
const MAX_THUMBNAIL_BYTES = 20 * 1024
const THUMBNAIL_MAX_SIDE_PX = 128
const PREVIEW_CACHE_TTL_MS = 5 * 60 * 1000
const MAX_DATA_URL_LENGTH = Math.ceil((MAX_THUMBNAIL_BYTES * 4) / 3) + 100
const THUMBNAIL_DATA_URL = /^data:(image\/webp);base64,([a-z\d+/]+={0,2})$/i

/**
 * Fetch Open Graph metadata from the extension context, never the content
 * script. This is intentionally author-initiated; publishing a note does not
 * make Mustard's backend fetch an attacker-provided URL.
 */
export async function unfurlLinkPreview(content: string): Promise<LinkPreview | undefined> {
  const linkUrl = extractFirstLinkUrl(content)
  if (!linkUrl || !isSafePreviewUrl(linkUrl)) return undefined

  return loadRemoteMetadata(linkUrl)
}

/**
 * Reuse editor metadata during save/publish and coalesce concurrent requests for
 * the same normalized URL. Failures resolve to undefined, so no rejected promise
 * is retained by jule's async cache.
 */
const loadRemoteMetadata = cached(
  async (linkUrl: string): Promise<LinkPreview | undefined> => {
    try {
      const response = await fetchWithSafeFinalUrl(linkUrl, 'text/html,application/xhtml+xml')
      if (!response || !response.ok) return undefined
      const contentType = response.headers.get('content-type')?.toLowerCase() ?? ''
      if (
        contentType &&
        !contentType.includes('text/html') &&
        !contentType.includes('application/xhtml+xml')
      ) {
        return undefined
      }
      const html = await readTextWithinLimit(response, MAX_HTML_BYTES)
      return html ? extractLinkPreview(html, linkUrl, response.url || linkUrl) : undefined
    } catch (error) {
      console.debug('mustard [link-preview] metadata fetch failed:', error)
      return undefined
    }
  },
  { ttlMs: PREVIEW_CACHE_TTL_MS },
)

/**
 * Accept an editor-provided preview only after revalidating its first-link
 * relationship and bounded plain-data fields. Otherwise recreate it in the
 * background. The data URL is safe to reuse because only bitmap MIME types and
 * the thumbnail byte budget are accepted.
 */
export async function resolveLinkPreviewForNote(
  content: string,
  supplied?: LinkPreview,
): Promise<LinkPreview | undefined> {
  const expectedUrl = extractFirstLinkUrl(content)
  if (!expectedUrl) return undefined
  const sanitized = sanitizeAuthoredPreview(supplied, expectedUrl)
  if (sanitized?.imageDataUrl || (sanitized && !sanitized.imageUrl)) return sanitized
  return hydrateLinkPreviewImage((await unfurlLinkPreview(expectedUrl)) ?? sanitized)
}

/** Adds a CSP-safe thumbnail when one is available; failures leave the card text-only. */
async function hydrateLinkPreviewImage(preview?: LinkPreview): Promise<LinkPreview | undefined> {
  if (!preview?.imageUrl || preview.imageDataUrl || !isSafePreviewUrl(preview.imageUrl))
    return preview

  const imageDataUrl = await loadSourceThumbnail(preview.imageUrl)
  return imageDataUrl ? { ...preview, imageDataUrl } : preview
}

const loadSourceThumbnail = cached(
  async (imageUrl: string): Promise<string | undefined> => {
    try {
      const response = await fetchWithSafeFinalUrl(
        imageUrl,
        'image/avif,image/webp,image/png,image/jpeg,image/gif',
      )
      if (!response?.ok) return undefined
      const mimeType =
        (response.headers.get('content-type') ?? '').split(';')[0]?.toLowerCase() ?? ''
      if (
        !['image/avif', 'image/webp', 'image/png', 'image/jpeg', 'image/gif'].includes(mimeType)
      ) {
        return undefined
      }
      const bytes = await readBytesWithinLimit(response, MAX_IMAGE_SOURCE_BYTES)
      return bytes ? createThumbnailDataUrl(bytes, mimeType) : undefined
    } catch (error) {
      console.debug('mustard [link-preview] image fetch failed:', error)
      return undefined
    }
  },
  { ttlMs: PREVIEW_CACHE_TTL_MS },
)

function sanitizeAuthoredPreview(
  value: LinkPreview | undefined,
  expectedUrl: string,
): LinkPreview | undefined {
  const url = value && normalizeHttpUrl(value.url)
  if (!value || url !== expectedUrl) return undefined
  const optionalText = (item: unknown, maxLength: number): string | undefined =>
    typeof item === 'string' ? item.trim().slice(0, maxLength) || undefined : undefined
  const imageUrl =
    typeof value.imageUrl === 'string' && isSafePreviewUrl(value.imageUrl)
      ? normalizeHttpUrl(value.imageUrl)
      : undefined
  const imageDataUrl =
    typeof value.imageDataUrl === 'string' &&
    value.imageDataUrl.length <= MAX_DATA_URL_LENGTH &&
    THUMBNAIL_DATA_URL.test(value.imageDataUrl)
      ? value.imageDataUrl
      : undefined

  return {
    url,
    ...(optionalText(value.title, 200) ? { title: optionalText(value.title, 200) } : {}),
    ...(optionalText(value.description, 300)
      ? { description: optionalText(value.description, 300) }
      : {}),
    ...(optionalText(value.siteName, 80) ? { siteName: optionalText(value.siteName, 80) } : {}),
    ...(imageUrl ? { imageUrl } : {}),
    ...(imageDataUrl ? { imageDataUrl } : {}),
  }
}

/**
 * A content-script image must be a data URI to survive arbitrary host CSPs.
 * Re-encode it at card scale so a 500 KB Open Graph source does not consume
 * the extension's storage quota or bloat runtime messages.
 */
async function createThumbnailDataUrl(
  source: Uint8Array,
  mimeType: string,
): Promise<string | undefined> {
  if (typeof createImageBitmap !== 'function' || typeof OffscreenCanvas === 'undefined') {
    return mimeType === 'image/webp' && source.byteLength <= MAX_THUMBNAIL_BYTES
      ? `data:${mimeType};base64,${toBase64(source)}`
      : undefined
  }

  let bitmap: ImageBitmap | undefined
  try {
    // Copy into an ordinary ArrayBuffer. `Uint8Array` from Fetch is typed as
    // possibly SharedArrayBuffer-backed, which Blob deliberately rejects.
    const sourceCopy = new Uint8Array(source.byteLength)
    sourceCopy.set(source)
    bitmap = await createImageBitmap(new Blob([sourceCopy.buffer], { type: mimeType }))
    const scale = Math.min(1, THUMBNAIL_MAX_SIDE_PX / Math.max(bitmap.width, bitmap.height))
    const width = Math.max(1, Math.round(bitmap.width * scale))
    const height = Math.max(1, Math.round(bitmap.height * scale))
    const canvas = new OffscreenCanvas(width, height)
    const context = canvas.getContext('2d')
    if (!context) return undefined
    context.drawImage(bitmap, 0, 0, width, height)
    const thumbnail = await canvas.convertToBlob({ type: 'image/webp', quality: 0.72 })
    if (thumbnail.size > MAX_THUMBNAIL_BYTES || thumbnail.type !== 'image/webp') return undefined
    return `data:${thumbnail.type};base64,${toBase64(new Uint8Array(await thumbnail.arrayBuffer()))}`
  } catch (error) {
    console.debug('mustard [link-preview] thumbnail conversion failed:', error)
    return undefined
  } finally {
    bitmap?.close()
  }
}

function isSafePreviewUrl(value: string): boolean {
  const normalized = normalizeHttpUrl(value)
  if (!normalized) return false
  const url = new URL(normalized)
  if (url.port && url.port !== '80' && url.port !== '443') return false
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, '')
  if (
    host === 'localhost' ||
    host.endsWith('.localhost') ||
    host.endsWith('.local') ||
    host.endsWith('.internal')
  ) {
    return false
  }
  return !isPrivateIpAddress(host)
}

function isPrivateIpAddress(host: string): boolean {
  if (
    host === '::1' ||
    host === '::' ||
    host.startsWith('fe80:') ||
    host.startsWith('fc') ||
    host.startsWith('fd')
  ) {
    return true
  }
  const parts = host.split('.')
  if (parts.length !== 4 || parts.some((part) => !/^\d+$/.test(part))) return false
  const octets = parts.map(Number)
  if (octets.some((part) => part > 255)) return true
  const a = octets[0] ?? -1
  const b = octets[1] ?? -1
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168)
  )
}

/**
 * Browser Fetch intentionally hides `Location` on `redirect: 'manual'`
 * responses, so an extension cannot safely walk a redirect chain itself. Keep
 * this author-initiated and credential-free, let Fetch follow ordinary web
 * redirects, then reject an unsafe final target before reading its body.
 */
async function fetchWithSafeFinalUrl(url: string, accept: string): Promise<Response | undefined> {
  if (!isSafePreviewUrl(url)) return undefined
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), PREVIEW_TIMEOUT_MS)
  try {
    const response = await fetch(url, {
      headers: { Accept: accept },
      credentials: 'omit',
      redirect: 'follow',
      referrerPolicy: 'no-referrer',
      signal: controller.signal,
    })
    return response.url && isSafePreviewUrl(response.url) ? response : undefined
  } finally {
    clearTimeout(timeout)
  }
}

async function readTextWithinLimit(
  response: Response,
  maxBytes: number,
): Promise<string | undefined> {
  const bytes = await readBytesWithinLimit(response, maxBytes)
  return bytes ? new TextDecoder().decode(bytes) : undefined
}

async function readBytesWithinLimit(
  response: Response,
  maxBytes: number,
): Promise<Uint8Array | undefined> {
  const contentLength = Number(response.headers.get('content-length'))
  if (Number.isFinite(contentLength) && contentLength > maxBytes) return undefined
  if (!response.body) return undefined

  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let size = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      size += value.byteLength
      if (size > maxBytes) {
        await reader.cancel()
        return undefined
      }
      chunks.push(value)
    }
  } finally {
    reader.releaseLock()
  }

  const bytes = new Uint8Array(size)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  return bytes
}

function toBase64(bytes: Uint8Array): string {
  let binary = ''
  const CHUNK_SIZE = 0x8000
  for (let start = 0; start < bytes.length; start += CHUNK_SIZE) {
    binary += String.fromCharCode(...bytes.subarray(start, start + CHUNK_SIZE))
  }
  return btoa(binary)
}
