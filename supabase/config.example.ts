/**
 * Supabase Configuration
 * 
 * Copy this file to config.ts and fill in your Supabase project credentials.
 * Get these from: https://supabase.com/dashboard/project/<your-project>/settings/api
 * 
 * IMPORTANT: Add config.ts to .gitignore to keep credentials private!
 */
export const supabaseConfig = {
  // Your Supabase project URL (e.g., "https://xxxxx.supabase.co")
  url: process.env.SUPABASE_URL || '',
  
  // Your Supabase anon/public key (safe to expose in client-side code)
  anonKey: process.env.SUPABASE_ANON_KEY || '',
}
