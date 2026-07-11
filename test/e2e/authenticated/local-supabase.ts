import { execFileSync } from 'node:child_process'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import {
  AUTH_E2E_USER,
  createAuthE2eJwt,
  LOCAL_SUPABASE,
  TEST_USERS,
  type TestUser,
} from './auth-test-data'

export type LocalStatus = {
  API_URL: string
  ANON_KEY: string
  SERVICE_ROLE_KEY: string
  JWT_SECRET: string
}

function parseEnv(output: string): Record<string, string> {
  return Object.fromEntries(
    output
      .split('\n')
      .map((line) => line.match(/^([A-Z_]+)="?(.*?)"?$/))
      .filter((match): match is RegExpMatchArray => match !== null)
      .map((match) => [match[1], match[2]]),
  )
}

export function getLocalSupabaseStatus(): LocalStatus {
  let output: string
  try {
    output = execFileSync('supabase', ['status', '-o', 'env'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    })
  } catch {
    throw new Error(
      'Local Supabase is not running. Start Docker, then run `supabase start` before authenticated E2E tests.',
    )
  }

  const status = parseEnv(output)
  for (const key of ['API_URL', 'ANON_KEY', 'SERVICE_ROLE_KEY', 'JWT_SECRET'] as const) {
    if (!status[key]) throw new Error(`supabase status did not return ${key}`)
  }

  // Only validate the JWT secret — the anon key varies across CLI versions and
  // is injected dynamically via VITE_SUPABASE_ANON_KEY in CI.
  if (status.JWT_SECRET !== LOCAL_SUPABASE.jwtSecret) {
    throw new Error(
      'The local Supabase JWT_SECRET differs from the fixed E2E value. Reset the local stack before running authenticated E2E tests.',
    )
  }

  return status as LocalStatus
}

