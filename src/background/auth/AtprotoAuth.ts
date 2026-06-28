// AT Protocol authentication via BFF (Backend For Frontend) pattern.
// The auth-bridge Edge Function handles all OAuth crypto (DPoP, PKCE, token exchange).
// The extension only opens the auth page and forwards the callback parameters.

import { authBridgePost } from './AuthBridge'
import type { LinkedIdentity } from '@/shared/model/UserProfile'

const REDIRECT_URI = browser.identity.getRedirectURL('callback')
const STORAGE_KEY = 'atproto_session'

// Canonical session shape — a single source of truth. The account is an opaque
// Mustard UUID plus the full set of linked provider identities (fetched from the
// server). Everything display-related (primary provider, handle, atproto DID) is
// DERIVED from `identities` via the selectors below — never stored separately.
type StoredSession = {
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

/**
 * Persist the canonical session. Shared across providers (the storage key is
 * provider-agnostic) so e.g. GitHub login can record a session that getSession()
 * and updateActionBadge() read.
 */
export async function storeSession(session: StoredSession): Promise<void> {
  await browser.storage.local.set({ [STORAGE_KEY]: session })
}

// Shape of sessions stored by older builds (pre multi-provider single-identity).
type LegacyStoredSession = {
  userId?: string
  did?: string
  handle?: string
  provider?: string
  avatarUrl?: string
  identities?: LinkedIdentity[]
}

/**
 * Read stored session info. Does NOT validate tokens — only checks if user logged
 * in before. Normalizes sessions written by older builds into the canonical
 * { userId, identities } shape; GET_ATPROTO_SESSION re-syncs from the server when
 * the identity set is empty.
 */
export async function getSession(): Promise<StoredSession | undefined> {
  const result = await browser.storage.local.get(STORAGE_KEY)
  const raw = result[STORAGE_KEY] as LegacyStoredSession | undefined
  if (!raw) return undefined

  const first = raw.identities?.[0]
  if (first) {
    return { userId: raw.userId ?? first.providerAccountId, identities: raw.identities! }
  }

  const userId = raw.userId ?? raw.did
  if (!userId) return undefined

  // Reconstruct a single identity from the legacy denormalized fields when possible.
  const identities: LinkedIdentity[] = raw.did
    ? [{ provider: 'atproto', providerAccountId: raw.did, handle: raw.handle }]
    : []
  return { userId, identities }
}

/**
 * Logout — clears local state. Server session stays until tokens expire naturally.
 */
export async function logout(_userId: string): Promise<void> {
  await browser.storage.local.remove(STORAGE_KEY)
}

/**
 * Clear the stored ATProto session. Used when the server-side session is gone
 * and the user must re-authenticate.
 */
export async function clearStoredSession(): Promise<void> {
  await browser.storage.local.remove(STORAGE_KEY)
}
