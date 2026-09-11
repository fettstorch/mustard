import { supabase } from '@/background/supabase-client'
import { cached } from '@fettstorch/jule'

const CACHE_TTL_MS = 5 * 60 * 1000

export class MinimumVersionCriterion {
  private lastKnownVersion: string | null = null

  async getMinimumVersion(): Promise<string> {
    try {
      return await this.fetchMinimumVersion()
    } catch (error) {
      // Jule caches returned promises, including rejected ones. Evict failures
      // so the next action retries instead of waiting for the TTL.
      this.fetchMinimumVersion.evict()
      // A transient backend failure must never lock the client. Reuse the last
      // known requirement, or assume compatibility until a check succeeds.
      console.debug(
        'mustard [extension-update] minimum-version fetch failed, assuming compatible:',
        error,
      )
      return this.lastKnownVersion ?? '0.0.0'
    }
  }

  private readonly fetchMinimumVersion = cached(
    async (): Promise<string> => {
      const { data, error } = await supabase
        .from('app_config')
        .select('min_client_version')
        .eq('id', 1)
        .maybeSingle()
      if (error) throw error

      const version =
        (data as { min_client_version?: string } | null)?.min_client_version ?? '0.0.0'
      this.lastKnownVersion = version
      return version
    },
    { ttlMs: CACHE_TTL_MS },
  )
}
