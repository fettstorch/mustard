import * as jose from 'https://deno.land/x/jose@v5.2.0/index.ts'
import { createClient } from 'jsr:@supabase/supabase-js@2'
import type { SupabaseClient } from 'jsr:@supabase/supabase-js@2'

const BATCH_SIZE = 200
const MAX_FOLLOWS = 5000

// Refresh a user's follow graph at most hourly. Between refreshes the index is
// served entirely from Postgres (follows_cache + get_index_payload) — zero
// external API calls on the hot path.
const FOLLOWS_TTL_MS = 60 * 60 * 1000
// Claim-loser poll on a cold cache: 20 × 500ms = 10s max.
const COLD_WAIT_ATTEMPTS = 20
const COLD_WAIT_INTERVAL_MS = 500

// Supabase's deployed edge runtime exposes EdgeRuntime for background tasks;
// local `supabase functions serve` may not.
declare const EdgeRuntime: { waitUntil(promise: Promise<unknown>): void } | undefined

// ─── Types ───────────────────────────────────────────────────────────────────

interface IdentityRow {
  provider: string
  provider_account_id: string
}

// A person on some provider, by their external account id (DID / github id).
interface ProviderAccount {
  provider: string
  providerAccountId: string
}

interface FollowRecord {
  did: string
  handle: string
}

interface FollowsResponse {
  follows: FollowRecord[]
  cursor?: string
}

/**
 * Shape returned by the get_index_payload RPC (migration 015). Everything
 * except followsFetchedAt is the client-facing response contract.
 */
interface IndexPayload {
  index: Record<string, string[]>
  myUnreadByPage: Record<string, number>
  latestNoteAtByPage: Record<string, number>
  repostedNoteIds: string[]
  mentionedNoteIds: string[]
  repostersByNoteId: Record<string, string[]>
  followsFetchedAt: string | null
}

// Thrown by helpers to short-circuit with a specific HTTP status; mapped to a
// response by the top-level handler. Anything else becomes a 500.
class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message)
  }
}

// ─── HTTP helpers ──────────────────────────────────────────────────────────────

const CORS_PREFLIGHT_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
  })
}

// ─── Auth ───────────────────────────────────────────────────────────────────

/** Verify the Bearer JWT and that its subject matches the requested userId. */
async function verifyRequest(req: Request, userId: string): Promise<void> {
  const [scheme, token] = (req.headers.get('Authorization') ?? '').split(' ')
  if (scheme !== 'Bearer' || !token) throw new HttpError(401, 'Unauthorized')

  const jwtSecret = Deno.env.get('JWT_SIGNING_SECRET')
  if (!jwtSecret) throw new Error('JWT_SIGNING_SECRET not configured')

  let sub: string | undefined
  try {
    const { payload } = await jose.jwtVerify(token, new TextEncoder().encode(jwtSecret))
    sub = typeof payload.sub === 'string' ? payload.sub : undefined
  } catch {
    throw new HttpError(401, 'Unauthorized')
  }
  if (sub !== userId) throw new HttpError(403, 'userId does not match authenticated user')
}

// ─── Supabase client (module scope: reused across requests) ──────────────────

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
)

// ─── Provider follow fetchers ─────────────────────────────────────────────────
//
// Each fetcher returns ProviderAccount pairs — the canonical external identity
// for each person the user follows on that provider. These run only inside
// refreshFollows (at most once per user per FOLLOWS_TTL_MS), never per request.

/** Fetch all accounts the user follows on Bluesky (paginated, capped). */
async function fetchAtprotoFollows(did: string): Promise<ProviderAccount[]> {
  const result: ProviderAccount[] = []
  let cursor: string | undefined

  do {
    const params = new URLSearchParams({ actor: did, limit: '100' })
    if (cursor) params.set('cursor', cursor)

    const resp = await fetch(`https://public.api.bsky.app/xrpc/app.bsky.graph.getFollows?${params}`)
    if (!resp.ok) throw new Error(`Failed to fetch Bluesky follows: ${resp.statusText}`)

    const data: FollowsResponse = await resp.json()
    for (const f of data.follows) {
      result.push({ provider: 'atproto', providerAccountId: f.did })
    }
    cursor = data.cursor
  } while (cursor && result.length < MAX_FOLLOWS)

  return result
}

