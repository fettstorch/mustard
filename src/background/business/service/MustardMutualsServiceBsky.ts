import { Agent } from '@atproto/api'
import type { BskyProfile } from '@/shared/model/BskyProfile'

/**
 * Resolves the current user's *mutuals* — people they follow who also follow
 * them back — for the @-mention autocomplete.
 *
 * We compute mutuals as the set intersection of getFollows ∩ getFollowers,
 * because the unauthenticated public AppView agent does NOT return per-actor
 * `viewer.followedBy` state (that requires an authenticated session). Both
 * getFollows and getFollowers are public endpoints, so the intersection is the
 * only auth-free way to know "they follow me back".
 *
 * The full profile (handle, displayName, avatar) is taken from the getFollows
 * response, so no extra getProfiles round-trip is needed.
 */
export class MustardMutualsServiceBsky {
  private agent = new Agent({ service: 'https://public.api.bsky.app' })

  // Bound the work for accounts with very large social graphs.
  private static readonly MAX_PAGES = 50 // 50 * 100 = up to 5000 each side
  private static readonly PAGE_LIMIT = 100
  private static readonly CACHE_TTL_MS = 5 * 60 * 1000

  private cache: { did: string; mutuals: BskyProfile[]; timestamp: number } | null = null

  async getMutuals(did: string): Promise<BskyProfile[]> {
    const now = Date.now()
    if (
      this.cache &&
      this.cache.did === did &&
      now - this.cache.timestamp < MustardMutualsServiceBsky.CACHE_TTL_MS
    ) {
      return this.cache.mutuals
    }

    try {
      const [followProfiles, followerDids] = await Promise.all([
        this.fetchFollows(did),
        this.fetchFollowerDids(did),
      ])

      const mutuals = followProfiles.filter((p) => followerDids.has(p.id))
      mutuals.sort((a, b) =>
        a.displayName.localeCompare(b.displayName, undefined, { sensitivity: 'base' }),
      )

      this.cache = { did, mutuals, timestamp: now }
      return mutuals
    } catch (err) {
      console.error('MustardMutualsServiceBsky.getMutuals failed:', err)
      return []
    }
  }

  /** Invalidate the cache (e.g. on logout). */
  clear(): void {
    this.cache = null
  }

  private async fetchFollows(did: string): Promise<BskyProfile[]> {
    const result: BskyProfile[] = []
    let cursor: string | undefined
    let pages = 0

    do {
      const res = await this.agent.getFollows({
        actor: did,
        limit: MustardMutualsServiceBsky.PAGE_LIMIT,
        cursor,
      })
      for (const f of res.data.follows) {
        result.push({
          type: 'atproto',
          id: f.did,
          handle: f.handle,
          displayName: f.displayName ?? f.handle,
          avatarUrl: f.avatar,
        })
      }
      cursor = res.data.cursor
      pages++
    } while (cursor && pages < MustardMutualsServiceBsky.MAX_PAGES)

    return result
  }

  private async fetchFollowerDids(did: string): Promise<Set<string>> {
    const result = new Set<string>()
    let cursor: string | undefined
    let pages = 0

    do {
      const res = await this.agent.getFollowers({
        actor: did,
        limit: MustardMutualsServiceBsky.PAGE_LIMIT,
        cursor,
      })
      for (const f of res.data.followers) result.add(f.did)
      cursor = res.data.cursor
      pages++
    } while (cursor && pages < MustardMutualsServiceBsky.MAX_PAGES)

    return result
  }
}
