// Supabase JWT management for Chrome extension.
// First JWT comes from the login flow (auth-bridge callback).
// Subsequent JWTs are obtained via auth-bridge refresh using the expired JWT as proof.

import { getSession } from './AtprotoAuth'

const STORAGE_KEY = 'supabase_jwt'
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY
const AUTH_BRIDGE_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/auth-bridge`

interface CachedJwt {
  jwt: string
  did: string
  expiresAt: number
}

/**
 * Get a valid Supabase JWT, either from cache or by refreshing.
 * Returns null if user is not logged in or refresh fails (user must re-login).
 */
export async function getSupabaseJwt(): Promise<string | null> {
  const atprotoSession = await getSession()
  if (!atprotoSession) return null

  const cached = await getCachedJwt()
  if (cached && cached.did === atprotoSession.did && !isExpiringSoon(cached.expiresAt)) {
    return cached.jwt
  }

  // No valid cache — try refreshing with the expired JWT
  if (cached?.jwt) {
    try {
      const response = await fetch(AUTH_BRIDGE_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
        },
        body: JSON.stringify({
          action: 'refresh',
          did: atprotoSession.did,
          expired_jwt: cached.jwt,
        }),
      })

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}))
        console.error('[SupabaseAuth] Refresh failed:', response.status, errorData)
        return null
      }

      const data: { jwt: string; expiresAt: number } = await response.json()
      await storeSupabaseJwt(data.jwt, data.expiresAt, atprotoSession.did)
      return data.jwt
    } catch (error) {
      console.error('[SupabaseAuth] Refresh error:', error)
      return null
    }
  }

  return null
}

/**
 * Store a Supabase JWT in the cache. Called by the login flow after auth-bridge callback.
 */
export async function storeSupabaseJwt(jwt: string, expiresAt: number, did: string): Promise<void> {
  await chrome.storage.local.set({
    [STORAGE_KEY]: { jwt, did, expiresAt } satisfies CachedJwt,
  })
}

/**
 * Clear the cached JWT. Must be called on logout.
 */
export async function clearSupabaseJwt(): Promise<void> {
  await chrome.storage.local.remove(STORAGE_KEY)
}

// --- Private helpers ---

async function getCachedJwt(): Promise<CachedJwt | null> {
  const result = await chrome.storage.local.get(STORAGE_KEY)
  return (result[STORAGE_KEY] as CachedJwt | undefined) ?? null
}

function isExpiringSoon(expiresAt: number): boolean {
  const now = Math.floor(Date.now() / 1000)
  return now >= expiresAt - 60
}
