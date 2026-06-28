export type UserProfileType = 'atproto' | 'github'
// A Mustard account id (opaque UUID). NOTE: a few code paths also flow raw
// provider account ids (e.g. a bare `did:` from a mention) through this type
// when the referenced person may not be a Mustard user; those are resolved
// directly against the provider rather than via the identities table.
export type UserId = string

// A renderable identity for ONE provider — what to actually paint for an author,
// reposter, or mention (display name, avatar, profile link). It is deliberately
// NOT a Mustard account: resolving an account's id can yield several profiles
// (one per LinkedIdentity), and the caller picks which one to show (atproto
// preferred). So profiles are a per-provider view, while LinkedIdentity is the
// account-level link record — keeping them separate avoids conflating "who this
// Mustard user is" with "how this one connection looks on screen".
export type UserProfile = {
  type: UserProfileType
  id: UserId
  displayName: string // Name to display (fallback to handle if not set)
  avatarUrl?: string // Profile picture URL
  handle?: string // Optional handle/username
}

// One provider connection on a Mustard account. A single account can hold
// several of these (e.g. atproto + github). `providerAccountId` is the
// provider's own stable id (DID for atproto, numeric id for github).
export type LinkedIdentity = {
  provider: UserProfileType
  providerAccountId: string
  handle?: string
}
