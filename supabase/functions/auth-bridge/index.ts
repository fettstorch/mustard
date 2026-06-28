import * as jose from 'https://deno.land/x/jose@v5.2.0/index.ts'
import { createClient } from 'jsr:@supabase/supabase-js@2'

// ─── Constants ──────────────────────────────────────────────────────────────

const ATPROTO_CLIENT_ID = 'https://fettstorch.github.io/mustard/client-metadata.json'
const ATPROTO_SCOPE = 'atproto'
const HANDLE_RESOLVER = 'https://bsky.social'
const PLC_DIRECTORY = 'https://plc.directory'
const STATE_TTL_SECONDS = 600
const SUPABASE_JWT_TTL_SECONDS = 180 * 24 * 60 * 60

// Mustard user_ids are UUIDs. Used to reject provider ids (DIDs etc.) that must
// never be treated as user_ids.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
}

// ─── Response helpers ────────────────────────────────────────────────────────

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

// Error that carries an HTTP status so deep helpers (e.g. linkIdentity) can
// surface a precise client-facing status instead of a generic 500.
class HttpError extends Error {
  status: number
  constructor(message: string, status: number) {
    super(message)
    this.status = status
  }
}

// ─── Supabase client (service_role, bypasses RLS) ────────────────────────────

function getSupabase() {
  return createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  )
}

// ─── Supabase JWT ────────────────────────────────────────────────────────────

async function mintSupabaseJwt(userId: string): Promise<{ jwt: string; expiresAt: number }> {
  const jwtSecret = Deno.env.get('JWT_SIGNING_SECRET')
  if (!jwtSecret) throw new Error('JWT_SIGNING_SECRET not configured')

  const now = Math.floor(Date.now() / 1000)
  const exp = now + SUPABASE_JWT_TTL_SECONDS

  const secret = new TextEncoder().encode(jwtSecret)
  const jwt = await new jose.SignJWT({ sub: userId, role: 'authenticated' })
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setIssuedAt(now)
    .setExpirationTime(exp)
    .sign(secret)

  return { jwt, expiresAt: exp }
}

// Verify a Supabase JWT we minted and return its `sub` (the Mustard userId),
// or null if the signature/format is invalid OR the token is expired.
//
// This authorizes live account-management actions (link, disconnect, delete,
// list, resolve), so it requires an UNEXPIRED token — only a small skew margin
// is allowed. An expired token is valid *proof of identity* for the refresh
// flow, but that path has its own lenient verifier (see handleRefresh); it must
// never authorize privileged mutations long after `exp`. The client refreshes
// proactively (~60s before exp), so legitimate callers always send a live JWT.
const ACCOUNT_ACTION_CLOCK_TOLERANCE_SEC = 60
async function verifyJwtSub(jwt: string): Promise<string | null> {
  const jwtSecret = Deno.env.get('JWT_SIGNING_SECRET')
  if (!jwtSecret) throw new Error('JWT_SIGNING_SECRET not configured')
  try {
    const { payload } = await jose.jwtVerify(jwt, new TextEncoder().encode(jwtSecret), {
      clockTolerance: ACCOUNT_ACTION_CLOCK_TOLERANCE_SEC,
    })
    return typeof payload.sub === 'string' ? payload.sub : null
  } catch {
    return null
  }
}

// ─── Identity linking (provider-agnostic) ────────────────────────────────────
//
// After any successful OAuth callback this is called to:
//   1. Find or create a `users` row and a matching `identities` row.
//   2. Optionally link to an already-logged-in Mustard account (the "connect
//      a second provider" flow — caller passes their current JWT).
//   Returns the stable Mustard userId (always an opaque UUID).

