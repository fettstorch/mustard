import { execFileSync } from 'node:child_process'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { AUTH_E2E_USER, createAuthE2eJwt, LOCAL_SUPABASE } from './auth-test-data'

type LocalStatus = {
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

  if (
    status.ANON_KEY !== LOCAL_SUPABASE.anonKey ||
    status.JWT_SECRET !== LOCAL_SUPABASE.jwtSecret
  ) {
    throw new Error(
      'The local Supabase keys differ from Mustard’s fixed E2E keys. Reset the local stack before running authenticated E2E tests.',
    )
  }

  return status as LocalStatus
}

function adminClient(status: LocalStatus): SupabaseClient {
  return createClient(status.API_URL, status.SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
}

export async function cleanupAuthE2eData(status = getLocalSupabaseStatus()): Promise<void> {
  const admin = adminClient(status)
  const { error: notesError } = await admin
    .from('notes')
    .delete()
    .eq('author_id', AUTH_E2E_USER.userId)
  if (notesError) throw new Error(`Could not clean E2E notes: ${notesError.message}`)

  const { error: userError } = await admin.from('users').delete().eq('id', AUTH_E2E_USER.userId)
  if (userError) throw new Error(`Could not clean E2E user: ${userError.message}`)
}

export async function seedAuthE2eData(status = getLocalSupabaseStatus()): Promise<void> {
  await cleanupAuthE2eData(status)
  const admin = adminClient(status)

  const { error: userError } = await admin.from('users').insert({ id: AUTH_E2E_USER.userId })
  if (userError) throw new Error(`Could not seed E2E user: ${userError.message}`)

  const { error: identityError } = await admin.from('identities').insert({
    user_id: AUTH_E2E_USER.userId,
    provider: AUTH_E2E_USER.identity.provider,
    provider_account_id: AUTH_E2E_USER.identity.providerAccountId,
    handle: AUTH_E2E_USER.identity.handle,
  })
  if (identityError) throw new Error(`Could not seed E2E identity: ${identityError.message}`)

  const { error: followsError } = await admin.from('follows_cache').insert({
    user_id: AUTH_E2E_USER.userId,
    followed_user_ids: [],
    fetched_at: new Date().toISOString(),
  })
  if (followsError) throw new Error(`Could not seed E2E follow cache: ${followsError.message}`)
}

export async function verifyLocalFunctions(status = getLocalSupabaseStatus()): Promise<void> {
  const { jwt } = createAuthE2eJwt()
  let response: Response
  try {
    response = await fetch(`${status.API_URL}/functions/v1/get-index-v2`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${jwt}` },
      body: JSON.stringify({ userId: AUTH_E2E_USER.userId }),
    })
  } catch {
    throw new Error(
      'Local Edge Functions are not running. In another terminal run `supabase functions serve --env-file supabase/functions/.env.e2e`.',
    )
  }

  if (!response.ok) {
    const detail = await response.text()
    throw new Error(`Local get-index-v2 check failed (${response.status}): ${detail}`)
  }
}
