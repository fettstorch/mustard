import type { UserProfile } from '@/shared/model/UserProfile'

export interface MustardProfileService {
  getProfile(userId: string): Promise<UserProfile | null>
}