async function linkIdentity(
  provider: string,
  providerAccountId: string,
  handle: string,
  currentJwt?: string,
): Promise<string> {
  const supabase = getSupabase()

  // The account this identity should attach to, if the caller is already logged
  // in and is connecting a second provider. null = a plain login / sign-up.
  //
  // Distinguish "no JWT" (sign-up) from "JWT provided but unverifiable" (e.g.
  // secret rotation or a stale legacy token): the latter is a LINK attempt that
  // we must fail rather than silently fork into a brand-new account.
  let linkToUserId: string | null = null
  if (currentJwt) {
    linkToUserId = await verifyJwtSub(currentJwt)
    if (!linkToUserId) {
      throw new HttpError('Invalid currentJwt — cannot link identity. Please re-login.', 403)
    }
  }

  // Is this (provider, providerAccountId) already claimed by some Mustard user?
  const { data: existing } = await supabase
    .from('identities')
    .select('user_id')
    .eq('provider', provider)
    .eq('provider_account_id', providerAccountId)
    .maybeSingle()

  let targetUserId: string

  if (existing?.user_id) {
    // The identity already belongs to an account.
    if (linkToUserId && linkToUserId !== existing.user_id) {
      // The caller is trying to attach, to their account, an identity that is
      // already linked to a DIFFERENT Mustard user. Reject — never silently
      // steal an identity from another account.
      throw new HttpError(
        'This account is already linked to a different Mustard user.',
        409,
      )
    }
    // Plain re-login, or re-linking to the same account it already belongs to
    // (idempotent). Keep its current owner.
    targetUserId = existing.user_id
  } else if (linkToUserId) {
    // Brand-new identity being attached to the caller's existing account.
    targetUserId = linkToUserId
  } else {
    // Brand-new user. The user_id is ALWAYS an opaque UUID, never a provider id
    // (DID/GitHub id). Provider ids live only in `identities`, so the account can
    // link/unlink providers while its user_id stays stable. Let Postgres mint the
    // UUID (users.id DEFAULT gen_random_uuid()) and read it back.
    const { data: created, error } = await supabase
      .from('users')
      .insert({})
      .select('id')
      .single()
    if (error || !created) throw new Error(`Failed to create user: ${error?.message}`)
    targetUserId = created.id as string
  }

  // Upsert the identity (handle may have changed since last login).
  const { error: identityError } = await supabase.from('identities').upsert(
    { user_id: targetUserId, provider, provider_account_id: providerAccountId, handle },
    { onConflict: 'provider,provider_account_id' },
  )
  if (identityError) throw new Error(`Failed to upsert identity: ${identityError.message}`)

  return targetUserId
}

// ─── Identity management (list / disconnect) ─────────────────────────────────

// Return every identity linked to the caller's account. Drives the
// "Connected Accounts" UI in the options page.
async function handleListIdentities(body: { currentJwt?: string }): Promise<Response> {
  const { currentJwt } = body
  if (!currentJwt) return errorResponse('currentJwt is required', 400)
  const userId = await verifyJwtSub(currentJwt)
  if (!userId) return errorResponse('Invalid JWT', 403)

  const supabase = getSupabase()
  const { data, error } = await supabase
    .from('identities')
    .select('provider, provider_account_id, handle')
    .eq('user_id', userId)
  if (error) throw new Error(`Failed to list identities: ${error.message}`)

  return jsonResponse({ userId, identities: data ?? [] })
}

// Unlink one provider from the caller's account. Removing the LAST identity
// deletes the whole account, including all of the user's content (the content
// tables key off the user id but are not FK'd to `users`, so they don't cascade
// and must be deleted explicitly).
async function handleDisconnect(body: { currentJwt?: string; provider?: string }): Promise<Response> {
  const { currentJwt, provider } = body
  if (!currentJwt) return errorResponse('currentJwt is required', 400)
  if (!provider) return errorResponse('provider is required', 400)
  const userId = await verifyJwtSub(currentJwt)
  if (!userId) return errorResponse('Invalid JWT', 403)

  const supabase = getSupabase()

  // Find the identity to remove — we need its provider_account_id to clear the
  // matching oauth_session row.
  const { data: identity } = await supabase
    .from('identities')
    .select('id, provider_account_id')
    .eq('user_id', userId)
    .eq('provider', provider)
    .maybeSingle()
  if (!identity) return errorResponse('No such linked identity', 404)

  const { count } = await supabase
    .from('identities')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId)
  const isLastIdentity = (count ?? 0) <= 1

  if (isLastIdentity) {
    // Full account deletion. Done atomically in a single SECURITY DEFINER
    // function so content + user row are wiped together (or not at all). The
    // users delete inside it cascades identities + oauth_session.
    const { error } = await supabase.rpc('delete_account', { p_user_id: userId })
    if (error) throw new Error(`Failed to delete account: ${error.message}`)
    console.log(`[auth-bridge] disconnect: deleted account ${userId} (last identity)`)
    return jsonResponse({ accountDeleted: true })
  }

  // Otherwise unlink just this provider.
  await supabase
    .from('oauth_session')
    .delete()
    .eq('provider', provider)
    .eq('provider_account_id', identity.provider_account_id)
  const { error } = await supabase.from('identities').delete().eq('id', identity.id)
  if (error) throw new Error(`Failed to unlink identity: ${error.message}`)
  console.log(`[auth-bridge] disconnect: unlinked ${provider} from ${userId}`)
  return jsonResponse({ accountDeleted: false })
}

// ─── Profile resolution ──────────────────────────────────────────────────────
//
// Resolve a batch of Mustard userIds → their linked identities. The extension's
// profile service uses this to turn opaque author UUIDs back into renderable
// provider profiles (atproto DID → bsky profile; github login → avatar). The
// `identities` table is service-role only (RLS), so the client cannot do this
// mapping itself. The returned data is public social info; we still require a
// valid (logged-in) caller.

