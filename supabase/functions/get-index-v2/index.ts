import * as jose from 'https://deno.land/x/jose@v5.2.0/index.ts'
import { createClient } from 'jsr:@supabase/supabase-js@2'

// Mustard official account — always included so every user sees official notes
const MUSTARD_OFFICIAL_DID = 'did:plc:sxwohckesqi25evf7jxfshdz'

interface FollowRecord {
  did: string
  handle: string
  // ... other fields we don't need
}

interface FollowsResponse {
  follows: FollowRecord[]
  cursor?: string
}

Deno.serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      },
    })
  }

  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  try {
    const { did } = await req.json()

    if (!did || typeof did !== 'string') {
      return new Response(JSON.stringify({ error: 'Invalid request: did is required' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      })
    }

    const authHeader = req.headers.get('Authorization') ?? ''
    const [scheme, token] = authHeader.split(' ')
    if (scheme !== 'Bearer' || !token) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      })
    }

    const jwtSecret = Deno.env.get('JWT_SIGNING_SECRET')
    if (!jwtSecret) throw new Error('JWT_SIGNING_SECRET not configured')

    let authenticatedDid: string | undefined
    try {
      const { payload } = await jose.jwtVerify(token, new TextEncoder().encode(jwtSecret))
      authenticatedDid = typeof payload.sub === 'string' ? payload.sub : undefined
    } catch {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      })
    }

    if (authenticatedDid !== did) {
      return new Response(JSON.stringify({ error: 'DID does not match authenticated user' }), {
        status: 403,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      })
    }

    // Fetch the user's follows from Bluesky (paginated, capped at 5000)
    const MAX_FOLLOWS = 5000
    const followedDids: string[] = []
    let cursor: string | undefined

    do {
      const params = new URLSearchParams({ actor: did, limit: '100' })
      if (cursor) params.set('cursor', cursor)

      const followsResponse = await fetch(
        `https://public.api.bsky.app/xrpc/app.bsky.graph.getFollows?${params}`,
      )

      if (!followsResponse.ok) {
        throw new Error(`Failed to fetch follows: ${followsResponse.statusText}`)
      }

      const followsData: FollowsResponse = await followsResponse.json()
      followedDids.push(...followsData.follows.map((f) => f.did))
      cursor = followsData.cursor
    } while (cursor && followedDids.length < MAX_FOLLOWS)

    // Include the user's own DID + the official Mustard account
    const allDids = [did, ...followedDids, MUSTARD_OFFICIAL_DID]

    // Query Supabase for notes from these authors
    const supabaseUrl = Deno.env.get('SUPABASE_URL')
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')

    if (!supabaseUrl || !supabaseServiceKey) {
      throw new Error('Supabase environment variables not configured')
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey)

    // Query in batches of 200 to avoid PostgREST URI length limits.
    // We also pull `updated_at` so we can compute the requesting user's own
    // latestNoteAtByPage map (and `id` so the notification join doesn't have
    // to re-fetch notes).
    const BATCH_SIZE = 200
    const notes: { id: string; author_id: string; page_url: string; updated_at: string }[] = []

    for (let i = 0; i < allDids.length; i += BATCH_SIZE) {
      const batch = allDids.slice(i, i + BATCH_SIZE)
      const { data, error } = await supabase
        .from('notes')
        .select('id, author_id, page_url, updated_at')
        .in('author_id', batch)

      if (error) {
        throw new Error(`Supabase query failed: ${error.message}`)
      }

      notes.push(...(data || []))
    }

    // Build index: Map<UserId, PageUrl[]>
    const index: Record<string, string[]> = {}
    // For the requesting user only: pageUrl → max(updated_at) across my notes
    const latestNoteAtByPage: Record<string, number> = {}
    // For the requesting user only: noteId → pageUrl (used to bucket unread
    // notification counts by page below).
    const myNotePageById = new Map<string, string>()

    for (const note of notes) {
      if (!index[note.author_id]) {
        index[note.author_id] = []
      }
      if (!index[note.author_id].includes(note.page_url)) {
        index[note.author_id].push(note.page_url)
      }

      if (note.author_id === did) {
        const ts = new Date(note.updated_at).getTime()
        const existing = latestNoteAtByPage[note.page_url]
        if (existing === undefined || ts > existing) {
          latestNoteAtByPage[note.page_url] = ts
        }
        myNotePageById.set(note.id, note.page_url)
      }
    }

    // Reposts have TWO independent roles, deliberately decoupled below:
    //
    //   1. VISIBILITY (scoped to my network): a note becomes visible to me only
    //      when I — or someone I follow — reposted it. This MUST stay scoped so I
    //      never inherit a stranger's OTHER notes (a repost is a per-note grant,
    //      not a follow). We layer it alongside the author index (NOT merged into
    //      it): merging the original author would over-fetch ALL of that author's
    //      notes on the page, leaking notes that weren't reposted.
    //
    //   2. SOCIAL PROOF (global): once a note is visible to me, the avatar stack
    //      should show EVERY reposter — including reposters I don't follow — so the
    //      "reposted by …" signal reflects reality. This widens only the displayed
    //      avatars, never the index/visibility.

    // --- Role 1: which notes become visible to me via an in-network repost ---
    // The client fetches these reposted notes by id, so we only need note ids here.
    const repostedNoteIdSet = new Set<string>()

    for (let i = 0; i < allDids.length; i += BATCH_SIZE) {
      const batch = allDids.slice(i, i + BATCH_SIZE)
      const { data, error } = await supabase
        .from('reposts')
        .select('note_id')
        .in('reposter_id', batch)

      if (error) {
        throw new Error(`Reposts visibility query failed: ${error.message}`)
      }

      for (const row of (data ?? []) as { note_id: string }[]) {
        repostedNoteIdSet.add(row.note_id)
      }
    }

    const repostedNoteIds = [...repostedNoteIdSet]

    // --- Mention visibility (per-note grant, exactly like a repost) ---
    // A note becomes visible to me when I'm @-mentioned in it, OR in any of its
    // comments — even if I don't follow the author. This matters most for COMMENT
    // mentions: the commenter may be my mutual while the note's author is a
    // stranger to me, so without this grant the mention notification would point
    // at a note I can't see. Returned as ids the client fetches by id (never
    // merged into the author index, so it can't leak the author's OTHER notes).
    const mentionedNoteIdSet = new Set<string>()

    {
      const { data, error } = await supabase
        .from('notes')
        .select('id')
        .contains('mentions', [did])
      if (error) {
        throw new Error(`Note-mention visibility query failed: ${error.message}`)
      }
      for (const row of (data ?? []) as { id: string }[]) {
        mentionedNoteIdSet.add(row.id)
      }
    }

    {
      const { data, error } = await supabase
        .from('comments')
        .select('note_id')
        .contains('mentions', [did])
      if (error) {
        throw new Error(`Comment-mention visibility query failed: ${error.message}`)
      }
      for (const row of (data ?? []) as { note_id: string }[]) {
        mentionedNoteIdSet.add(row.note_id)
      }
    }

    const mentionedNoteIds = [...mentionedNoteIdSet]

    // --- Role 2: the FULL reposter list for every note I can actually see ---
    // Visible notes = author-channel notes (mine + my follows', already fetched
    // above) ∪ notes I gained access to via an in-network repost. We then look up
    // ALL reposters of those notes (no reposter_id filter), so a stranger who
    // reposted a note I can see still shows up in the avatar stack — without ever
    // widening my index.
    const visibleNoteIdSet = new Set<string>(repostedNoteIdSet)
    for (const note of notes) visibleNoteIdSet.add(note.id)
    for (const id of mentionedNoteIdSet) visibleNoteIdSet.add(id)
    const visibleNoteIds = [...visibleNoteIdSet]

    const repostersByNoteId: Record<string, string[]> = {}

    for (let i = 0; i < visibleNoteIds.length; i += BATCH_SIZE) {
      const batch = visibleNoteIds.slice(i, i + BATCH_SIZE)
      const { data, error } = await supabase
        .from('reposts')
        .select('note_id, reposter_id')
        .in('note_id', batch)

      if (error) {
        throw new Error(`Reposters query failed: ${error.message}`)
      }

      for (const row of (data ?? []) as { note_id: string; reposter_id: string }[]) {
        const list = (repostersByNoteId[row.note_id] ??= [])
        if (!list.includes(row.reposter_id)) {
          list.push(row.reposter_id)
        }
      }
    }

    // Build per-page unread map for the requesting user.
    // notifications.recipient_id = did → only this user's notifications.
    const myUnreadByPage: Record<string, number> = {}

    if (myNotePageById.size > 0) {
      const { data: notifData, error: notifError } = await supabase
        .from('notifications')
        .select('note_id')
        .eq('recipient_id', did)

      if (notifError) {
        throw new Error(`Failed to query notifications: ${notifError.message}`)
      }

      for (const row of (notifData ?? []) as { note_id: string }[]) {
        const pageUrl = myNotePageById.get(row.note_id)
        if (!pageUrl) continue
        myUnreadByPage[pageUrl] = (myUnreadByPage[pageUrl] ?? 0) + 1
      }
    }

    return new Response(
      JSON.stringify({
        index,
        myUnreadByPage,
        latestNoteAtByPage,
        repostedNoteIds,
        mentionedNoteIds,
        repostersByNoteId,
      }),
      {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        },
      },
    )
  } catch (error) {
    console.error('Error in get-index:', error)
    return new Response(
      JSON.stringify({
        error: error instanceof Error ? error.message : 'Internal server error',
      }),
      {
        status: 500,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        },
      },
    )
  }
})
