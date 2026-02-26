// Supabase client configured for Chrome extension use
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { getSupabaseJwt } from './auth/SupabaseAuth'

const SUPABASE_PROJECT_ID = 'dexvrkxjgitrebqetvjw'
const SUPABASE_URL = `https://${SUPABASE_PROJECT_ID}.supabase.co`
// Anon key is public and safe to expose - RLS policies protect data
const SUPABASE_ANON_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRleHZya3hqZ2l0cmVicWV0dmp3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njc5ODQwMTcsImV4cCI6MjA4MzU2MDAxN30.2hzb5-dpI0XYbklfqFsK5CkDeNXXlE1V78Q1eEgV4iI'

/**
 * Supabase client configured to use custom JWT from auth-bridge.
 * The accessToken callback ensures we always use a valid JWT.
 */
export const supabase: SupabaseClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  accessToken: async (): Promise<string | null> => {
    return await getSupabaseJwt()
  },
})
