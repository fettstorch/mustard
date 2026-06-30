import type { UserProfileType } from './UserProfile'

/**
 * An @-mention autocomplete candidate. Provider-tagged because a mention is tied
 * to a specific network (a github mention links to github, a bluesky mention to
 * bsky) — see `shared/mentions.ts`. `accountId` is the provider account id (DID
 * for atproto, numeric id for github) that gets baked into the mention sentinel
 * and persisted in `mentions TEXT[]`.
 */
export type MentionCandidate = {
  provider: UserProfileType
  accountId: string
  handle: string
  displayName: string
  avatarUrl?: string
}
