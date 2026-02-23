import * as jose from 'https://deno.land/x/jose@v5.2.0/index.ts'

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

    // TODO: Verify the AT Protocol session is valid
    // For now, we'll trust the client and just mint the JWT
    // In production, you should call the user's PDS to verify:
    // const pdsResponse = await fetch(`${pdsUrl}/xrpc/com.atproto.server.getSession`, {
    //   headers: { Authorization: `Bearer ${accessToken}` }
    // })
    // if (!pdsResponse.ok) throw new Error('Invalid AT Protocol session')

    // Get JWT signing secret from environment
    // Note: Can't use SUPABASE_ prefix for custom secrets, so we use JWT_SIGNING_SECRET
    const jwtSecret = Deno.env.get('JWT_SIGNING_SECRET')
    if (!jwtSecret) {
      throw new Error('JWT_SIGNING_SECRET not configured')
    }

    // Create JWT with DID as subject
    const now = Math.floor(Date.now() / 1000)
    const exp = now + 3600 // 1 hour expiration

    const payload = {
      sub: did,
      role: 'authenticated',
      iat: now,
      exp: exp,
    }

    // Sign JWT with Supabase secret
    const secret = new TextEncoder().encode(jwtSecret)
    const jwt = await new jose.SignJWT(payload)
      .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
      .setIssuedAt(now)
      .setExpirationTime(exp)
      .sign(secret)

    return new Response(
      JSON.stringify({
        jwt,
        expiresAt: exp,
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
    console.error('Error in auth-bridge:', error)
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