type IdentityRow = {
  user_id: string
  provider: string
  provider_account_id: string
  handle: string | null
}

const IDENTITY_BATCH = 200

/** Run `fn` over `items` in fixed-size batches and flatten the results. */
async function inBatches<T, R>(
  items: T[],
  size: number,
  fn: (batch: T[]) => Promise<R[]>,
): Promise<R[]> {
  const out: R[] = []
  for (let i = 0; i < items.length; i += size) {
    out.push(...(await fn(items.slice(i, i + size))))
  }
  return out
}

/** Look up identities by (provider, provider_account_id), batched. */
async function fetchIdentitiesIn(
  supabase: ReturnType<typeof getSupabase>,
  provider: string,
  accountIds: string[],
): Promise<IdentityRow[]> {
  return inBatches(accountIds, IDENTITY_BATCH, async (batch) => {
    const { data, error } = await supabase
      .from('identities')
      .select('user_id, provider, provider_account_id, handle')
      .eq('provider', provider)
      .in('provider_account_id', batch)
    if (error) throw new Error(`identities lookup failed: ${error.message}`)
    return (data ?? []) as IdentityRow[]
  })
}

async function handleResolveIdentities(
  body: { currentJwt?: string; userIds?: string[] },
): Promise<Response> {
  const { currentJwt, userIds } = body
  if (!currentJwt) return errorResponse('currentJwt is required', 400)
  if (!(await verifyJwtSub(currentJwt))) return errorResponse('Invalid JWT', 403)
  if (!Array.isArray(userIds) || userIds.length === 0) return jsonResponse({ identities: [] })

  // Only UUID-shaped ids are real user_ids; anything else (legacy DIDs from old
  // notes, mention sentinels) is not a user_id and would error the uuid filter.
  const uuids = [...new Set(userIds.filter((id) => typeof id === 'string' && UUID_RE.test(id)))]
  if (uuids.length === 0) return jsonResponse({ identities: [] })

  const supabase = getSupabase()
  const identities = await inBatches(uuids, IDENTITY_BATCH, async (batch) => {
    const { data, error } = await supabase
      .from('identities')
      .select('user_id, provider, provider_account_id, handle')
      .in('user_id', batch)
    if (error) throw new Error(`resolve-identities failed: ${error.message}`)
    return (data ?? []) as IdentityRow[]
  })

  return jsonResponse({ identities })
}

// Reverse of resolve-identities: given provider account ids (e.g. github numeric
// ids from `@[p:github:…]` mention sentinels), return their `identities` rows so
// the client can render a mention as @login linking to the github profile. Only
// account ids that belong to a Mustard user resolve (others simply aren't returned).
async function handleResolveAccounts(
  body: { currentJwt?: string; provider?: string; accountIds?: string[] },
): Promise<Response> {
  const { currentJwt, provider, accountIds } = body
  if (!currentJwt) return errorResponse('currentJwt is required', 400)
  if (!(await verifyJwtSub(currentJwt))) return errorResponse('Invalid JWT', 403)
  if (!provider || !Array.isArray(accountIds) || accountIds.length === 0) {
    return jsonResponse({ identities: [] })
  }

  const ids = [...new Set(accountIds.filter((id) => typeof id === 'string'))]
  if (ids.length === 0) return jsonResponse({ identities: [] })

  const identities = await fetchIdentitiesIn(getSupabase(), provider, ids)
  return jsonResponse({ identities })
}

// ─── Mention candidates ──────────────────────────────────────────────────────
//
// Returns the GitHub accounts the caller follows who are ALSO Mustard users —
// the only github accounts that can be @-mentioned (rendering resolves the
// numeric id → @login via the `identities` table, which requires a Mustard
// account). Bluesky mention candidates come from the existing mutuals path.

/** Fetch the caller's github follows ({id, login}), paginated and capped. */
async function fetchGithubFollowsWithLogin(
  accessToken: string,
): Promise<Array<{ id: number; login: string }>> {
  const MAX = 1000
  const result: Array<{ id: number; login: string }> = []
  let page = 1
  while (result.length < MAX) {
    const resp = await fetch(`https://api.github.com/user/following?per_page=100&page=${page}`, {
      headers: { Authorization: `Bearer ${accessToken}`, 'User-Agent': 'Mustard' },
    })
    if (!resp.ok) throw new Error(`Failed to fetch GitHub follows: ${resp.statusText}`)
    const data = (await resp.json()) as Array<{ id: number; login: string }>
    if (data.length === 0) break
    result.push(...data)
    if (data.length < 100) break
    page++
  }
  return result
}

