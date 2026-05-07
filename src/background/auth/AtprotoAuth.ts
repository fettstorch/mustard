// AT Protocol authentication via BFF (Backend For Frontend) pattern.
// The auth-bridge Edge Function handles all OAuth crypto (DPoP, PKCE, token exchange).
// The extension only opens the auth page and forwards the callback parameters.

const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY
const AUTH_BRIDGE_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/auth-bridge`
const REDIRECT_URI = browser.identity.getRedirectURL('callback')
const STORAGE_KEY = 'atproto_session'

// handle is optional for backwards-compat with sessions stored before this field was added
type StoredSession = { did: string; handle?: string }

type LoginResult = { did: string; jwt: string; expiresAt: number }

async function authBridgePost(body: Record<string, unknown>) {
  const resp = await fetch(AUTH_BRIDGE_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
    },
    body: JSON.stringify(body),
  })

  const data = await resp.json()
  if (!resp.ok) throw new Error(data.error || `auth-bridge ${resp.status}`)
  return data
}

/**
 * Start login flow: auth-bridge does PAR, user authenticates, auth-bridge exchanges code.
 * Returns the DID and a fresh Supabase JWT.
 */
export async function login(handle: string): Promise<LoginResult> {
  // 1. Ask auth-bridge to do PAR and return the authorization URL
  const { authUrl, state } = await authBridgePost({
    action: 'initiate',
    handle,
    redirect_uri: REDIRECT_URI,
  })

  // 2. Open the Bluesky auth page — user logs in and approves
  const callbackUrl = await browser.identity.launchWebAuthFlow({
    url: authUrl,
    interactive: true,
  })
  if (!callbackUrl) throw new Error('Login was cancelled')

  // 3. Extract code, state, iss from the callback URL (query params)
  const url = new URL(callbackUrl)
  const code = url.searchParams.get('code')
  const iss = url.searchParams.get('iss')
  const returnedState = url.searchParams.get('state')

  if (!code || !iss || !returnedState) throw new Error('Missing callback parameters')
  if (returnedState !== state) throw new Error('State mismatch')

  // 4. Send callback params to auth-bridge — it does token exchange and mints a Supabase JWT
  const result = await authBridgePost({ action: 'callback', code, state, iss })

  // 5. Store session (handle stored for potential future use)
  await browser.storage.local.set({
    [STORAGE_KEY]: { did: result.did, handle } satisfies StoredSession,
  })

  return { did: result.did, jwt: result.jwt, expiresAt: result.expiresAt }
}

/**
 * Read stored session info. Does NOT validate tokens — only checks if user logged in before.
 */
export async function getSession(): Promise<StoredSession | undefined> {
  const result = await browser.storage.local.get(STORAGE_KEY)
  return result[STORAGE_KEY] as StoredSession | undefined
}

/**
 * Logout — clears local state. Server session stays until tokens expire naturally.
 */
export async function logout(_did: string): Promise<void> {
  await browser.storage.local.remove(STORAGE_KEY)
}

/**
 * Clear the stored ATProto session. Used when the server-side session is gone
 * and the user must re-authenticate.
 */
export async function clearStoredSession(): Promise<void> {
  await browser.storage.local.remove(STORAGE_KEY)
}
