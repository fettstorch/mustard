import { supabase } from '@/background/supabase-client'

const CACHE_TTL_MS = 5 * 60 * 1000

export class MinimumVersionCriterion {
  private cached: { version: string; at: number } | null = null

  async getMinimumVersion(): Promise<string> {
    const now = Date.now()
    if (this.cached && now - this.cached.at < CACHE_TTL_MS) return this.cached.version

    try {
      const { data, error } = await supabase
        .from('app_config')
        .select('min_client_version')
        .eq('id', 1)
        .maybeSingle()
      if (error) throw error

      const version =
        (data as { min_client_version?: string } | null)?.min_client_version ?? '0.0.0'
      this.cached = { version, at: now }
      return version
    } catch (error) {
      // A transient backend failure must never lock the client. Reuse the last
      // known requirement, or assume compatibility until a check succeeds.
      console.debug(
        'mustard [extension-update] minimum-version fetch failed, assuming compatible:',
        error,
      )
      return this.cached?.version ?? '0.0.0'
    }
  }
}