async function handleGithubMentionCandidates(body: { currentJwt?: string }): Promise<Response> {
  const { currentJwt } = body
  if (!currentJwt) return errorResponse('currentJwt is required', 400)
  const userId = await verifyJwtSub(currentJwt)
  if (!userId) return errorResponse('Invalid JWT', 403)

  const supabase = getSupabase()

  // The caller's own github identity (a github-less account has no candidates).
  const { data: ident } = await supabase
    .from('identities')
    .select('provider_account_id')
    .eq('user_id', userId)
    .eq('provider', 'github')
    .maybeSingle()
  const githubAccountId = (ident as { provider_account_id: string } | null)?.provider_account_id
  if (!githubAccountId) return jsonResponse({ candidates: [] })

  // GitHub follows require the caller's stored access token.
  const { data: sess } = await supabase
    .from('oauth_session')
    .select('access_token')
    .eq('provider', 'github')
    .eq('provider_account_id', githubAccountId)
    .maybeSingle()
  const accessToken = (sess as { access_token: string | null } | null)?.access_token
  if (!accessToken) return jsonResponse({ candidates: [] })

  const follows = await fetchGithubFollowsWithLogin(accessToken)
  if (follows.length === 0) return jsonResponse({ candidates: [] })

  // Keep only follows that are Mustard users (so the mention can be resolved).
  const loginById = new Map(follows.map((f) => [String(f.id), f.login]))
  const rows = await fetchIdentitiesIn(supabase, 'github', [...loginById.keys()])

  const candidates: { accountId: string; handle: string }[] = []
  for (const row of rows) {
    const login = loginById.get(row.provider_account_id)
    if (login) candidates.push({ accountId: row.provider_account_id, handle: login })
  }

  return jsonResponse({ candidates })
}

// ─── ATProto strategy ────────────────────────────────────────────────────────
// All DPoP/PAR/PKCE logic lives here. Identical behavior to the original
// auth-bridge — only restructured into named functions.

interface DidDocument {
  id: string
  service?: Array<{ id: string; type: string; serviceEndpoint: string }>
}

async function resolveHandle(handle: string): Promise<string> {
  const url = `${HANDLE_RESOLVER}/xrpc/com.atproto.identity.resolveHandle?handle=${encodeURIComponent(handle)}`
  const resp = await fetch(url)
  if (!resp.ok) throw new Error(`Failed to resolve handle "${handle}": ${resp.statusText}`)
  return (await resp.json()).did
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
  const pds = doc.service?.find((s) => s.id === '#atproto_pds' || s.type === 'AtprotoPersonalDataServer')
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
  if (!asMeta.pushed_authorization_request_endpoint) throw new Error('AS does not support PAR')
  return asMeta
}

async function generateDpopKeyPair() {
  const { privateKey, publicKey } = await jose.generateKeyPair('ES256', { extractable: true })
  return { privateJwk: await jose.exportJWK(privateKey), publicJwk: await jose.exportJWK(publicKey) }
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
  const payload: Record<string, unknown> = { jti: crypto.randomUUID(), htm: method, htu: url, iat: now, exp: now + 30 }
  if (nonce) payload.nonce = nonce
  return new jose.SignJWT(payload as jose.JWTPayload)
    .setProtectedHeader({ typ: 'dpop+jwt', alg: 'ES256', jwk: publicJwk })
    .sign(key)
}

function isDpopNonceError(status: number, headers: Headers, body: Record<string, unknown>): boolean {
  if (status !== 400 && status !== 401) return false
  return headers.get('WWW-Authenticate')?.includes('use_dpop_nonce') || body?.error === 'use_dpop_nonce'
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
      if (newNonce && attempt === 0) { nonce = newNonce; continue }
    }
    return { status: resp.status, body: respBody }
  }
  throw new Error('DPoP nonce retry exhausted')
}

function generateCodeVerifier(): string {
  return jose.base64url.encode(crypto.getRandomValues(new Uint8Array(32)))
}

async function generateCodeChallenge(verifier: string): Promise<string> {
  return jose.base64url.encode(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))))
}

// ─── ATProto action handlers ─────────────────────────────────────────────────

