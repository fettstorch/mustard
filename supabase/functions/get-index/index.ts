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
        'Access-Control-Allow-Headers': 'Content-Type',
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

    // Query in batches of 200 to avoid PostgREST URI length limits
    const BATCH_SIZE = 200
    const notes: { author_id: string; page_url: string }[] = []

    for (let i = 0; i < allDids.length; i += BATCH_SIZE) {
      const batch = allDids.slice(i, i + BATCH_SIZE)
      const { data, error } = await supabase
        .from('notes')
        .select('author_id, page_url')
        .in('author_id', batch)

      if (error) {
        throw new Error(`Supabase query failed: ${error.message}`)
      }

      notes.push(...(data || []))
    }

    // Build index: Map<UserId, PageUrl[]>
    const index: Record<string, string[]> = {}

    for (const note of notes) {
      if (!index[note.author_id]) {
        index[note.author_id] = []
      }
      if (!index[note.author_id].includes(note.page_url)) {
        index[note.author_id].push(note.page_url)
      }
    }

    return new Response(JSON.stringify({ index }), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
    })
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
