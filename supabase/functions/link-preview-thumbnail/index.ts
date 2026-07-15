import * as jose from 'https://deno.land/x/jose@v5.2.0/index.ts'
import { createClient } from 'jsr:@supabase/supabase-js@2'
import {
  cleanupUnreferencedLinkPreviewThumbnail,
  IMMUTABLE_CACHE_SECONDS,
  isDuplicateObjectError,
  isLinkPreviewThumbnailPath,
  isWebp,
  LINK_PREVIEW_BUCKET,
  MAX_THUMBNAIL_BYTES,
  sha256Hex,
} from '../_shared/link-preview-thumbnails.ts'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const MAX_REQUEST_CHARS = 32 * 1024

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
}

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
)

class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message)
  }
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
  })
}

async function verifyRequest(req: Request): Promise<string> {
  const [scheme, token] = (req.headers.get('Authorization') ?? '').split(' ')
  if (scheme !== 'Bearer' || !token) throw new HttpError(401, 'Unauthorized')

  const jwtSecret = Deno.env.get('JWT_SIGNING_SECRET')
  if (!jwtSecret) throw new Error('JWT_SIGNING_SECRET not configured')

  try {
    const { payload } = await jose.jwtVerify(token, new TextEncoder().encode(jwtSecret))
    if (typeof payload.sub !== 'string' || !UUID_RE.test(payload.sub)) {
      throw new HttpError(401, 'Unauthorized')
    }
    return payload.sub
  } catch (error) {
    if (error instanceof HttpError) throw error
    throw new HttpError(401, 'Unauthorized')
  }
}

async function parseBody(req: Request): Promise<Record<string, unknown>> {
  const body = await req.text()
  if (body.length > MAX_REQUEST_CHARS) throw new HttpError(413, 'Request too large')
  try {
    const parsed = JSON.parse(body)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('not an object')
    }
    return parsed as Record<string, unknown>
  } catch {
    throw new HttpError(400, 'Invalid JSON body')
  }
}

function decodeBase64(value: unknown): Uint8Array {
  if (typeof value !== 'string' || !/^[a-z\d+/]+={0,2}$/i.test(value)) {
    throw new HttpError(400, 'Invalid thumbnail data')
  }
  try {
    const binary = atob(value)
    if (binary.length > MAX_THUMBNAIL_BYTES) throw new HttpError(413, 'Thumbnail too large')
    const bytes = new Uint8Array(binary.length)
    for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index)
    if (!isWebp(bytes)) throw new HttpError(400, 'Thumbnail must be a WebP image')
    return bytes
  } catch (error) {
    if (error instanceof HttpError) throw error
    throw new HttpError(400, 'Invalid thumbnail data')
  }
}

async function ensureThumbnail(
  userId: string,
  path: unknown,
  imageBase64: unknown,
): Promise<Response> {
  if (!isLinkPreviewThumbnailPath(path)) throw new HttpError(400, 'Invalid thumbnail path')

  const bytes = decodeBase64(imageBase64)
  const expectedPath = `global/${await sha256Hex(bytes)}.webp`
  if (path !== expectedPath) throw new HttpError(400, 'Thumbnail hash does not match its path')

  const { count, error: referenceError } = await supabase
    .from('notes')
    .select('id', { count: 'exact', head: true })
    .eq('author_id', userId)
    .eq('link_preview->>thumbnailPath', path)
  if (referenceError) throw new Error(`Failed to verify note reference: ${referenceError.message}`)
  if ((count ?? 0) === 0) throw new HttpError(403, 'No owned note references this thumbnail')

  const bucket = supabase.storage.from(LINK_PREVIEW_BUCKET)
  const { error } = await bucket.upload(path, bytes, {
    cacheControl: String(IMMUTABLE_CACHE_SECONDS),
    contentType: 'image/webp',
    upsert: false,
  })
  if (error && !isDuplicateObjectError(error)) {
    throw new Error(`Failed to store thumbnail: ${error.message}`)
  }
  return json({ stored: true, reused: !!error })
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS })
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)

  try {
    const userId = await verifyRequest(req)
    const body = await parseBody(req)
    if (body.action === 'ensure') {
      return await ensureThumbnail(userId, body.path, body.imageBase64)
    }
    if (body.action === 'cleanup') {
      if (!isLinkPreviewThumbnailPath(body.path)) {
        throw new HttpError(400, 'Invalid thumbnail path')
      }
      const deleted = await cleanupUnreferencedLinkPreviewThumbnail(supabase, body.path)
      return json({ deleted })
    }
    throw new HttpError(400, 'Unknown action')
  } catch (error) {
    const status = error instanceof HttpError ? error.status : 500
    const message = error instanceof Error ? error.message : 'Unknown error'
    if (status >= 500) console.error('[link-preview-thumbnail]', error)
    return json({ error: status >= 500 ? 'Internal server error' : message }, status)
  }
})
