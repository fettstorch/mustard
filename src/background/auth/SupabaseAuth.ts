// Supabase JWT management for Chrome extension.
// First JWT comes from the login flow (auth-bridge callback).
// Subsequent JWTs are obtained via auth-bridge refresh using the expired JWT as proof.

import { getSession, clearStoredSession } from './SessionStore'
import { broadcastToAllTabs } from '@/shared/messaging'
import { synchronize } from '@fettstorch/jule'

const STORAGE_KEY = 'supabase_jwt'
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY
const AUTH_BRIDGE_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/auth-bridge`

interface CachedJwt {
  jwt: string
  userId: string // stable Mustard user id (was `did` before multi-provider migration)
  expiresAt: number
}

/**
 * Get a valid Supabase JWT, either from cache or by refreshing.
 * Returns null if user is not logged in or refresh fails (user must re-login).
 *
 * `synchronize` serializes concurrent callers behind a single module-wide lock.
 * On page load several message handlers (session, index, profiles, notifications)
 * call this at once; without serialization each would independently see an
 * expiring token and fire its own auth-bridge refresh — a thundering herd where
 * later refreshes can invalidate earlier tokens. Serialized, only the first call
 * refreshes; the rest re-enter, read the freshly-stored JWT from cache, and
 * return it. The valid-token fast path is a cheap storage read, so serializing it
 * too is harmless — and unlike a memoized result, re-running the body means every
 * call re-validates against the current session (no stale token after a switch).
 */
export const getSupabaseJwt = synchronize(async (): Promise<string | null> => {
  // A session here always carries a UUID userId: pre-migration DID sessions live
  // under the old storage key (never read, purged at startup), so they surface as
  // "no session" and force a fresh login.
  const session = await getSession()
  if (!session) return null

  const cached = await getCachedJwt()
  if (cached && cached.userId === session.userId && !isExpiringSoon(cached.expiresAt)) {
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
          userId: session.userId,
          expired_jwt: cached.jwt,
        }),
      })

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}))
        console.error('[SupabaseAuth] Refresh failed:', response.status, errorData)

        // Non-transient failures (4xx, 502) mean the server-side session is gone —
        // clear all credentials, notify the user, and broadcast so UI updates immediately.
        if (response.status < 500 || response.status === 502) {
          console.warn(
            '[SupabaseAuth] Session invalidated server-side — clearing credentials, user must re-login',
          )
          await clearSupabaseJwt()
          await clearStoredSession()
          await broadcastSessionCleared()
        }

        return null
      }

      const data: { jwt: string; expiresAt: number } = await response.json()
      await storeSupabaseJwt(data.jwt, data.expiresAt, session.userId)
      return data.jwt
    } catch (error) {
      console.error('[SupabaseAuth] Refresh error:', error)
      return null
    }
  }

  return null
})

/**
 * Store a Supabase JWT in the cache. Called by the login flow after auth-bridge callback.
 */
export async function storeSupabaseJwt(
  jwt: string,
  expiresAt: number,
  userId: string,
): Promise<void> {
  await browser.storage.local.set({
    [STORAGE_KEY]: { jwt, userId, expiresAt } satisfies CachedJwt,
  })
}

/**
 * Clear the cached JWT. Must be called on logout.
 */
export async function clearSupabaseJwt(): Promise<void> {
  await browser.storage.local.remove(STORAGE_KEY)
}

// --- Private helpers ---

async function getCachedJwt(): Promise<CachedJwt | null> {
  const result = await browser.storage.local.get(STORAGE_KEY)
  const raw = result[STORAGE_KEY] as (CachedJwt & { did?: string }) | undefined
  if (!raw) return null
  // Cache entries stored before the multi-provider migration keyed the JWT by
  // atproto DID. After the server moved to UUID subjects the DID-subject token
  // is unusable (it would write under the wrong identity), so treat such legacy
  // entries as absent — the caller then forces a one-time re-login.
  if (!raw.userId || raw.userId.startsWith('did:')) return null
  return raw as CachedJwt
}

function isExpiringSoon(expiresAt: number): boolean {
  const now = Math.floor(Date.now() / 1000)
  return now >= expiresAt - 60
}

/** Notify all tabs that the session has been cleared so content scripts can update. */
async function broadcastSessionCleared(): Promise<void> {
  await broadcastToAllTabs({ type: 'SESSION_CHANGED', userId: null, providers: [] })
  await broadcastToAllTabs({ type: 'SESSION_EXPIRED' })
}
