import { Agent } from '@atproto/api'
import type { MustardProfileService } from './MustardProfileService'
import type { BskyProfile } from '@/shared/model/BskyProfile'

export class MustardProfileServiceBsky implements MustardProfileService {
  // Uses public API - no authentication required, works for all AT Protocol users
  // TODO: If authenticated profile actions are needed later, use an authenticated Agent
  // from a validated OAuthSession (see AtprotoAuth.ts TODO about client.init())
  private agent = new Agent({ service: 'https://public.api.bsky.app' })

  async getProfile(did: string): Promise<BskyProfile | null> {
    try {
      const response = await this.agent.getProfile({ actor: did })

      return {
        type: 'atproto',
        id: response.data.did,
        handle: response.data.handle,
        displayName: response.data.displayName ?? response.data.handle,
        avatarUrl: response.data.avatar,
      }
    } catch {
      // Profile not found or API error
      return null
    }
  }
}
