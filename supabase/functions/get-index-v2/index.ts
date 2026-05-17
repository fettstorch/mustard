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
