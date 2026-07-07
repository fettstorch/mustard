import { Agent } from '@atproto/api'
import { cached } from '@fettstorch/jule'
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

  // Per-DID mutuals cache with TTL, via jule `cached`. As a bonus it de-dupes
  // concurrent callers onto one in-flight fetch within the TTL window. A failure
  // is evicted in getMutuals below so a rejected promise is never memoized —
  // otherwise `cached` would replay the error for the whole TTL instead of
  // retrying on the next call.
  private readonly loadMutuals = cached(
    async (did: string): Promise<BskyProfile[]> => {
      const [followProfiles, followerDids] = await Promise.all([
        this.fetchFollows(did),
        this.fetchFollowerDids(did),
      ])

      const mutuals = followProfiles.filter((p) => followerDids.has(p.id))
      mutuals.sort((a, b) =>
        a.displayName.localeCompare(b.displayName, undefined, { sensitivity: 'base' }),
      )
      return mutuals
    },
    { ttlMs: MustardMutualsServiceBsky.CACHE_TTL_MS },
  )

  async getMutuals(did: string): Promise<BskyProfile[]> {
    try {
      return await this.loadMutuals(did)
    } catch (err) {
      // Drop the memoized rejection so the next call retries instead of
      // replaying the error until the TTL lapses.
      this.loadMutuals.evict(did)
      console.error('MustardMutualsServiceBsky.getMutuals failed:', err)
      return []
    }
  }

  /** Invalidate the cache (e.g. on logout). */
  clear(): void {
    this.loadMutuals.clear()
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