async function handleAtprotoInitiate(body: { handle: string; redirect_uri: string }): Promise<Response> {
  const { handle, redirect_uri } = body
  if (!handle) return errorResponse('handle is required', 400)
  if (!redirect_uri) return errorResponse('redirect_uri is required', 400)

  console.log(`[auth-bridge] atproto initiate: resolving ${handle}`)
  const did = await resolveHandle(handle)
  const pdsUrl = await resolvePds(did)
  const asMeta = await discoverAuthServer(pdsUrl)
  console.log(`[auth-bridge] atproto initiate: AS=${asMeta.issuer}`)

  const { privateJwk, publicJwk } = await generateDpopKeyPair()
  const codeVerifier = generateCodeVerifier()
  const codeChallenge = await generateCodeChallenge(codeVerifier)
  const state = crypto.randomUUID()

  const { status, body: parResp } = await authServerPost(
    asMeta.pushed_authorization_request_endpoint,
    {
      client_id: ATPROTO_CLIENT_ID, response_type: 'code',
      code_challenge: codeChallenge, code_challenge_method: 'S256',
      state, redirect_uri, scope: ATPROTO_SCOPE, login_hint: handle,
    },
    privateJwk, publicJwk,
  )
  if (!parResp.request_uri) {
    console.error('[auth-bridge] PAR failed:', status, parResp)
    return errorResponse(`PAR failed: ${parResp.error_description || parResp.error || 'unknown'}`, 502)
  }

  const supabase = getSupabase()
  const { error } = await supabase.from('oauth_login_state').insert({
    state, code_verifier: codeVerifier,
    dpop_jwk: privateJwk, dpop_pub_jwk: publicJwk,
    as_issuer: asMeta.issuer, token_endpoint: asMeta.token_endpoint,
    redirect_uri, provider: 'atproto',
    expires_at: new Date(Date.now() + STATE_TTL_SECONDS * 1000).toISOString(),
  })
  if (error) throw new Error(`Failed to store login state: ${error.message}`)

  const authUrl = new URL(asMeta.authorization_endpoint)
  authUrl.searchParams.set('request_uri', parResp.request_uri as string)
  authUrl.searchParams.set('client_id', ATPROTO_CLIENT_ID)
  return jsonResponse({ authUrl: authUrl.toString(), state })
}

