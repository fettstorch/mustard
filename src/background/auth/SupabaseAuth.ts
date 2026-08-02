// Supabase JWT management for Chrome extension.
//
// The first jwt+refreshToken pair comes from the login flow (auth-bridge
// callback). Subsequent jwts are obtained by rotating the refreshToken via
// auth-bridge `refresh` — a short-lived (24h) jwt backed by a revocable,
// server-side session (see supabase/functions/auth-bridge/sessions.ts).
//
// A cache entry with no `refreshToken` predates this overhaul; it triggers a
// one-time exchange (see refreshSession) instead of a rotate, then behaves
// like every other session from then on.

import { getSession, clearStoredSession } from './SessionStore'
import { broadcastToAllTabs } from '@/shared/messaging'
import { retryable, synchronize } from '@fettstorch/jule'

const STORAGE_KEY = 'supabase_jwt'
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY
const AUTH_BRIDGE_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/auth-bridge`
const SESSION_REVOCATION_TIMEOUT_MS = 5_000
const SESSION_REVOCATION_MAX_TRIES = 3

interface CachedJwt {
  jwt: string
  userId: string // stable Mustard user id (was `did` before multi-provider migration)
  expiresAt: number
  refreshToken?: string // absent = legacy cache predating refresh tokens; triggers a one-time exchange
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
  if (cached && cached.userId !== session.userId) {
    await clearSupabaseJwt()
    await clearStoredSession()
    await broadcastSessionCleared()
    return null
  }

  if (cached && cached.userId === session.userId && !isExpiringSoon(cached.expiresAt)) {
    return cached.jwt
  }

  if (cached?.refreshToken) {
    return await refreshSession(session.userId, { refreshToken: cached.refreshToken })
  }
  // Legacy cache predating refresh tokens — one-time exchange. Once it
  // succeeds the cache gains a refreshToken and never hits this branch again.
  if (cached?.jwt) {
    return await refreshSession(session.userId, {
      userId: session.userId,
      expired_jwt: cached.jwt,
      clientVersion: browser.runtime.getManifest().version,
    })
  }

  return null
})

/** Shared refresh call for both the steady-state and one-time-legacy-exchange paths. */
async function refreshSession(
  userId: string,
  body: { refreshToken: string } | { userId: string; expired_jwt: string; clientVersion: string },
): Promise<string | null> {
  try {
    const response = await fetch(AUTH_BRIDGE_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
      },
      body: JSON.stringify({ action: 'refresh', ...body }),
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

    const data: { jwt: string; expiresAt: number; refreshToken: string } = await response.json()
    await storeSupabaseJwt(data.jwt, data.expiresAt, userId, data.refreshToken)
    return data.jwt
  } catch (error) {
    console.error('[SupabaseAuth] Refresh error:', error)
    return null
  }
}

/**
 * Store a jwt+refreshToken pair in the cache. Called by the login flow after
 * auth-bridge callback, and internally after every refresh/exchange.
 */
export async function storeSupabaseJwt(
  jwt: string,
  expiresAt: number,
  userId: string,
  refreshToken: string,
): Promise<void> {
  await browser.storage.local.set({
    [STORAGE_KEY]: { jwt, userId, expiresAt, refreshToken } satisfies CachedJwt,
  })
}

/**
 * Clear the cached JWT locally only. Not exported — every external caller
 * should go through `revokeSupabaseSession` so the server-side session
 * (and its refresh token) doesn't outlive the local logout.
 */
async function clearSupabaseJwt(): Promise<void> {
  await browser.storage.local.remove(STORAGE_KEY)
}

/**
 * Revoke the current session server-side (deletes its mustard_sessions row so
 * the refresh token can't be reused elsewhere) and clear local credentials.
 * Best-effort on the network call: a failed revoke must never block the user
 * from logging out on this device — they end up logged out locally either way.
 */
export async function revokeSupabaseSession(): Promise<void> {
  const cached = await getCachedJwt()
  // End the active local session first. Keep the refresh token only in this
  // stack frame for a bounded best-effort server revocation; never persist a
  // usable credential after logout merely so it can be retried later.
  await clearSupabaseJwt()
  if (!cached?.refreshToken) return

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), SESSION_REVOCATION_TIMEOUT_MS)
  try {
    await retryable(async ({ retry, tryCount }) => {
      const response = await fetch(AUTH_BRIDGE_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
        },
        body: JSON.stringify({ action: 'logout', refreshToken: cached.refreshToken }),
        signal: controller.signal,
      }).catch((error: unknown) => {
        if (!controller.signal.aborted && tryCount < SESSION_REVOCATION_MAX_TRIES) {
          retry({ backoffMs: 250 * tryCount })
        }
        throw error
      })

      if (response.ok) return
      if (isRetryableRevocationStatus(response.status) && tryCount < SESSION_REVOCATION_MAX_TRIES) {
        retry({ backoffMs: 250 * tryCount })
      }
      throw new Error(`Server-side session revocation failed (${response.status})`)
    })
  } catch (error) {
    console.warn(
      '[SupabaseAuth] Failed to revoke server-side session (logged out locally anyway):',
      error,
    )
  } finally {
    clearTimeout(timeout)
  }
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

function isRetryableRevocationStatus(status: number): boolean {
  return status === 408 || status === 429 || status >= 500
}

/** Notify all tabs that the session has been cleared so content scripts can update. */
async function broadcastSessionCleared(): Promise<void> {
  await broadcastToAllTabs({ type: 'SESSION_CHANGED', userId: null, providers: [] })
  await broadcastToAllTabs({ type: 'SESSION_EXPIRED' })
}
