/**
 * Mention encoding helpers shared by the editor (serialize), the renderer
 * (resolve to current handle), and the persistence layer (extract IDs).
 *
 * ## Identity space — IMPORTANT
 *
 * Mentions are addressed by **provider account id**, NOT by the Mustard UUID:
 *   - atproto → DID (e.g. did:plc:xxx)
 *   - github  → numeric account id
 *
 * This is deliberate: the mentioned person may not (yet) be a Mustard user, so
 * there is no UUID to reference. The DB notification triggers and get-index-v2
 * resolve these provider account ids → Mustard recipient UUIDs via the
 * `identities` table at read/notify time.
 *
 * ## Sentinel format
 *
 *   @[p:atproto:did:plc:xxx]  — provider + provider account id (DID)
 *   @[p:github:12345]         — provider + provider account id (numeric, NOT a UUID)
 *
 * A legacy bare-DID form `@[did:plc:xxx]` used to exist; migration 012 rewrote
 * all stored content to the unified form above, so only one format remains.
 *
 * ## What is persisted
 *
 * The `mentions TEXT[]` column stores these provider account ids.
 */

import type { UserProfileType } from './model/UserProfile'

// ─── Sentinel helpers ─────────────────────────────────────────────────────────

/**
 * Returns a regex matching the `@[p:provider:accountId]` sentinel.
 * Capturing groups:
 *   Group 1: provider
 *   Group 2: accountId
 *
 * Returned per-call to avoid shared global regex lastIndex state.
 */
export function makeMentionSentinelRegex(): RegExp {
  return /@\[p:([^:\]]+):([^\]\s]+)\]/g
}

// ─── Extraction & derivation ──────────────────────────────────────────────────

/**
 * A mention target: the network it points at plus the provider account id on
 * that network (DID for atproto, numeric id for github). This is the canonical
 * in-memory shape — the provider is always known, so downstream consumers
 * (profile resolution) never have to re-derive it from the id's string shape.
 */
export type MentionTarget = {
  provider: UserProfileType
  accountId: string
}

/**
 * Extracts the unique mention targets from content, preserving first-seen order.
 */
export function extractMentions(content: string): MentionTarget[] {
  const seen = new Set<string>()
  const targets: MentionTarget[] = []
  for (const match of content.matchAll(makeMentionSentinelRegex())) {
    if (seen.has(match[0])) continue
    seen.add(match[0])

    const provider: UserProfileType = match[1] === 'github' ? 'github' : 'atproto'
    targets.push({ provider, accountId: match[2]! })
  }
  return targets
}

/**
 * The unique provider account ids mentioned in a piece of content. These are the
 * values persisted in `mentions TEXT[]` (the provider is recoverable from the
 * sentinel, and the DB resolves them via `identities`, so only the id is stored).
 */
function extractMentionAccountIds(content: string): string[] {
  return [...new Set(extractMentions(content).map((m) => m.accountId))]
}

/**
 * The mention ids to persist for a note/comment: unique mention targets (provider
 * account ids) from the content. Content is the single source of truth — this is
 * derived at the write boundary. Self-notification is prevented by the DB trigger
 * (it compares the resolved recipient UUID against the author UUID), so no
 * author filtering is needed (and isn't possible here — author is a UUID, mention
 * ids are provider account ids).
 */
export function deriveMentions(content: string): string[] {
  return extractMentionAccountIds(content)
}

/** Short, human-ish fallback label for a provider account id whose handle isn't resolved yet. */
export function shortAccountId(accountId: string): string {
  // did:plc:abcd... → plc:abcd… | numeric/other → first 12 chars
  const withoutScheme = accountId.replace(/^did:/, '')
  return withoutScheme.length > 14 ? `${withoutScheme.slice(0, 12)}…` : withoutScheme
}
