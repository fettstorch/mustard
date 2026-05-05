import * as jose from 'https://deno.land/x/jose@v5.2.0/index.ts'
import { createClient } from 'jsr:@supabase/supabase-js@2'

const CLIENT_ID = 'https://fettstorch.github.io/mustard/client-metadata.json'
const SCOPE = 'atproto'
const HANDLE_RESOLVER = 'https://bsky.social'
const PLC_DIRECTORY = 'https://plc.directory'
const STATE_TTL_SECONDS = 600
const SUPABASE_JWT_TTL_SECONDS = 180 * 24 * 60 * 60

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
}

// ─── Response helpers ──────────────────────────────────────────

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
  })
}

function errorResponse(message: string, status: number): Response {
  console.error(`[auth-bridge] Error ${status}: ${message}`)
  return jsonResponse({ error: message }, status)
}

// ─── Supabase client (service_role, bypasses RLS) ──────────────

function getSupabase() {
  return createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  )
}

// ─── Identity resolution ───────────────────────────────────────

async function resolveHandle(handle: string): Promise<string> {
  const url = `${HANDLE_RESOLVER}/xrpc/com.atproto.identity.resolveHandle?handle=${encodeURIComponent(handle)}`
  const resp = await fetch(url)
  if (!resp.ok) throw new Error(`Failed to resolve handle "${handle}": ${resp.statusText}`)
  const data = await resp.json()
  return data.did
}

interface DidDocument {
  id: string
  service?: Array<{ id: string; type: string; serviceEndpoint: string }>
}

async function resolvePds(did: string): Promise<string> {
  let didDocUrl: string
  if (did.startsWith('did:plc:')) {
    didDocUrl = `${PLC_DIRECTORY}/${did}`
  } else if (did.startsWith('did:web:')) {
    const host = did.slice('did:web:'.length).replace(/:/g, '/')
    didDocUrl = `https://${host}/.well-known/did.json`
  } else {
    throw new Error(`Unsupported DID method: ${did}`)
  }

  const resp = await fetch(didDocUrl)
  if (!resp.ok) throw new Error(`Failed to resolve DID document for ${did}: ${resp.statusText}`)
  const doc: DidDocument = await resp.json()

  const pds = doc.service?.find(
    (s) => s.id === '#atproto_pds' || s.type === 'AtprotoPersonalDataServer',
  )
  if (!pds) throw new Error('No PDS service found in DID document')
  return pds.serviceEndpoint
}

interface AuthServerMeta {
  issuer: string
  authorization_endpoint: string
  token_endpoint: string
  pushed_authorization_request_endpoint: string
}

async function discoverAuthServer(pdsUrl: string): Promise<AuthServerMeta> {
  const prResp = await fetch(`${pdsUrl}/.well-known/oauth-protected-resource`)
  if (!prResp.ok) throw new Error(`Failed to fetch PDS resource metadata: ${prResp.statusText}`)
  const prMeta = await prResp.json()
  const asUrl = prMeta.authorization_servers?.[0]
  if (!asUrl) throw new Error('No authorization server in PDS resource metadata')

  const asResp = await fetch(`${asUrl}/.well-known/oauth-authorization-server`)
  if (!asResp.ok) throw new Error(`Failed to fetch AS metadata: ${asResp.statusText}`)
  const asMeta: AuthServerMeta = await asResp.json()

  if (!asMeta.pushed_authorization_request_endpoint) {
    throw new Error('AS does not support PAR')
  }

  return asMeta
}

// ─── DPoP ──────────────────────────────────────────────────────

async function generateDpopKeyPair() {
  const { privateKey, publicKey } = await jose.generateKeyPair('ES256', { extractable: true })
  const privateJwk = await jose.exportJWK(privateKey)
  const publicJwk = await jose.exportJWK(publicKey)
  return { privateJwk, publicJwk }
}