/** Fetch all accounts the user follows on GitHub (paginated, capped). */
async function fetchGithubFollows(accessToken: string): Promise<ProviderAccount[]> {
  const result: ProviderAccount[] = []
  let page = 1

  while (result.length < MAX_FOLLOWS) {
    const resp = await fetch(`https://api.github.com/user/following?per_page=100&page=${page}`, {
      headers: { Authorization: `Bearer ${accessToken}`, 'User-Agent': 'Mustard' },
    })
    if (!resp.ok) throw new Error(`Failed to fetch GitHub follows: ${resp.statusText}`)

    const data: Array<{ id: number; login: string }> = await resp.json()
    if (data.length === 0) break

    for (const u of data) {
      result.push({ provider: 'github', providerAccountId: String(u.id) })
    }

    // GitHub uses Link header pagination; if fewer results than per_page, we're done.
    if (data.length < 100) break
    page++
  }

  return result
}

/** Fetch the accounts a single linked identity follows on its provider. */
async function fetchFollowsForIdentity(
  identity: IdentityRow,
  supabase: SupabaseClient,
): Promise<ProviderAccount[]> {
  if (identity.provider === 'atproto') {
    return fetchAtprotoFollows(identity.provider_account_id)
  }
  if (identity.provider === 'github') {
    // GitHub follows require the user's authenticated access token.
    const { data: sessionRow } = await supabase
      .from('oauth_session')
      .select('access_token')
      .eq('provider', 'github')
      .eq('provider_account_id', identity.provider_account_id)
      .maybeSingle()
    const accessToken = sessionRow?.access_token as string | undefined
    return accessToken ? fetchGithubFollows(accessToken) : []
  }
  // Unknown provider — nothing to fetch (add more providers above as supported).
  return []
}

// ─── Identity → userId resolution ─────────────────────────────────────────────

/**
 * Maps ProviderAccount pairs to Mustard userIds via the `identities` table.
 * Pairs with no Mustard account yet are silently dropped (those people haven't
 * signed up for Mustard). PostgREST has no good multi-column IN, so we query
 * per-provider and union client-side (most users have only 1-2 providers).
 */
async function resolveFollowsToUserIds(
  follows: ProviderAccount[],
  supabase: SupabaseClient,
): Promise<string[]> {
  if (follows.length === 0) return []

  const userIds = new Set<string>()

  for (let i = 0; i < follows.length; i += BATCH_SIZE) {
    const batch = follows.slice(i, i + BATCH_SIZE)

    const byProvider = new Map<string, string[]>()
    for (const f of batch) {
      const ids = byProvider.get(f.provider) ?? []
      ids.push(f.providerAccountId)
      byProvider.set(f.provider, ids)
    }

    for (const [provider, accountIds] of byProvider) {
      const { data, error } = await supabase
        .from('identities')
        .select('user_id')
        .eq('provider', provider)
        .in('provider_account_id', accountIds)

      if (error) throw new Error(`identities lookup failed: ${error.message}`)
      // supabase-js rows are untyped for an untyped client; the row shape is the select above.
      const rows = (data ?? []) as { user_id: string }[]
      for (const row of rows) userIds.add(row.user_id)
    }
  }

  return [...userIds]
}

// ─── Follows cache (stale-while-revalidate) ────────────────────────────────────

/** One round-trip: the full index payload computed in SQL (migration 015). */
async function fetchPayload(userId: string): Promise<IndexPayload> {
  const { data, error } = await supabase.rpc('get_index_payload', { p_user_id: userId })
  if (error) throw new Error(`get_index_payload failed: ${error.message}`)
  // supabase-js types rpc() results as generic Json; the shape is defined by
  // the get_index_payload function (migration 015).
  const payload = data as IndexPayload
  return payload
}

/** True when this instance won the refresh claim (row inserted or stale claim taken over). */
async function claimRefresh(userId: string): Promise<boolean> {
  const { data, error } = await supabase.rpc('claim_follows_refresh', { p_user_id: userId })
  if (error) throw new Error(`claim_follows_refresh failed: ${error.message}`)
  return data === true
}

/**
 * Fetch follows from every linked provider, resolve to Mustard userIds, store
 * in follows_cache and release the claim. On failure: release the claim but
 * keep the previous row (stale data beats no data); the next request after the
 * claim window retries. Never throws.
 */
