// Thin client for the auth-bridge Edge Function. Shared by every provider
// (atproto, github) and by the identity-management calls (list / disconnect).
// All OAuth crypto lives server-side; the extension only POSTs JSON here.

import type { LinkedIdentity } from '@/shared/model/UserProfile'
import type { MentionCandidate } from '@/shared/model/MentionCandidate'
import { githubAvatarUrl } from '@/shared/providers'

const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY
const AUTH_BRIDGE_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/auth-bridge`

/**
 * POST a JSON action to auth-bridge and return the parsed body.
 *
 * Reads the response as text first: a failing edge function (timeout /
 * early-termination) returns plain-text "Internal Server Error", not JSON.
 * Parsing blindly would throw a confusing SyntaxError that hides the real
 * status, so we surface the status + raw snippet instead.
 */
export async function authBridgePost(
  body: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const resp = await fetch(AUTH_BRIDGE_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
    },
    body: JSON.stringify(body),
  })

  const raw = await resp.text()
  let data: Record<string, unknown> = {}
  try {
    data = raw ? JSON.parse(raw) : {}
  } catch {
    if (!resp.ok) throw new Error(`auth-bridge ${resp.status}: ${raw.slice(0, 200)}`)
    throw new Error(`auth-bridge returned non-JSON (${resp.status})`)
  }
  if (!resp.ok) throw new Error((data.error as string) || `auth-bridge ${resp.status}`)
  return data
}

type RawIdentity = { provider: string; provider_account_id: string; handle?: string | null }

/** Every provider connection on the caller's account (server is source of truth). */
export async function listIdentities(jwt: string): Promise<LinkedIdentity[]> {
  const result = await authBridgePost({ action: 'list-identities', currentJwt: jwt })
  const rows = (result.identities as RawIdentity[] | undefined) ?? []
  return rows.map((r) => ({
    provider: r.provider as LinkedIdentity['provider'],
    providerAccountId: r.provider_account_id,
    handle: r.handle ?? undefined,
  }))
}

/**
 * Resolve a batch of Mustard userIds (UUIDs) → their linked provider identities.
 * The `identities` table is service-role only, so this server round-trip is the
 * only way the extension can turn an opaque author UUID back into a renderable
 * provider profile (atproto DID → bsky profile, github login → avatar).
 *
 * Non-UUID ids (legacy DIDs, mention sentinels) are ignored server-side and
 * simply won't appear in the returned map.
 */
export async function resolveIdentities(
  jwt: string,
  userIds: string[],
): Promise<Map<string, LinkedIdentity[]>> {
  const result = await authBridgePost({ action: 'resolve-identities', currentJwt: jwt, userIds })
  const rows = (result.identities as (RawIdentity & { user_id: string })[] | undefined) ?? []
  const map = new Map<string, LinkedIdentity[]>()
  for (const r of rows) {
    const list = map.get(r.user_id) ?? []
    list.push({
      provider: r.provider as LinkedIdentity['provider'],
      providerAccountId: r.provider_account_id,
      handle: r.handle ?? undefined,
    })
    map.set(r.user_id, list)
  }
  return map
}

/**
 * Reverse of {@link resolveIdentities}: map github account ids (the numeric ids
 * from `@[p:github:…]` mention sentinels) → their current @login, so a mention
 * can render linking to the github profile. Only account ids belonging to a
 * Mustard user resolve. Returned map is keyed by accountId; the value is the
 * login (or undefined when the row has no stored handle).
 */
export async function resolveGithubAccounts(
  jwt: string,
  accountIds: string[],
): Promise<Map<string, string | undefined>> {
  const result = await authBridgePost({
    action: 'resolve-accounts',
    currentJwt: jwt,
    provider: 'github',
    accountIds,
  })
  const rows = (result.identities as RawIdentity[] | undefined) ?? []
  const map = new Map<string, string | undefined>()
  for (const r of rows) {
    map.set(r.provider_account_id, r.handle ?? undefined)
  }
  return map
}

/**
 * The github accounts the caller follows who are also Mustard users — the only
 * github accounts that can be @-mentioned (see auth-bridge for why). Empty for
 * accounts with no github identity. The server returns the minimal identity
 * (accountId + login); we enrich to a renderable MentionCandidate here so the
 * avatar-url shape stays single-sourced on the client.
 */
export async function getGithubMentionCandidates(jwt: string): Promise<MentionCandidate[]> {
  const result = await authBridgePost({ action: 'github-mention-candidates', currentJwt: jwt })
  const rows = (result.candidates as { accountId: string; handle: string }[] | undefined) ?? []
  return rows.map(
    (c): MentionCandidate => ({
      provider: 'github',
      accountId: c.accountId,
      handle: c.handle,
      displayName: c.handle,
      avatarUrl: githubAvatarUrl(c.handle),
    }),
  )
}

/**
 * Unlink one provider from the caller's account. Returns whether this was the
 * last identity (in which case the whole account + all content was deleted).
 */
export async function disconnectProvider(
  jwt: string,
  provider: string,
): Promise<{ accountDeleted: boolean }> {
  const result = await authBridgePost({ action: 'disconnect', currentJwt: jwt, provider })
  return { accountDeleted: Boolean(result.accountDeleted) }
}
