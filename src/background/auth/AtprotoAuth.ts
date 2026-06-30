// AT Protocol authentication via BFF (Backend For Frontend) pattern.
// The auth-bridge Edge Function handles all OAuth crypto (DPoP, PKCE, token exchange).
// The extension only opens the auth page and forwards the callback parameters.
//
// Provider-agnostic session persistence/reads live in SessionStore.

import { authBridgePost } from './AuthBridge'
import { storeSession, type StoredSession } from './SessionStore'

const REDIRECT_URI = browser.identity.getRedirectURL('callback')

/** The account's atproto DID, if any (for atproto-specific ops like getMutuals). */
export function atprotoDid(session: StoredSession): string | undefined {
  return session.identities.find((i) => i.provider === 'atproto')?.providerAccountId
}

type LoginResult = { userId: string; did: string; jwt: string; expiresAt: number }

/**
 * Start atproto login flow: auth-bridge does PAR, user authenticates, auth-bridge
 * exchanges code and returns both the DID and a fresh Supabase JWT.
 */
export async function login(handle: string, currentJwt?: string): Promise<LoginResult> {
  // 1. Ask auth-bridge to do PAR and return the authorization URL
  const { authUrl, state } = await authBridgePost({
    action: 'initiate',
    provider: 'atproto',
    handle,
    redirect_uri: REDIRECT_URI,
  })

  // 2. Open the Bluesky auth page — user logs in and approves
  const callbackUrl = await browser.identity.launchWebAuthFlow({
    url: authUrl as string,
    interactive: true,
  })
  if (!callbackUrl) throw new Error('Login was cancelled')

  // 3. Extract code, state, iss from the callback URL (query params)
  const url = new URL(callbackUrl)
  const code = url.searchParams.get('code')
  const iss = url.searchParams.get('iss')
  const returnedState = url.searchParams.get('state')

  if (!code || !iss || !returnedState) throw new Error('Missing callback parameters')
  if (returnedState !== (state as string)) throw new Error('State mismatch')

  // 4. Send callback params to auth-bridge — it does token exchange and mints a
  //    Supabase JWT. Returns the Mustard userId (UUID) and the atproto DID.
  //    Pass currentJwt when linking Bluesky to an already-logged-in account.
  const result = await authBridgePost({
    action: 'callback',
    provider: 'atproto',
    code,
    state,
    iss,
    ...(currentJwt !== undefined ? { currentJwt } : {}),
  })

  const userId = result.userId as string
  const did = result.did as string

  // 5. Store a minimal session as a fallback; the caller immediately runs
  //    syncSessionIdentities() to replace it with the authoritative identity set.
  await storeSession({
    userId,
    identities: [{ provider: 'atproto', providerAccountId: did, handle }],
  })

  return { userId, did, jwt: result.jwt as string, expiresAt: result.expiresAt as number }
}