async function createDpopProof(
  method: string,
  url: string,
  privateJwk: jose.JWK,
  publicJwk: jose.JWK,
  nonce?: string,
): Promise<string> {
  const key = await jose.importJWK(privateJwk, 'ES256')
  const now = Math.floor(Date.now() / 1000)
  const payload: Record<string, unknown> = {
    jti: crypto.randomUUID(),
    htm: method,
    htu: url,
    iat: now,
    exp: now + 30,
  }
  if (nonce) payload.nonce = nonce

  return await new jose.SignJWT(payload as jose.JWTPayload)
    .setProtectedHeader({ typ: 'dpop+jwt', alg: 'ES256', jwk: publicJwk })
    .sign(key)
}

function isDpopNonceError(status: number, headers: Headers, body: Record<string, unknown>): boolean {
  if (status !== 400 && status !== 401) return false
  const wwwAuth = headers.get('WWW-Authenticate')
  if (wwwAuth?.includes('use_dpop_nonce')) return true
  if (body?.error === 'use_dpop_nonce') return true
  return false
}

async function authServerPost(
  url: string,
  formData: Record<string, string>,
  privateJwk: jose.JWK,
  publicJwk: jose.JWK,
): Promise<{ status: number; body: Record<string, unknown> }> {
  let nonce = ''

  for (let attempt = 0; attempt < 2; attempt++) {
    const dpop = await createDpopProof('POST', url, privateJwk, publicJwk, nonce || undefined)

    const resp = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', DPoP: dpop },
      body: new URLSearchParams(formData).toString(),
    })

    const respBody = await resp.json()

    if (isDpopNonceError(resp.status, resp.headers, respBody)) {
      const newNonce = resp.headers.get('DPoP-Nonce')
      if (newNonce && attempt === 0) {
        console.log(`[auth-bridge] Retrying with DPoP nonce`)
        nonce = newNonce
        continue
      }
    }

    return { status: resp.status, body: respBody }
  }

  throw new Error('DPoP nonce retry exhausted')
}

// ─── PKCE ──────────────────────────────────────────────────────

function generateCodeVerifier(): string {
  const array = new Uint8Array(32)
  crypto.getRandomValues(array)
  return jose.base64url.encode(array)
}

async function generateCodeChallenge(verifier: string): Promise<string> {
  const data = new TextEncoder().encode(verifier)
  const digest = await crypto.subtle.digest('SHA-256', data)
  return jose.base64url.encode(new Uint8Array(digest))
}

// ─── Supabase JWT ──────────────────────────────────────────────

async function mintSupabaseJwt(did: string): Promise<{ jwt: string; expiresAt: number }> {
  const jwtSecret = Deno.env.get('JWT_SIGNING_SECRET')
  if (!jwtSecret) throw new Error('JWT_SIGNING_SECRET not configured')

  const now = Math.floor(Date.now() / 1000)
  const exp = now + SUPABASE_JWT_TTL_SECONDS

  const secret = new TextEncoder().encode(jwtSecret)
  const jwt = await new jose.SignJWT({ sub: did, role: 'authenticated' })
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setIssuedAt(now)
    .setExpirationTime(exp)
    .sign(secret)

  return { jwt, expiresAt: exp }
}

// ─── Actions ───────────────────────────────────────────────────