export function adminClient(status: LocalStatus): SupabaseClient {
  return createClient(status.API_URL, status.SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
}

// ─── Individual user seeding ─────────────────────────────────────────────────

async function seedUser(admin: SupabaseClient, user: TestUser): Promise<void> {
  const { error: userError } = await admin.from('users').insert({ id: user.userId })
  if (userError)
    throw new Error(`Could not seed user ${user.identity.handle}: ${userError.message}`)

  const { error: idError } = await admin.from('identities').insert({
    user_id: user.userId,
    provider: user.identity.provider,
    provider_account_id: user.identity.providerAccountId,
    handle: user.identity.handle,
  })
  if (idError)
    throw new Error(`Could not seed identity for ${user.identity.handle}: ${idError.message}`)
}

async function deleteUser(admin: SupabaseClient, userId: string): Promise<void> {
  // CASCADE on notes/identities/follows_cache/etc. handles the rest
  await admin.from('users').delete().eq('id', userId)
}

// ─── Legacy single-user helpers (used by global-setup / existing smoke tests) ─

export async function cleanupAuthE2eData(status = getLocalSupabaseStatus()): Promise<void> {
  await cleanupAllE2eUsers(status)
}

export async function seedAuthE2eData(status = getLocalSupabaseStatus()): Promise<void> {
  await seedAllE2eUsers(status)
}

// ─── Multi-user seeding ───────────────────────────────────────────────────────

/** Seed all four deterministic test users with empty follow caches. */
export async function seedAllE2eUsers(status = getLocalSupabaseStatus()): Promise<void> {
  const admin = adminClient(status)

  // Clean first so the suite is idempotent
  await cleanupAllE2eUsers(status)

  for (const user of Object.values(TEST_USERS)) {
    await seedUser(admin, user)

    // Empty follow caches prevent get-index-v2 from triggering a live refresh
    const { error } = await admin.from('follows_cache').insert({
      user_id: user.userId,
      followed_user_ids: [],
      fetched_at: new Date().toISOString(),
    })
    if (error)
      throw new Error(`Could not seed follows_cache for ${user.identity.handle}: ${error.message}`)
  }
}

/** Remove all four deterministic test users and all their cascade data. */
export async function cleanupAllE2eUsers(status = getLocalSupabaseStatus()): Promise<void> {
  const admin = adminClient(status)
  for (const user of Object.values(TEST_USERS)) {
    await deleteUser(admin, user.userId)
  }
}

// ─── Per-test data helpers ───────────────────────────────────────────────────

/** Update a user's follow list in follows_cache (bypasses live provider refresh). */
export async function setFollows(
  userId: string,
  followedUserIds: string[],
  status = getLocalSupabaseStatus(),
): Promise<void> {
  const admin = adminClient(status)
  const { error } = await admin.from('follows_cache').upsert({
    user_id: userId,
    followed_user_ids: followedUserIds,
    fetched_at: new Date().toISOString(),
    refresh_started_at: null,
  })
  if (error) throw new Error(`Could not update follows_cache for ${userId}: ${error.message}`)
}

/** Seed a remote note by the given author on the given page URL. Returns the note id. */
export async function seedNote(
  authorId: string,
  pageUrl: string,
  content = 'E2E test note',
  status = getLocalSupabaseStatus(),
): Promise<string> {
  const admin = adminClient(status)
  const { data, error } = await admin
    .from('notes')
    .insert({
      author_id: authorId,
      page_url: pageUrl,
      content,
      relative_position_x: 50,
      relative_position_y: 50,
      click_position_x: 50,
      click_position_y: 300,
    })
    .select('id')
    .single()
  if (error) throw new Error(`Could not seed note: ${error.message}`)
  return (data as { id: string }).id
}

/** Delete a note by id. */
export async function deleteNote(noteId: string, status = getLocalSupabaseStatus()): Promise<void> {
  const admin = adminClient(status)
  await admin.from('notes').delete().eq('id', noteId)
}

/** Seed a repost of noteId by reposterId. */
export async function seedRepost(
  noteId: string,
  reposterId: string,
  status = getLocalSupabaseStatus(),
): Promise<void> {
  const admin = adminClient(status)
  const { error } = await admin.from('reposts').insert({ note_id: noteId, reposter_id: reposterId })
  if (error) throw new Error(`Could not seed repost: ${error.message}`)
}

/** Delete the repost of noteId by reposterId. */
export async function deleteRepost(
  noteId: string,
  reposterId: string,
  status = getLocalSupabaseStatus(),
): Promise<void> {
  const admin = adminClient(status)
  await admin.from('reposts').delete().eq('note_id', noteId).eq('reposter_id', reposterId)
}

/** Seed a comment on noteId by authorId. Returns the comment id. */
export async function seedComment(
  noteId: string,
  authorId: string,
  content = 'E2E test comment',
  status = getLocalSupabaseStatus(),
): Promise<string> {
  const admin = adminClient(status)
  const { data, error } = await admin
    .from('comments')
    .insert({ note_id: noteId, author_id: authorId, content })
    .select('id')
    .single()
  if (error) throw new Error(`Could not seed comment: ${error.message}`)
  return (data as { id: string }).id
}

/** Delete a comment by id. */
export async function deleteComment(
  commentId: string,
  status = getLocalSupabaseStatus(),
): Promise<void> {
  const admin = adminClient(status)
  await admin.from('comments').delete().eq('id', commentId)
}

/**
 * Call get-index-v2 as the given user and return its JSON response.
 * Re-uses the fixed local JWT; never calls a real provider.
 */
export async function fetchIndex(
  userId: string,
  status = getLocalSupabaseStatus(),
): Promise<{
  index: Record<string, string[]>
  repostedNoteIds: string[]
  mentionedNoteIds: string[]
  repostersByNoteId: Record<string, string[]>
}> {
  const { jwt } = createAuthE2eJwt(userId)
  const res = await fetch(`${status.API_URL}/functions/v1/get-index-v2`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${jwt}` },
    body: JSON.stringify({ userId }),
  })
  if (!res.ok) {
    const detail = await res.text()
    throw new Error(`get-index-v2 failed (${res.status}): ${detail}`)
  }
  return res.json() as Promise<{
    index: Record<string, string[]>
    repostedNoteIds: string[]
    mentionedNoteIds: string[]
    repostersByNoteId: Record<string, string[]>
  }>
}

// ─── Function-readiness check ─────────────────────────────────────────────────

/**
 * Verify that local Edge Functions are serving get-index-v2.
 * Retries for up to 30 s to handle slow startup in CI.
 */
export async function verifyLocalFunctions(status = getLocalSupabaseStatus()): Promise<void> {
  const { jwt } = createAuthE2eJwt(AUTH_E2E_USER.userId)
  const url = `${status.API_URL}/functions/v1/get-index-v2`
  const maxAttempts = 15

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    if (attempt > 0) await new Promise((r) => setTimeout(r, 2000))

    let response: Response
    try {
      response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${jwt}` },
        body: JSON.stringify({ userId: AUTH_E2E_USER.userId }),
      })
    } catch {
      // Network error — functions not yet serving
      if (attempt === maxAttempts - 1) {
        throw new Error(
          'Local Edge Functions are not running after 30 s. Run `supabase functions serve --env-file supabase/functions/.env.e2e`.',
        )
      }
      continue
    }

    if (response.ok) return

    // Non-network error (e.g. 500 from misconfigured JWT secret) — fail fast
    const detail = await response.text()
    throw new Error(`Local get-index-v2 check failed (${response.status}): ${detail}`)
  }
}
