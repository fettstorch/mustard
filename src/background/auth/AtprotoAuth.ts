// AT Protocol authentication via BFF (Backend For Frontend) pattern.
// The auth-bridge Edge Function handles all OAuth crypto (DPoP, PKCE, token exchange).
// The extension only opens the auth page and forwards the callback parameters.
//
// Provider-agnostic session persistence/reads live in SessionStore.

import type { OAuthLoginFlow } from '../platform/OAuthLoginFlow'
import type { PendingLogin } from '@/shared/oauth-login'
import { createOAuthLoginFlow } from '../platform/createBrowserPlatform'
import { storeSession, type StoredSession } from './SessionStore'

/** The account's atproto DID, if any (for atproto-specific ops like getMutuals). */
export function atprotoDid(session: StoredSession): string | undefined {
  return session.identities.find((i) => i.provider === 'atproto')?.providerAccountId
}

type LoginResult = {
  userId: string
  did: string
  jwt: string
  expiresAt: number
  refreshToken: string
}

/**
 * Start atproto login flow: auth-bridge does PAR, user authenticates, auth-bridge
 * exchanges code and returns both the DID and a fresh Supabase JWT.
 */
export async function login(
  handle: string,
  currentJwt?: string,
  flow: OAuthLoginFlow = createOAuthLoginFlow(),
): Promise<LoginResult | PendingLogin> {
  const result = await flow.start({ provider: 'atproto', handle, currentJwt })
  if ('pending' in result) return result

  const userId = result.userId as string
  const did = result.did as string

  // Store a minimal session as a fallback; the caller immediately runs
  //    syncSessionIdentities() to replace it with the authoritative identity set.
  await storeSession({
    userId,
    identities: [{ provider: 'atproto', providerAccountId: did, handle }],
  })

  return {
    userId,
    did,
    jwt: result.jwt as string,
    expiresAt: result.expiresAt as number,
    refreshToken: result.refreshToken as string,
  }
}