async function handleInitiate(body: {
  handle: string
  redirect_uri: string
}): Promise<Response> {
  const { handle, redirect_uri } = body
  if (!handle) return errorResponse('handle is required', 400)
  if (!redirect_uri) return errorResponse('redirect_uri is required', 400)

  console.log(`[auth-bridge] initiate: resolving ${handle}`)

  // Resolve handle → DID → PDS → Authorization Server
  const did = await resolveHandle(handle)
  const pdsUrl = await resolvePds(did)
  const asMeta = await discoverAuthServer(pdsUrl)

  console.log(`[auth-bridge] initiate: AS=${asMeta.issuer}`)

  // Generate DPoP key pair + PKCE
  const { privateJwk, publicJwk } = await generateDpopKeyPair()
  const codeVerifier = generateCodeVerifier()
  const codeChallenge = await generateCodeChallenge(codeVerifier)
  const state = crypto.randomUUID()

  // Pushed Authorization Request
  const { status, body: parResp } = await authServerPost(
    asMeta.pushed_authorization_request_endpoint,
    {
      client_id: CLIENT_ID,
      response_type: 'code',
      code_challenge: codeChallenge,
      code_challenge_method: 'S256',
      state,
      redirect_uri,
      scope: SCOPE,
      login_hint: handle,
    },
    privateJwk,
    publicJwk,
  )

  if (!parResp.request_uri) {
    console.error('[auth-bridge] PAR failed:', status, parResp)
    return errorResponse(
      `PAR failed: ${parResp.error_description || parResp.error || 'unknown'}`,
      502,
    )
  }

  // Store login state
  const supabase = getSupabase()
  const { error: insertError } = await supabase.from('oauth_login_state').insert({
    state,
    code_verifier: codeVerifier,
    dpop_jwk: privateJwk,
    dpop_pub_jwk: publicJwk,
    as_issuer: asMeta.issuer,
    token_endpoint: asMeta.token_endpoint,
    redirect_uri,
    expires_at: new Date(Date.now() + STATE_TTL_SECONDS * 1000).toISOString(),
  })
  if (insertError) throw new Error(`Failed to store login state: ${insertError.message}`)

  // Build the authorization URL the user's browser should open
  const authUrl = new URL(asMeta.authorization_endpoint)
  authUrl.searchParams.set('request_uri', parResp.request_uri as string)
  authUrl.searchParams.set('client_id', CLIENT_ID)

  return jsonResponse({ authUrl: authUrl.toString(), state })
}

async function handleCallback(body: {
  code: string
  state: string
  iss: string
}): Promise<Response> {
  const { code, state, iss } = body
  if (!code || !state || !iss) return errorResponse('code, state, and iss are required', 400)

  console.log(`[auth-bridge] callback: state=${state}`)

  const supabase = getSupabase()

  // Look up and validate login state
  const { data: loginState, error: lookupError } = await supabase
    .from('oauth_login_state')
    .select('*')
    .eq('state', state)
    .single()

  if (lookupError || !loginState) return errorResponse('Invalid or expired state', 400)
  if (new Date(loginState.expires_at) < new Date()) {
    await supabase.from('oauth_login_state').delete().eq('state', state)
    return errorResponse('Login state expired', 400)
  }
  if (loginState.as_issuer !== iss) return errorResponse('Issuer mismatch', 400)

  // Token exchange
  const { status, body: tokenResp } = await authServerPost(
    loginState.token_endpoint,
    {
      grant_type: 'authorization_code',
      code,
      code_verifier: loginState.code_verifier,
      redirect_uri: loginState.redirect_uri,
      client_id: CLIENT_ID,
    },
    loginState.dpop_jwk,
    loginState.dpop_pub_jwk,
  )

  if (!tokenResp.access_token) {
    console.error('[auth-bridge] Token exchange failed:', status, tokenResp)
    return errorResponse(
      `Token exchange failed: ${tokenResp.error_description || tokenResp.error || 'unknown'}`,
      502,
    )
  }

  const did = tokenResp.sub as string
  if (!did?.startsWith('did:')) return errorResponse('Invalid sub in token response', 502)

  const grantedScope = tokenResp.scope as string
  if (!grantedScope?.includes('atproto')) {
    return errorResponse('Token response missing atproto scope', 502)
  }

  // Identity verification: DID → PDS → AS must match the issuer we talked to
  const verifyPds = await resolvePds(did)
  const verifyAs = await discoverAuthServer(verifyPds)
  if (verifyAs.issuer !== iss) return errorResponse('Identity verification failed: AS mismatch', 403)

  // Store session (upsert for re-login)
  const tokenExpiresAt = tokenResp.expires_in
    ? new Date(Date.now() + (tokenResp.expires_in as number) * 1000).toISOString()
    : null

  const { error: sessionError } = await supabase.from('oauth_session').upsert({
    did,
    dpop_jwk: loginState.dpop_jwk,
    dpop_pub_jwk: loginState.dpop_pub_jwk,
    access_token: tokenResp.access_token,
    refresh_token: (tokenResp.refresh_token as string) || null,
    token_endpoint: loginState.token_endpoint,
    scope: grantedScope,
    token_expires_at: tokenExpiresAt,
    updated_at: new Date().toISOString(),
  })
  if (sessionError) throw new Error(`Failed to store session: ${sessionError.message}`)

  // Clean up consumed login state
  await supabase.from('oauth_login_state').delete().eq('state', state)

  // Mint Supabase JWT
  const { jwt, expiresAt } = await mintSupabaseJwt(did)

  console.log(`[auth-bridge] callback: success for ${did}`)
  return jsonResponse({ jwt, expiresAt, did })
}

