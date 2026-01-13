import type { UserProfile, UserId } from '@/shared/model/UserProfile'

export interface MustardProfileService {
  /** Fetch profiles for multiple users in bulk. Returns a map of userId -> profile (null if not found) */
  getProfiles(userIds: UserId[]): Promise<Record<UserId, UserProfile | null>>
}
