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

    const result: Record<UserId, BskyProfile | null> = {}
    // Default every requested id to null; successful lookups overwrite below.
    for (const id of userIds) {
      result[id] = null
    }

    // app.bsky.actor.getProfiles caps `actors` at 25, so split into chunks,
    // fetch them in parallel, and merge. A failing chunk only leaves its own
    // ids null instead of nulling every profile.
    const batches = await Promise.all(
      chunk(userIds, GET_PROFILES_MAX_ACTORS).map((c) => this.fetchProfileChunk(c)),
    )
    for (const batch of batches) {
      Object.assign(result, batch)
    }
    return result
  }

  private async fetchProfileChunk(actors: UserId[]): Promise<Record<UserId, BskyProfile>> {
    try {
      const response = await this.agent.getProfiles({ actors })
      const mapped: Record<UserId, BskyProfile> = {}
      for (const profile of response.data.profiles) {
        mapped[profile.did] = {
          type: 'atproto',
          id: profile.did,
          handle: profile.handle,
          displayName: profile.displayName ?? profile.handle,
          avatarUrl: profile.avatar,
        }
      }
      return mapped
    } catch {
      return {}
    }
  }
}

/** Max `actors` per app.bsky.actor.getProfiles call (lexicon maxLength). */
const GET_PROFILES_MAX_ACTORS = 25

function chunk<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = []
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size))
  }
  return chunks
}