async function handleRefresh(body: {
  did: string
  expired_jwt: string
}): Promise<Response> {
  const { did, expired_jwt } = body
  if (!did || !expired_jwt) return errorResponse('did and expired_jwt are required', 400)

  // Verify expired JWT signature (allow up to 1 year of clock drift for expired tokens)
  const jwtSecret = Deno.env.get('JWT_SIGNING_SECRET')
  if (!jwtSecret) throw new Error('JWT_SIGNING_SECRET not configured')

  try {
    const { payload } = await jose.jwtVerify(
      expired_jwt,
      new TextEncoder().encode(jwtSecret),
      { clockTolerance: 365 * 24 * 60 * 60 },
    )
    if (payload.sub !== did) return errorResponse('JWT subject mismatch', 403)
  } catch {
    return errorResponse('Invalid JWT', 403)
  }

  console.log(`[auth-bridge] refresh: ${did}`)

  const supabase = getSupabase()

  const { data: session, error: sessionError } = await supabase
    .from('oauth_session')
    .select('*')
    .eq('did', did)
    .single()

  if (sessionError || !session) return errorResponse('No session found', 404)
  if (!session.refresh_token) return errorResponse('No refresh token available', 400)

  // Refresh ATProto tokens
  const { status, body: tokenResp } = await authServerPost(
    session.token_endpoint,
    {
      grant_type: 'refresh_token',
      refresh_token: session.refresh_token,
      client_id: CLIENT_ID,
    },
    session.dpop_jwk,
    session.dpop_pub_jwk,
  )

  if (!tokenResp.access_token) {
    console.error('[auth-bridge] Token refresh failed:', status, tokenResp)
    await supabase.from('oauth_session').delete().eq('did', did)
    return errorResponse(
      `Token refresh failed: ${tokenResp.error_description || tokenResp.error || 'unknown'}`,
      502,
    )
  }

  if (tokenResp.sub && tokenResp.sub !== did) {
    return errorResponse('DID mismatch after refresh', 502)
  }

  // Update session with new tokens
  const tokenExpiresAt = tokenResp.expires_in
    ? new Date(Date.now() + (tokenResp.expires_in as number) * 1000).toISOString()
    : null

  await supabase
    .from('oauth_session')
    .update({
      access_token: tokenResp.access_token,
      refresh_token: (tokenResp.refresh_token as string) || session.refresh_token,
      token_expires_at: tokenExpiresAt,
      updated_at: new Date().toISOString(),
    })
    .eq('did', did)

  // Mint new Supabase JWT
  const { jwt, expiresAt } = await mintSupabaseJwt(did)

  console.log(`[auth-bridge] refresh: success for ${did}`)
  return jsonResponse({ jwt, expiresAt })
}

// ─── Main handler ──────────────────────────────────────────────

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: CORS_HEADERS })
  }

  if (req.method !== 'POST') {
    return errorResponse('Method not allowed', 405)
  }

  try {
    const body = await req.json()

    switch (body.action) {
      case 'initiate':
        return await handleInitiate(body)
      case 'callback':
        return await handleCallback(body)
      case 'refresh':
        return await handleRefresh(body)
      default:
        return errorResponse('Invalid action. Use: initiate, callback, or refresh', 400)
    }
  } catch (error) {
    console.error('[auth-bridge] Unhandled error:', error)
    return errorResponse(error instanceof Error ? error.message : 'Internal server error', 500)
  }
})
