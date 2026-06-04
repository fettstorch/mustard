/**
 * Mention encoding helpers shared by the editor (serialize), the renderer
 * (resolve to current handle), and the persistence layer (extract DIDs).
 *
 * Mentions are stored DID-canonically inside note/comment markdown content as a
 * sentinel `@[did:plc:xxx]`. Handles are mutable, so nothing handle-related is
 * persisted — the current handle is resolved at render time. The link target
 * also uses the DID, which Bluesky accepts in `/profile/` URLs and which is
 * stable across handle changes.
 */

export const BSKY_PROFILE_URL_PREFIX = 'https://bsky.app/profile/'

/** Builds a Bluesky profile URL for a DID (or handle). */
export function bskyProfileUrl(didOrHandle: string): string {
  return `${BSKY_PROFILE_URL_PREFIX}${didOrHandle}`
}

/**
 * Builds a fresh global regex matching the stored mention sentinel `@[did:...]`
 * (the DID is captured in group 1; DIDs never contain `]`, so the class is safe).
 *
 * Returned per-call rather than exported as a shared `const` so the global
 * `lastIndex` can never leak across callers (`.matchAll`/`.replace` are safe,
 * but a shared `/g` regex is a footgun the moment someone calls `.test`/`.exec`).
 */
export function makeMentionSentinelRegex(): RegExp {
  return /@\[(did:[^\]\s]+)\]/g
}

/**
 * Extracts the unique DIDs mentioned in a piece of markdown content (from the
 * `@[did:...]` sentinels), preserving first-seen order.
 */
export function extractMentionDids(content: string): string[] {
  const seen = new Set<string>()
  for (const match of content.matchAll(makeMentionSentinelRegex())) {
    const did = match[1]
    if (did) seen.add(did)
  }
  return [...seen]
}

/**
 * The mention DIDs to persist for a note/comment: every mentioned DID in the
 * content minus the author (you never notify yourself). Content is the single
 * source of truth — this is derived at the write boundary, not threaded through
 * the app.
 */
export function deriveMentions(content: string, authorId: string): string[] {
  return extractMentionDids(content).filter((did) => did !== authorId)
}

/** Short, human-ish fallback label for a DID whose handle isn't resolved yet. */
export function shortDid(did: string): string {
  // did:plc:abcd... → plc:abcd… (kept compact; only a transient placeholder)
  const withoutScheme = did.replace(/^did:/, '')
  return withoutScheme.length > 14 ? `${withoutScheme.slice(0, 12)}…` : withoutScheme
}
