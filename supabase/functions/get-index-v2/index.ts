import * as jose from 'https://deno.land/x/jose@v5.2.0/index.ts'
import { createClient } from 'jsr:@supabase/supabase-js@2'

// Mustard official account — always included so every user sees official notes.
// This is the official account's atproto DID. User_ids are opaque UUIDs now, so
// at request time we resolve this DID → its Mustard userId via `identities`.
const MUSTARD_OFFICIAL_DID = 'did:plc:sxwohckesqi25evf7jxfshdz'

const BATCH_SIZE = 200
const MAX_FOLLOWS = 5000

// ─── Types ───────────────────────────────────────────────────────────────────

type Supabase = ReturnType<typeof createClient>

interface IdentityRow {
  provider: string
  provider_account_id: string
}

// A person on some provider, by their external account id (DID / github id).
interface ProviderAccount {
  provider: string
  providerAccountId: string
}

interface NoteRow {
  id: string
  author_id: string
  page_url: string
  updated_at: string
}

interface FollowRecord {
  did: string
  handle: string
}

interface FollowsResponse {
  follows: FollowRecord[]
  cursor?: string
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

// ─── Provider follow fetchers ─────────────────────────────────────────────────
//
// Each fetcher returns ProviderAccount pairs — the canonical external identity
// for each person the user follows on that provider.

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
  supabase: Supabase,
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
  supabase: Supabase,
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
      for (const row of (data ?? []) as { user_id: string }[]) userIds.add(row.user_id)
    }
  }

  return [...userIds]
}

/** Resolve the official Mustard account's userId (skipped if not signed up). */
async function resolveOfficialUserId(supabase: Supabase): Promise<string | undefined> {
  const { data } = await supabase
    .from('identities')
    .select('user_id')
    .eq('provider', 'atproto')
    .eq('provider_account_id', MUSTARD_OFFICIAL_DID)
    .maybeSingle()
  return (data as { user_id: string } | null)?.user_id
}

// ─── Note / visibility queries ─────────────────────────────────────────────────

/** All notes authored by any of `authorIds`. */
async function fetchNotesByAuthors(supabase: Supabase, authorIds: string[]): Promise<NoteRow[]> {
  const notes: NoteRow[] = []
  for (let i = 0; i < authorIds.length; i += BATCH_SIZE) {
    const batch = authorIds.slice(i, i + BATCH_SIZE)
    const { data, error } = await supabase
      .from('notes')
      .select('id, author_id, page_url, updated_at')
      .in('author_id', batch)
    if (error) throw new Error(`Supabase query failed: ${error.message}`)
    notes.push(...((data ?? []) as NoteRow[]))
  }
  return notes
}

/** Note ids that any of `reposterIds` has reposted. */
async function fetchRepostedNoteIds(supabase: Supabase, reposterIds: string[]): Promise<Set<string>> {
  const set = new Set<string>()
  for (let i = 0; i < reposterIds.length; i += BATCH_SIZE) {
    const batch = reposterIds.slice(i, i + BATCH_SIZE)
    const { data, error } = await supabase.from('reposts').select('note_id').in('reposter_id', batch)
    if (error) throw new Error(`Reposts visibility query failed: ${error.message}`)
    for (const row of (data ?? []) as { note_id: string }[]) set.add(row.note_id)
  }
  return set
}

/**
 * Note ids that mention the viewer. mentions[] stores provider account ids
 * (DIDs / github ids), so we test array-overlap (`&&`) against the viewer's own
 * account ids — not their userId.
 */
async function fetchMentionedNoteIds(
  supabase: Supabase,
  viewerAccountIds: string[],
): Promise<Set<string>> {
  const set = new Set<string>()
  if (viewerAccountIds.length === 0) return set

  const noteRes = await supabase.from('notes').select('id').overlaps('mentions', viewerAccountIds)
  if (noteRes.error) throw new Error(`Note-mention visibility query failed: ${noteRes.error.message}`)
  for (const row of (noteRes.data ?? []) as { id: string }[]) set.add(row.id)

  const commentRes = await supabase
    .from('comments')
    .select('note_id')
    .overlaps('mentions', viewerAccountIds)
  if (commentRes.error) {
    throw new Error(`Comment-mention visibility query failed: ${commentRes.error.message}`)
  }
  for (const row of (commentRes.data ?? []) as { note_id: string }[]) set.add(row.note_id)

  return set
}

/** Map of noteId → unique reposter ids, for the given visible note ids. */
async function fetchRepostersByNoteId(
  supabase: Supabase,
  visibleNoteIds: string[],
): Promise<Record<string, string[]>> {
  const repostersByNoteId: Record<string, string[]> = {}
  for (let i = 0; i < visibleNoteIds.length; i += BATCH_SIZE) {
    const batch = visibleNoteIds.slice(i, i + BATCH_SIZE)
    const { data, error } = await supabase
      .from('reposts')
      .select('note_id, reposter_id')
      .in('note_id', batch)
    if (error) throw new Error(`Reposters query failed: ${error.message}`)
    for (const row of (data ?? []) as { note_id: string; reposter_id: string }[]) {
      const list = (repostersByNoteId[row.note_id] ??= [])
      if (!list.includes(row.reposter_id)) list.push(row.reposter_id)
    }
  }
  return repostersByNoteId
}

