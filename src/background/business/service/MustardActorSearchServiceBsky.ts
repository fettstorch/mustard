import { Agent } from '@atproto/api'
import type { BskyProfile } from '@/shared/model/BskyProfile'

/** Public, pre-login Bluesky actor lookup for the login handle typeahead. */
export class MustardActorSearchServiceBsky {
  private agent = new Agent({ service: 'https://public.api.bsky.app' })

  async search(query: string): Promise<BskyProfile[]> {
    const q = query.trim().replace(/^@/, '')
    if (q.length < 2) return []

    try {
      const response = await this.agent.searchActorsTypeahead({ q, limit: 6 })
      return response.data.actors.map((actor) => ({
        type: 'atproto',
        id: actor.did,
        handle: actor.handle,
        displayName: actor.displayName ?? actor.handle,
        avatarUrl: actor.avatar,
      }))
    } catch (error) {
      console.error('MustardActorSearchServiceBsky.search failed:', error)
      return []
    }
  }
}