async function handleAtprotoCallback(body: {
  code: string; state: string; iss: string; currentJwt?: string
}): Promise<Response> {
  const { code, state, iss, currentJwt } = body
  if (!code || !state || !iss) return errorResponse('code, state, and iss are required', 400)

  console.log(`[auth-bridge] atproto callback: state=${state}`)
  const supabase = getSupabase()

  const { data: loginState, error: lookupError } = await supabase
    .from('oauth_login_state').select('*').eq('state', state).single()
  if (lookupError || !loginState) return errorResponse('Invalid or expired state', 400)
  if (new Date(loginState.expires_at) < new Date()) {
    await supabase.from('oauth_login_state').delete().eq('state', state)
    return errorResponse('Login state expired', 400)
  }
  if (loginState.as_issuer !== iss) return errorResponse('Issuer mismatch', 400)

  const { status, body: tokenResp } = await authServerPost(
    loginState.token_endpoint,
    { grant_type: 'authorization_code', code, code_verifier: loginState.code_verifier, redirect_uri: loginState.redirect_uri, client_id: ATPROTO_CLIENT_ID },
    loginState.dpop_jwk, loginState.dpop_pub_jwk,
  )
  if (!tokenResp.access_token) {
    console.error('[auth-bridge] Token exchange failed:', status, tokenResp)
    return errorResponse(`Token exchange failed: ${tokenResp.error_description || tokenResp.error || 'unknown'}`, 502)
  }

  const did = tokenResp.sub as string
  if (!did?.startsWith('did:')) return errorResponse('Invalid sub in token response', 502)
  const grantedScope = tokenResp.scope as string
  if (!grantedScope?.includes('atproto')) return errorResponse('Token response missing atproto scope', 502)

  // Identity verification: DID → PDS → AS must match the issuer we talked to
  const verifyAs = await discoverAuthServer(await resolvePds(did))
  if (verifyAs.issuer !== iss) return errorResponse('Identity verification failed: AS mismatch', 403)

  const tokenExpiresAt = tokenResp.expires_in
    ? new Date(Date.now() + (tokenResp.expires_in as number) * 1000).toISOString()
    : null

  // Link identity → get/create the Mustard userId (a UUID) BEFORE storing the
  // session (oauth_session.user_id is NOT NULL). The DID is recorded only as the
  // atproto identity's provider_account_id, never as the userId.
  const userId = await linkIdentity('atproto', did, did, currentJwt)

  // Store/update the OAuth session using the new composite PK.
  const { error: sessionError } = await supabase.from('oauth_session').upsert({
    provider: 'atproto',
    provider_account_id: did,
    user_id: userId,
    did,                          // kept for backward-compat until Phase 2 cleanup
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

  await supabase.from('oauth_login_state').delete().eq('state', state)

  const { jwt, expiresAt } = await mintSupabaseJwt(userId)
  console.log(`[auth-bridge] atproto callback: success for ${did} (userId=${userId})`)
  return jsonResponse({ jwt, expiresAt, did, userId })
}

// ─── GitHub strategy ──────────────────────────────────────────────────────────
// Standard OAuth 2.0 + PKCE. No DPoP, no PAR. Identity verified via GET /user.

// A GitHub OAuth App allows only ONE callback URL, but Chrome and Firefox hand
// out different extension redirect hosts (…chromiumapp.org vs
// …extensions.allizom.org). So we register one OAuth App per browser and pick
// its credentials here based on the redirect_uri host. The Firefox app's creds
// are optional — if unset, Firefox logins fail with a clear message.
function githubCreds(redirectUri: string): { clientId?: string; clientSecret?: string } {
  let isFirefox = false
  try {
    isFirefox = new URL(redirectUri).hostname.endsWith('extensions.allizom.org')
  } catch {
    isFirefox = false
  }
  return isFirefox
    ? {
        clientId: Deno.env.get('GITHUB_CLIENT_ID_FIREFOX'),
        clientSecret: Deno.env.get('GITHUB_CLIENT_SECRET_FIREFOX'),
      }
    : {
        clientId: Deno.env.get('GITHUB_CLIENT_ID'),
        clientSecret: Deno.env.get('GITHUB_CLIENT_SECRET'),
      }
}

async function handleGithubInitiate(body: { redirect_uri: string }): Promise<Response> {
  const { redirect_uri } = body
  if (!redirect_uri) return errorResponse('redirect_uri is required', 400)

  const { clientId } = githubCreds(redirect_uri)
  if (!clientId) return errorResponse('GitHub client id not configured for this browser', 500)

  const state = crypto.randomUUID()
  const codeVerifier = generateCodeVerifier()
  const codeChallenge = await generateCodeChallenge(codeVerifier)

  const supabase = getSupabase()
  const { error } = await supabase.from('oauth_login_state').insert({
    state, code_verifier: codeVerifier,
    provider: 'github', redirect_uri,
    expires_at: new Date(Date.now() + STATE_TTL_SECONDS * 1000).toISOString(),
  })
  if (error) throw new Error(`Failed to store login state: ${error.message}`)

  const authUrl = new URL('https://github.com/login/oauth/authorize')
  authUrl.searchParams.set('client_id', clientId)
  authUrl.searchParams.set('redirect_uri', redirect_uri)
  authUrl.searchParams.set('state', state)
  // read:user → profile data; user:follow → required by GET /user/following,
  // which powers the GitHub social-graph (followed accounts' notes).
  authUrl.searchParams.set('scope', 'read:user user:follow')
  authUrl.searchParams.set('code_challenge', codeChallenge)
  authUrl.searchParams.set('code_challenge_method', 'S256')
  // Force GitHub's account picker. Our redirect is an https chromiumapp.org URL
  // (treated as a web app), so without this GitHub does an "instant auth" and
  // silently reuses the already-authorized account — disconnect→reconnect would
  // never let the user pick a different account.
  // https://github.blog/changelog/2024-06-07-account-picker-updates-for-oauth-and-github-app-sign-in/
  authUrl.searchParams.set('prompt', 'select_account')

  return jsonResponse({ authUrl: authUrl.toString(), state })
}

async function handleGithubCallback(body: {
  code: string; state: string; currentJwt?: string
}): Promise<Response> {
  const { code, state, currentJwt } = body
  if (!code || !state) return errorResponse('code and state are required', 400)

  console.log(`[auth-bridge] github callback: state=${state}`)
  const supabase = getSupabase()

  const { data: loginState, error: lookupError } = await supabase
    .from('oauth_login_state').select('*').eq('state', state).single()
  if (lookupError || !loginState) return errorResponse('Invalid or expired state', 400)
  if (new Date(loginState.expires_at) < new Date()) {
    await supabase.from('oauth_login_state').delete().eq('state', state)
    return errorResponse('Login state expired', 400)
  }
  if (loginState.provider !== 'github') return errorResponse('State was not created for GitHub', 400)

  // Use the same OAuth App (chrome vs firefox) that initiate used — keyed off
  // the redirect_uri we stored in the login state.
  const { clientId, clientSecret } = githubCreds(loginState.redirect_uri as string)
  if (!clientId || !clientSecret) return errorResponse('GitHub credentials not configured for this browser', 500)

  // Exchange code for access token
  const tokenResp = await fetch('https://github.com/login/oauth/access_token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({
      client_id: clientId,
      client_secret: clientSecret,
      code,
      code_verifier: loginState.code_verifier,
      redirect_uri: loginState.redirect_uri,
    }),
  })
  if (!tokenResp.ok) return errorResponse(`GitHub token exchange failed: ${tokenResp.statusText}`, 502)
  const tokenData = await tokenResp.json()
  if (!tokenData.access_token) {
    console.error('[auth-bridge] GitHub token exchange failed:', tokenData)
    return errorResponse(`GitHub token exchange failed: ${tokenData.error_description || tokenData.error || 'unknown'}`, 502)
  }

  // Verify identity: fetch the authenticated GitHub user
  const userResp = await fetch('https://api.github.com/user', {
    headers: { Authorization: `Bearer ${tokenData.access_token}`, 'User-Agent': 'Mustard' },
  })
  if (!userResp.ok) return errorResponse(`Failed to fetch GitHub user: ${userResp.statusText}`, 502)
  const ghUser = await userResp.json()

  // GitHub's stable numeric id (as string) is the canonical account identifier.
  // login (username) is mutable and used only as the display handle.
  const githubId = String(ghUser.id)
  const githubLogin = String(ghUser.login)

  // Resolve the Mustard userId BEFORE storing the session — oauth_session.user_id
  // is NOT NULL. `currentJwt` (from the extension service worker) links this new
  // GitHub identity to an already-logged-in account ("connect a second provider").
  const userId = await linkIdentity('github', githubId, githubLogin, currentJwt)

  const { error: sessionError } = await supabase.from('oauth_session').upsert({
    provider: 'github',
    provider_account_id: githubId,
    user_id: userId,
    access_token: tokenData.access_token,
    refresh_token: tokenData.refresh_token ?? null,
    scope: tokenData.scope ?? null,
    updated_at: new Date().toISOString(),
  })
  if (sessionError) throw new Error(`Failed to store GitHub session: ${sessionError.message}`)

  await supabase.from('oauth_login_state').delete().eq('state', state)

  const { jwt, expiresAt } = await mintSupabaseJwt(userId)
  console.log(`[auth-bridge] github callback: success for ${githubLogin} (userId=${userId})`)
  return jsonResponse({
    jwt,
    expiresAt,
    userId,
    provider: 'github',
    handle: githubLogin,
    avatarUrl: ghUser.avatar_url ?? null,
  })
}

