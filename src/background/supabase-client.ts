// Supabase client configured for Chrome extension use
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { getSupabaseJwt } from './auth/SupabaseAuth'

// Anon key is public and safe to expose - RLS policies protect data
const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY

/**
 * Supabase client configured to use custom JWT from auth-bridge.
 * The accessToken callback ensures we always use a valid JWT.
 */
export const supabase: SupabaseClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  accessToken: async (): Promise<string | null> => {
    return await getSupabaseJwt()
  },
})
