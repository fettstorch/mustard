// Provider-agnostic session store. Persists the canonical Mustard session and
// exposes read/derive helpers shared by every auth provider (atproto, GitHub, …)
// and every consumer (popup, options, badge, JWT path). Provider-specific OAuth
// lives in the per-provider modules (e.g. AtprotoAuth, GithubAuth).

import type { LinkedIdentity } from '@/shared/model/UserProfile'

const STORAGE_KEY = 'mustard_session'

// Pre-multi-provider builds stored a (often DID-shaped) session under this key.
// Migration 011 deleted the matching server sessions, so those blobs are
// unusable; purgeLegacySessionStorage() drops them on startup.
const LEGACY_STORAGE_KEY = 'atproto_session'

// Canonical session shape — a single source of truth. The account is an opaque
// Mustard UUID plus the full set of linked provider identities (fetched from the
// server). Everything display-related (primary provider, handle, atproto DID) is
// DERIVED from `identities` via the selectors below — never stored separately.
export type StoredSession = {
  userId: string // stable Mustard account id (UUID); primary key for all DB ops
  identities: LinkedIdentity[] // all providers linked to this account (server is source of truth)
}

/**
 * The identity used for display and the badge. atproto is preferred because it
 * has a resolvable Bluesky profile and a DID for mutuals; otherwise the first.
 */
export function primaryIdentity(session: StoredSession): LinkedIdentity | undefined {
  return session.identities.find((i) => i.provider === 'atproto') ?? session.identities[0]
}

/**
 * Persist the canonical session. Provider-agnostic: e.g. GitHub login can record
 * a session that getSession() and updateActionBadge() read.
 */
export async function storeSession(session: StoredSession): Promise<void> {
  await browser.storage.local.set({ [STORAGE_KEY]: session })
}

/**
 * Read stored session info. Does NOT validate tokens — only checks if the user
 * logged in before. The key is written exclusively by storeSession(), so the
 * blob is always the canonical { userId, identities } shape; legacy DID sessions
 * live under LEGACY_STORAGE_KEY and are never read (forcing a fresh login).
 * GET_ATPROTO_SESSION re-syncs from the server when the identity set is empty.
 */
export async function getSession(): Promise<StoredSession | undefined> {
  const result = await browser.storage.local.get(STORAGE_KEY)
  const raw = result[STORAGE_KEY] as StoredSession | undefined
  if (!raw?.userId) return undefined
  return { userId: raw.userId, identities: raw.identities ?? [] }
}

/**
 * Drop the pre-multi-provider session blob. The server session it referenced was
 * deleted by migration 011, so it is unusable; removing it keeps storage tidy and
 * guarantees no legacy DID session can ever be read. Safe no-op once gone.
 */
export async function purgeLegacySessionStorage(): Promise<void> {
  await browser.storage.local.remove(LEGACY_STORAGE_KEY)
}

/**
 * Logout — clears local state. Server session stays until tokens expire naturally.
 */
export async function logout(_userId: string): Promise<void> {
  await browser.storage.local.remove(STORAGE_KEY)
}

/**
 * Clear the stored session. Used when the server-side session is gone and the
 * user must re-authenticate.
 */
export async function clearStoredSession(): Promise<void> {
  await browser.storage.local.remove(STORAGE_KEY)
}
