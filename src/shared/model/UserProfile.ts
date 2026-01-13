export type UserProfileType = 'atproto'
export type UserId = string // Unique ID (DID for atproto)

export type UserProfile = {
  type: UserProfileType
  id: UserId
  displayName: string // Name to display (fallback to handle if not set)
  avatarUrl?: string // Profile picture URL
  handle?: string // Optional handle/username
}