async function refreshFollows(userId: string): Promise<void> {
  try {
    const { data, error } = await supabase
      .from('identities')
      .select('provider, provider_account_id')
      .eq('user_id', userId)
    if (error) throw new Error(`identities fetch failed: ${error.message}`)
    const identities = (data ?? []) as IdentityRow[]

    // Per-provider graceful degrade: a dead github token contributes []
    // instead of failing the whole refresh.
    const followLists = await Promise.all(
      identities.map((identity) =>
        fetchFollowsForIdentity(identity, supabase).catch((err) => {
          console.warn(
            `[get-index-v2] follows fetch failed for ${identity.provider}:${identity.provider_account_id}:`,
            err,
          )
          return [] as ProviderAccount[]
        }),
      ),
    )
    const followedUserIds = await resolveFollowsToUserIds(followLists.flat(), supabase)

    const { error: upsertError } = await supabase.from('follows_cache').upsert({
      user_id: userId,
      followed_user_ids: followedUserIds,
      fetched_at: new Date().toISOString(),
      refresh_started_at: null,
    })
    if (upsertError) throw new Error(`follows_cache upsert failed: ${upsertError.message}`)
  } catch (err) {
    console.error('[get-index-v2] follows refresh failed:', err)
    await supabase.from('follows_cache').update({ refresh_started_at: null }).eq('user_id', userId)
  }
}

function delay(ms: number): Promise<void> {
  const { promise, resolve } = Promise.withResolvers<void>()
  setTimeout(resolve, ms)
  return promise
}

/** Claim-loser path on cold cache: poll until the winner's refresh lands (≤10s). */
async function waitForFreshCache(userId: string): Promise<boolean> {
  for (let i = 0; i < COLD_WAIT_ATTEMPTS; i++) {
    await delay(COLD_WAIT_INTERVAL_MS)
    const { data } = await supabase
      .from('follows_cache')
      .select('fetched_at')
      .eq('user_id', userId)
      .maybeSingle()
    if (data?.fetched_at) return true
  }
  return false
}

/** Deployed Supabase edge runtime: keep the promise alive past the response. Local serve: fire-and-forget. */
function runInBackground(promise: Promise<unknown>): void {
  if (typeof EdgeRuntime !== 'undefined' && EdgeRuntime) {
    EdgeRuntime.waitUntil(promise)
  } else {
    promise.catch((err) => console.warn('[get-index-v2] background refresh failed:', err))
  }
}

// ─── Main handler ─────────────────────────────────────────────────────────────

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: CORS_PREFLIGHT_HEADERS })
  }
  if (req.method !== 'POST') {
    return json({ error: 'Method not allowed' }, 405)
  }

  try {
    const body = await req.json()
    const userId: string = body.userId
    if (!userId || typeof userId !== 'string') throw new HttpError(400, 'userId is required')
    // p_user_id is cast to uuid in SQL; reject junk early with a 400 instead of a 500.
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(userId)) {
      throw new HttpError(400, 'userId must be a UUID')
    }

    await verifyRequest(req, userId)

    let payload = await fetchPayload(userId)
    const fetchedAtMs = payload.followsFetchedAt ? Date.parse(payload.followsFetchedAt) : null

    if (fetchedAtMs === null) {
      // Cold: this user's follows were never fetched. Block — an empty index on
      // first login is worse than a slow first response.
      if (await claimRefresh(userId)) {
        await refreshFollows(userId)
        payload = await fetchPayload(userId)
      } else if (await waitForFreshCache(userId)) {
        payload = await fetchPayload(userId)
      }
      // If the wait timed out: serve the (empty-follows) payload; the client
      // retries within its own TTL.
    } else if (Date.now() - fetchedAtMs > FOLLOWS_TTL_MS) {
      // Stale: serve immediately, refresh in the background (SWR).
      if (await claimRefresh(userId)) {
        runInBackground(refreshFollows(userId))
      }
    }

    const { followsFetchedAt: _stripped, ...response } = payload
    return json(response)
  } catch (error) {
    if (error instanceof HttpError) return json({ error: error.message }, error.status)
    console.error('Error in get-index-v2:', error)
    return json({ error: error instanceof Error ? error.message : 'Internal server error' }, 500)
  }
})
