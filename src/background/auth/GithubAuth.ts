// GitHub OAuth authentication via BFF (Backend For Frontend) pattern.
// Uses the same auth-bridge Edge Function as atproto, with provider='github'.
// No DPoP — standard authorization code flow with PKCE.

import { authBridgePost } from './AuthBridge'

const REDIRECT_URI = browser.identity.getRedirectURL('callback')

type GithubLoginResult = { userId: string; jwt: string; expiresAt: number }

/**
 * Start GitHub OAuth flow via BFF.
 *
 * When `currentJwt` is provided, the GitHub identity is linked to the
 * already-logged-in Mustard account (the "Connect GitHub" flow in Options).
 * When omitted, a new login / sign-up is performed.
 */
export async function loginWithGithub(currentJwt?: string): Promise<GithubLoginResult> {
  // 1. Ask auth-bridge to initiate: returns a GitHub authorization URL + state
  const { authUrl, state } = await authBridgePost({
    action: 'initiate',
    provider: 'github',
    redirect_uri: REDIRECT_URI,
  })

  // 2. Open the GitHub auth page — user logs in and approves
  const callbackUrl = await browser.identity.launchWebAuthFlow({
    url: authUrl as string,
    interactive: true,
  })
  if (!callbackUrl) throw new Error('Login was cancelled')

  // 3. Extract code and state from the callback URL
  const url = new URL(callbackUrl)
  const code = url.searchParams.get('code')
  const returnedState = url.searchParams.get('state')

  if (!code || !returnedState) throw new Error('Missing callback parameters')
  if (returnedState !== (state as string)) throw new Error('State mismatch')

  // 4. Send callback params to auth-bridge — it exchanges the code, verifies
  //    identity via GET /user, and mints a Supabase JWT.
  //    Pass currentJwt if provided so auth-bridge can link this identity
  //    to an existing Mustard account.
  const result = await authBridgePost({
    action: 'callback',
    provider: 'github',
    code,
    state,
    ...(currentJwt !== undefined ? { currentJwt } : {}),
  })

  const userId = result.userId as string

  // The session is persisted by the GITHUB_LOGIN handler via
  // syncSessionIdentities(), which fetches the authoritative identity set
  // (including this GitHub identity's providerAccountId) from the server.
  return { userId, jwt: result.jwt as string, expiresAt: result.expiresAt as number }
}
