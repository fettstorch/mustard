import type { UserProfileType } from './model/UserProfile'

/**
 * Provider profile/avatar URL helpers. These are general "where does this
 * provider live on the web" concerns shared by avatars, mention links, and
 * profile resolution — independent of the mention encoding in `mentions.ts`.
 */

export const BSKY_PROFILE_URL_PREFIX = 'https://bsky.app/profile/'
export const GITHUB_PROFILE_URL_PREFIX = 'https://github.com/'

/** Builds a profile URL for a given provider and its mutable handle. */
export function providerProfileUrl(provider: string, handle: string): string {
  switch (provider) {
    case 'github':
      return `${GITHUB_PROFILE_URL_PREFIX}${handle}`
    case 'atproto':
    default:
      return `${BSKY_PROFILE_URL_PREFIX}${handle}`
  }
}

/** GitHub serves a public, token-free avatar at github.com/<login>.png. */
export function githubAvatarUrl(login: string): string {
  return `${GITHUB_PROFILE_URL_PREFIX}${login}.png`
}

/** Human-readable network name for a provider, used in user-facing copy. */
export const PROVIDER_LABELS: Record<UserProfileType, string> = {
  atproto: 'Bluesky',
  github: 'GitHub',
}

/** Display order for provider lists in copy (Bluesky first, then GitHub). */
const PROVIDER_DISPLAY_ORDER: UserProfileType[] = ['atproto', 'github']

/** Joins labels with commas and a trailing "and" ("A", "A and B", "A, B, and C"). */
function andList(items: string[]): string {
  if (items.length <= 1) return items[0] ?? ''
  if (items.length === 2) return `${items[0]} and ${items[1]}`
  return `${items.slice(0, -1).join(', ')}, and ${items[items.length - 1]}`
}

/**
 * The "who can see this" phrase for the publish warning, tailored to the
 * providers actually linked to the account: "all your Bluesky followers",
 * "all your GitHub followers", or "all your Bluesky and GitHub followers".
 * Falls back to a provider-agnostic "all your followers" when the connected
 * providers are unknown (logged out, or session not yet loaded).
 */
export function followersPhrase(providers: readonly UserProfileType[]): string {
  const labels = PROVIDER_DISPLAY_ORDER.filter((p) => providers.includes(p)).map(
    (p) => PROVIDER_LABELS[p],
  )
  if (labels.length === 0) return 'all your followers'
  return `all your ${andList(labels)} followers`
}
