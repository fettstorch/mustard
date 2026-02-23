import { createClient } from 'jsr:@supabase/supabase-js@2'

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
      return new Response(
        JSON.stringify({ error: 'Invalid request: did is required' }),
        {
          status: 400,
          headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
        },
      )
    }

    // Fetch the user's follows from Bluesky's public API
    const followsUrl = `https://public.api.bsky.app/xrpc/app.bsky.graph.getFollows?actor=${did}`
    const followsResponse = await fetch(followsUrl)

    if (!followsResponse.ok) {
      throw new Error(`Failed to fetch follows: ${followsResponse.statusText}`)
    }

    const followsData: FollowsResponse = await followsResponse.json()
    const followedDids = followsData.follows.map((f) => f.did)

    // Include the user's own DID
    const allDids = [did, ...followedDids]

    // Query Supabase for notes from these authors
    const supabaseUrl = Deno.env.get('SUPABASE_URL')
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')

    if (!supabaseUrl || !supabaseServiceKey) {
      throw new Error('Supabase environment variables not configured')
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey)

    // Query distinct page_url and author_id combinations
    const { data: notes, error } = await supabase
      .from('notes')
      .select('author_id, page_url')
      .in('author_id', allDids)

    if (error) {
      throw new Error(`Supabase query failed: ${error.message}`)
    }

    // Build index: Map<UserId, PageUrl[]>
    const index: Record<string, string[]> = {}

    for (const note of notes || []) {
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
