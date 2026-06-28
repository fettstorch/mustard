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
