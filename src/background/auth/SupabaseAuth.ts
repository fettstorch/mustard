// Supabase JWT management for Chrome extension
// Fetches, caches, and refreshes JWTs from the auth-bridge Edge Function

import { getSession } from './AtprotoAuth'

const STORAGE_KEY = 'supabase_jwt'
const SUPABASE_PROJECT_ID = 'dexvrkxjgitrebqetvjw'
const SUPABASE_ANON_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRleHZya3hqZ2l0cmVicWV0dmp3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njc5ODQwMTcsImV4cCI6MjA4MzU2MDAxN30.2hzb5-dpI0XYbklfqFsK5CkDeNXXlE1V78Q1eEgV4iI'
const AUTH_BRIDGE_URL = `https://${SUPABASE_PROJECT_ID}.supabase.co/functions/v1/auth-bridge`

interface CachedJwt {
  jwt: string
  expiresAt: number // Unix timestamp in seconds
}

/**
 * Get a valid Supabase JWT, either from cache or by fetching a new one.
 * Returns null if user is not logged in or if auth-bridge is not configured.
 */
export async function getSupabaseJwt(): Promise<string | null> {
  const atprotoSession = await getSession()
  if (!atprotoSession) {
    return null
  }

  // Check cache first
  const cached = await getCachedJwt()
  if (cached && !isExpiringSoon(cached.expiresAt)) {
    return cached.jwt
  }

  // Fetch new JWT from auth-bridge
  try {
    const response = await fetch(AUTH_BRIDGE_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
      },
      body: JSON.stringify({ did: atprotoSession.did }),
    })

    if (!response.ok) {
      const text = await response.text()
      console.error('Auth bridge response:', response.status, text)
      let errorMessage = response.statusText
      try {
        const errorJson = JSON.parse(text)
        errorMessage = errorJson.error || errorJson.message || text
      } catch {
        errorMessage = text || response.statusText
      }
      throw new Error(`Auth bridge failed (${response.status}): ${errorMessage}`)
    }

    const data: { jwt: string; expiresAt: number } = await response.json()

    // Cache the new JWT
    await chrome.storage.local.set({
      [STORAGE_KEY]: {
        jwt: data.jwt,
        expiresAt: data.expiresAt,
      } satisfies CachedJwt,
    })

    return data.jwt
  } catch (error) {
    console.error('Failed to get Supabase JWT:', error)
    return null
  }
}

/**
 * Clear the cached JWT (e.g., on logout)
 */
async function clearSupabaseJwt(): Promise<void> {
  await chrome.storage.local.remove(STORAGE_KEY)
}

// --- Private helpers ---

async function getCachedJwt(): Promise<CachedJwt | null> {
  const result = await chrome.storage.local.get(STORAGE_KEY)
  return (result[STORAGE_KEY] as CachedJwt | undefined) ?? null
}

function isExpiringSoon(expiresAt: number): boolean {
  const now = Math.floor(Date.now() / 1000)
  const bufferSeconds = 60 // Refresh 1 minute before expiration
  return now >= expiresAt - bufferSeconds
}
