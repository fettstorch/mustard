import type { Satisfies } from '../Satisfies'
import type { UserProfile } from './UserProfile'

/** Bluesky profile - satisfies UserProfile with handle required */
export type BskyProfile = Satisfies<
  UserProfile,
  {
    type: 'atproto'
    id: string // The DID
    displayName: string
    avatarUrl?: string
    handle: string // Required for Bluesky (not optional)
  }
>