// ─── Refresh (provider-agnostic) ─────────────────────────────────────────────
// Mints a fresh Mustard JWT for the user and, for atproto, refreshes the
// upstream access token. `userId` is the Mustard UUID (== the JWT subject).

// A row of the oauth_session table (atproto-specific columns are null for github).
interface OAuthSessionRow {
  provider: string
  provider_account_id: string
  user_id: string
  access_token: string | null
  refresh_token: string | null
  token_endpoint: string | null
  token_expires_at: string | null
  dpop_jwk: jose.JWK | null
  dpop_pub_jwk: jose.JWK | null
}

type AtprotoRefreshResult = { ok: true } | { ok: false; status: number; error: string }

/**
 * Refresh an atproto session's upstream access token in place. Returns a typed
 * result (not a Response) so the caller can decide whether a failure is fatal
 * (atproto is the account's only linked provider) or recoverable (fall back to
 * another linked session and still mint the Mustard JWT).
 */
async function refreshAtprotoToken(
  supabase: ReturnType<typeof getSupabase>,
  session: OAuthSessionRow,
): Promise<AtprotoRefreshResult> {
  if (!session.refresh_token) return { ok: false, status: 400, error: 'No refresh token available' }
  if (!session.token_endpoint || !session.dpop_jwk || !session.dpop_pub_jwk) {
    return { ok: false, status: 400, error: 'Incomplete atproto session' }
  }

  const { status, body: tokenResp } = await authServerPost(
    session.token_endpoint,
    { grant_type: 'refresh_token', refresh_token: session.refresh_token, client_id: ATPROTO_CLIENT_ID },
    session.dpop_jwk, session.dpop_pub_jwk,
  )
  if (!tokenResp.access_token) {
    console.error('[auth-bridge] Token refresh failed:', status, tokenResp)
    return {
      ok: false,
      status: 502,
      error: `Token refresh failed: ${tokenResp.error_description || tokenResp.error || 'unknown'}`,
    }
  }
  if (tokenResp.sub && tokenResp.sub !== session.provider_account_id) {
    return { ok: false, status: 502, error: 'DID mismatch after refresh' }
  }

  const tokenExpiresAt = tokenResp.expires_in
    ? new Date(Date.now() + (tokenResp.expires_in as number) * 1000).toISOString()
    : null

  await supabase.from('oauth_session').update({
    access_token: tokenResp.access_token,
    refresh_token: (tokenResp.refresh_token as string) || session.refresh_token,
    token_expires_at: tokenExpiresAt,
    updated_at: new Date().toISOString(),
  }).eq('provider', 'atproto').eq('provider_account_id', session.provider_account_id)

  return { ok: true }
}

