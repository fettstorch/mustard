// Mustard session lifecycle: opaque, rotating refresh tokens backed by the
// `mustard_sessions` table (migration 020). Replaces the old model where the
// Supabase JWT itself was re-verified (with a huge clock-tolerance) as its
// own refresh credential.
//
// Only a SHA-256 hash of each refresh token is ever persisted — a DB read
// alone can't mint a usable session. Tokens rotate on every refresh; the
// previous hash stays valid for a short grace window so a service-worker
// restart that races a refresh doesn't strand the caller.

import * as jose from 'https://deno.land/x/jose@v5.2.0/index.ts'
import type { SupabaseClient } from 'jsr:@supabase/supabase-js@2'

export const REFRESH_TOKEN_TTL_MS = 90 * 24 * 60 * 60 * 1000
const ROTATION_GRACE_MS = 10 * 60 * 1000

interface SessionRow {
  id: string
  user_id: string
  refresh_token_hash: string
  prev_token_hash: string | null
  prev_valid_until: string | null
  expires_at: string
}

function generateToken(): string {
  return jose.base64url.encode(crypto.getRandomValues(new Uint8Array(32)))
}

async function hashToken(token: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token))
  return jose.base64url.encode(new Uint8Array(digest))
}

export type SessionPair = { sessionId: string; userId: string; refreshToken: string }

/** Create a brand-new session for `userId` (fresh login, or legacy-JWT exchange). */
export async function createSession(
  supabase: SupabaseClient,
  userId: string,
): Promise<SessionPair> {
  const refreshToken = generateToken()
  const { data, error } = await supabase
    .from('mustard_sessions')
    .insert({
      user_id: userId,
      refresh_token_hash: await hashToken(refreshToken),
      expires_at: new Date(Date.now() + REFRESH_TOKEN_TTL_MS).toISOString(),
    })
    .select('id')
    .single()
  if (error || !data) throw new Error(`Failed to create session: ${error?.message}`)

  return { sessionId: (data as { id: string }).id, userId, refreshToken }
}

/** Revoke one verified user's session by its JWT `sid` claim. */
export async function revokeSessionById(
  supabase: SupabaseClient,
  sessionId: string,
  userId: string,
): Promise<void> {
  const { error } = await supabase
    .from('mustard_sessions')
    .delete()
    .eq('id', sessionId)
    .eq('user_id', userId)
  if (error) throw new Error(`Failed to revoke superseded session: ${error.message}`)
}

/**
 * Validate + rotate a refresh token. Returns the new session pair, or null if
 * the token is unknown, was rotated out beyond the grace window, or the
 * session's sliding 90-day idle window has lapsed (both mean: re-login).
 */
export async function rotateSession(
  supabase: SupabaseClient,
  refreshToken: string,
): Promise<SessionPair | null> {
  const hash = await hashToken(refreshToken)
  const now = new Date()

  const { data, error } = await supabase
    .from('mustard_sessions')
    .select('id, user_id, refresh_token_hash, prev_token_hash, prev_valid_until, expires_at')
    .or(`refresh_token_hash.eq.${hash},prev_token_hash.eq.${hash}`)
    .maybeSingle()
  if (error) throw new Error(`Session lookup failed: ${error.message}`)

  const row = data as SessionRow | null
  if (!row) return null
  if (new Date(row.expires_at) < now) return null

  const matchedCurrent = row.refresh_token_hash === hash
  const matchedPrevInGrace =
    row.prev_token_hash === hash && row.prev_valid_until && new Date(row.prev_valid_until) > now
  if (!matchedCurrent && !matchedPrevInGrace) return null

  const newToken = generateToken()
  const { error: updateError } = await supabase
    .from('mustard_sessions')
    .update({
      refresh_token_hash: await hashToken(newToken),
      prev_token_hash: hash,
      prev_valid_until: new Date(now.getTime() + ROTATION_GRACE_MS).toISOString(),
      last_refreshed_at: now.toISOString(),
      expires_at: new Date(now.getTime() + REFRESH_TOKEN_TTL_MS).toISOString(),
    })
    .eq('id', row.id)
  if (updateError) throw new Error(`Session rotation failed: ${updateError.message}`)

  return { sessionId: row.id, userId: row.user_id, refreshToken: newToken }
}

/** Revoke a session by its (current or just-rotated-out) refresh token. Idempotent. */
export async function revokeSession(
  supabase: SupabaseClient,
  refreshToken: string,
): Promise<void> {
  const hash = await hashToken(refreshToken)
  const { error } = await supabase
    .from('mustard_sessions')
    .delete()
    .or(`refresh_token_hash.eq.${hash},prev_token_hash.eq.${hash}`)
  if (error) throw new Error(`Failed to revoke session: ${error.message}`)
}
