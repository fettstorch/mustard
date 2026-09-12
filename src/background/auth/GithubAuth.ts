// GitHub OAuth authentication via BFF (Backend For Frontend) pattern.
// Uses the same auth-bridge Edge Function as atproto, with provider='github'.
// No DPoP — standard authorization code flow with PKCE.

import type { OAuthLoginFlow } from '../platform/OAuthLoginFlow'
import type { PendingLogin } from '@/shared/oauth-login'
import { createOAuthLoginFlow } from '../platform/createBrowserPlatform'

type GithubLoginResult = { userId: string; jwt: string; expiresAt: number; refreshToken: string }

/**
 * Start GitHub OAuth flow via BFF.
 *
 * When `currentJwt` is provided, the GitHub identity is linked to the
 * already-logged-in Mustard account (the "Connect GitHub" flow in Options).
 * When omitted, a new login / sign-up is performed.
 */
export async function loginWithGithub(
  currentJwt?: string,
  flow: OAuthLoginFlow = createOAuthLoginFlow(),
): Promise<GithubLoginResult | PendingLogin> {
  const result = await flow.start({ provider: 'github', currentJwt })
  if ('pending' in result) return result

  const userId = result.userId as string

  // The session is persisted by the GITHUB_LOGIN handler via
  // syncSessionIdentities(), which fetches the authoritative identity set
  // (including this GitHub identity's providerAccountId) from the server.
  return {
    userId,
    jwt: result.jwt as string,
    expiresAt: result.expiresAt as number,
    refreshToken: result.refreshToken as string,
  }
}
