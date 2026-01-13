import { Agent } from '@atproto/api'
import type { MustardProfileService } from './MustardProfileService'
import type { BskyProfile } from '@/shared/model/BskyProfile'
import type { UserId } from '@/shared/model/UserProfile'

export class MustardProfileServiceBsky implements MustardProfileService {
  // Uses public API - no authentication required, works for all AT Protocol users
  // TODO: If authenticated profile actions are needed later, use an authenticated Agent
  // from a validated OAuthSession (see AtprotoAuth.ts TODO about client.init())
  private agent = new Agent({ service: 'https://public.api.bsky.app' })

  async getProfiles(userIds: UserId[]): Promise<Record<UserId, BskyProfile | null>> {
    if (userIds.length === 0) return {}

    try {
      // Use bulk endpoint: app.bsky.actor.getProfiles
      const response = await this.agent.getProfiles({ actors: userIds })

      const result: Record<UserId, BskyProfile | null> = {}
      // Initialize all requested IDs to null (in case some aren't returned)
      for (const id of userIds) {
        result[id] = null
      }
      // Map returned profiles
      for (const profile of response.data.profiles) {
        result[profile.did] = {
          type: 'atproto',
          id: profile.did,
          handle: profile.handle,
          displayName: profile.displayName ?? profile.handle,
          avatarUrl: profile.avatar,
        }
      }
      return result
    } catch {
      // API error - return all nulls
      const result: Record<UserId, BskyProfile | null> = {}
      for (const id of userIds) {
        result[id] = null
      }
      return result
    }
  }
}