/** Count of the viewer's unread notifications, keyed by the page their note is on. */
async function fetchUnreadByPage(
  supabase: Supabase,
  userId: string,
  myNotePageById: Map<string, string>,
): Promise<Record<string, number>> {
  const myUnreadByPage: Record<string, number> = {}
  if (myNotePageById.size === 0) return myUnreadByPage

  const { data, error } = await supabase
    .from('notifications')
    .select('note_id')
    .eq('recipient_id', userId)
  if (error) throw new Error(`Failed to query notifications: ${error.message}`)

  for (const row of (data ?? []) as { note_id: string }[]) {
    const pageUrl = myNotePageById.get(row.note_id)
    if (!pageUrl) continue
    myUnreadByPage[pageUrl] = (myUnreadByPage[pageUrl] ?? 0) + 1
  }
  return myUnreadByPage
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

    await verifyRequest(req, userId)

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    )

    // ── Step 1: this user's linked provider identities ────────────────────────
    const { data: identitiesData, error: identitiesError } = await supabase
      .from('identities')
      .select('provider, provider_account_id')
      .eq('user_id', userId)
    if (identitiesError) throw new Error(`Failed to fetch identities: ${identitiesError.message}`)
    const userIdentities: IdentityRow[] = (identitiesData ?? []) as IdentityRow[]

    // The viewer's own provider account ids — used for mention visibility.
    const viewerAccountIds = userIdentities.map((i) => i.provider_account_id)

    // ── Step 2: fetch follows from every provider in parallel ─────────────────
    // Degrade gracefully per-provider: a dead/revoked token (e.g. github 401)
    // must not reject the whole index and blank out every note — including the
    // viewer's own and their other providers' follows. A failed provider just
    // contributes no follows.
    const followLists = await Promise.all(
      userIdentities.map((identity) =>
        fetchFollowsForIdentity(identity, supabase).catch((err) => {
          console.warn(
            `[get-index-v2] follows fetch failed for ${identity.provider}:${identity.provider_account_id}:`,
            err,
          )
          return [] as ProviderAccount[]
        }),
      ),
    )
    const allFollows = followLists.flat()

    // ── Step 3: resolve followed accounts → Mustard userIds ───────────────────
    const followedUserIds = await resolveFollowsToUserIds(allFollows, supabase)
    const officialUserId = await resolveOfficialUserId(supabase)

    const allUserIds = [userId, ...followedUserIds, ...(officialUserId ? [officialUserId] : [])]

    // ── Step 4: notes by visible authors → page index + own-note bookkeeping ──
    const notes = await fetchNotesByAuthors(supabase, allUserIds)

    const index: Record<string, string[]> = {}
    const latestNoteAtByPage: Record<string, number> = {}
    const myNotePageById = new Map<string, string>()

    for (const note of notes) {
      const pages = (index[note.author_id] ??= [])
      if (!pages.includes(note.page_url)) pages.push(note.page_url)

      if (note.author_id === userId) {
        const ts = new Date(note.updated_at).getTime()
        const existing = latestNoteAtByPage[note.page_url]
        if (existing === undefined || ts > existing) latestNoteAtByPage[note.page_url] = ts
        myNotePageById.set(note.id, note.page_url)
      }
    }

    // ── Step 5-6: reposted + mentioned note ids ───────────────────────────────
    const repostedNoteIdSet = await fetchRepostedNoteIds(supabase, allUserIds)
    const mentionedNoteIdSet = await fetchMentionedNoteIds(supabase, viewerAccountIds)

    // ── Step 7: full reposter list for every visible note ─────────────────────
    const visibleNoteIdSet = new Set<string>(repostedNoteIdSet)
    for (const note of notes) visibleNoteIdSet.add(note.id)
    for (const id of mentionedNoteIdSet) visibleNoteIdSet.add(id)
    const repostersByNoteId = await fetchRepostersByNoteId(supabase, [...visibleNoteIdSet])

    // ── Step 8: unread notifications per page ─────────────────────────────────
    const myUnreadByPage = await fetchUnreadByPage(supabase, userId, myNotePageById)

    return json({
      index,
      myUnreadByPage,
      latestNoteAtByPage,
      repostedNoteIds: [...repostedNoteIdSet],
      mentionedNoteIds: [...mentionedNoteIdSet],
      repostersByNoteId,
    })
  } catch (error) {
    if (error instanceof HttpError) return json({ error: error.message }, error.status)
    console.error('Error in get-index-v2:', error)
    return json({ error: error instanceof Error ? error.message : 'Internal server error' }, 500)
  }
})