async function handleRefresh(body: { userId?: string; expired_jwt: string }): Promise<Response> {
  const { userId, expired_jwt } = body
  if (!userId || !expired_jwt) return errorResponse('userId and expired_jwt are required', 400)

  const jwtSecret = Deno.env.get('JWT_SIGNING_SECRET')
  if (!jwtSecret) throw new Error('JWT_SIGNING_SECRET not configured')

  // Refresh treats the JWT as PROOF OF IDENTITY, not authorization: an expired
  // token is the normal case here ("mine died, mint me a new one"). This is the
  // ONLY path allowed to accept an expired JWT — hence the large tolerance. All
  // privileged mutations go through verifyJwtSub, which requires it unexpired.
  try {
    const { payload } = await jose.jwtVerify(
      expired_jwt, new TextEncoder().encode(jwtSecret),
      { clockTolerance: 365 * 24 * 60 * 60 },
    )
    if (payload.sub !== userId) return errorResponse('JWT subject mismatch', 403)
  } catch {
    return errorResponse('Invalid JWT', 403)
  }

  console.log(`[auth-bridge] refresh: ${userId}`)
  const supabase = getSupabase()

  // A user may have several linked sessions (atproto + github). The Mustard JWT
  // only encodes the userId, so minting it never requires a live upstream token.
  // We refresh atproto best-effort to keep follow-fetching working, but a dead
  // atproto session must NOT lock out an account that still has another working
  // provider (e.g. github, whose classic OAuth token doesn't expire).
  const { data: sessions } = await supabase
    .from('oauth_session')
    .select('*')
    .eq('user_id', userId)

  const rows = (sessions ?? []) as OAuthSessionRow[]
  if (rows.length === 0) return errorResponse('No session found', 404)

  const atprotoSession = rows.find((s) => s.provider === 'atproto') ?? null
  if (atprotoSession) {
    const refreshed = await refreshAtprotoToken(supabase, atprotoSession)
    if (!refreshed.ok) {
      // Drop the dead atproto session so it stops being retried.
      await supabase.from('oauth_session').delete()
        .eq('provider', 'atproto').eq('provider_account_id', atprotoSession.provider_account_id)
      // Only fatal when atproto was the sole linked provider; otherwise fall
      // through and mint the JWT from the remaining identity.
      const hasFallback = rows.some((s) => s.provider !== 'atproto')
      if (!hasFallback) return errorResponse(refreshed.error, refreshed.status)
      console.warn(
        `[auth-bridge] refresh: atproto session dead for ${userId}; falling back to another linked provider`,
      )
    }
  }
  // github (and any future no-expiry provider) needs no upstream refresh — its
  // token is reused as-is, so we go straight to minting the Mustard JWT.

  const { jwt, expiresAt } = await mintSupabaseJwt(userId)
  console.log(`[auth-bridge] refresh: success for ${userId}`)
  return jsonResponse({ jwt, expiresAt })
}

// ─── Main handler ─────────────────────────────────────────────────────────────

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS_HEADERS })
  if (req.method !== 'POST') return errorResponse('Method not allowed', 405)

  try {
    const body = await req.json()

    // Route by action; provider is either explicit or implicit from the action name.
    // NOTE: every handler call is `return await` so a rejected handler promise is
    // caught by the try/catch below. A bare `return handleX()` would let the
    // rejection escape to the runtime, which then replies with a plain-text 500
    // instead of our JSON error (and swallows the HttpError status).
    switch (body.action) {
      // ── atproto ──
      case 'initiate':
        // Legacy callers don't send provider; default to atproto.
        if (!body.provider || body.provider === 'atproto') return await handleAtprotoInitiate(body)
        if (body.provider === 'github') return await handleGithubInitiate(body)
        return errorResponse(`Unknown provider: ${body.provider}`, 400)

      case 'callback':
        if (!body.provider || body.provider === 'atproto') return await handleAtprotoCallback(body)
        if (body.provider === 'github') return await handleGithubCallback(body)
        return errorResponse(`Unknown provider: ${body.provider}`, 400)

      case 'refresh':
        return await handleRefresh(body)

      case 'list-identities':
        return await handleListIdentities(body)

      case 'disconnect':
        return await handleDisconnect(body)

      case 'resolve-identities':
        return await handleResolveIdentities(body)

      case 'resolve-accounts':
        return await handleResolveAccounts(body)

      case 'github-mention-candidates':
        return await handleGithubMentionCandidates(body)

      default:
        return errorResponse(
          'Invalid action. Use: initiate, callback, refresh, list-identities, disconnect, resolve-identities, resolve-accounts, or github-mention-candidates',
          400,
        )
    }
  } catch (error) {
    if (error instanceof HttpError) return errorResponse(error.message, error.status)
    console.error('[auth-bridge] Unhandled error:', error)
    return errorResponse(error instanceof Error ? error.message : 'Internal server error', 500)
  }
})
