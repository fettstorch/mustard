import type { BrowserContext } from '@playwright/test'
import { expect, test } from '../e2e/extension.fixture'
import { adminClient, getLocalSupabaseStatus } from '../e2e/authenticated/local-supabase'

const handle = requiredEnv('BLUESKY_E2E_HANDLE')
const password = requiredEnv('BLUESKY_E2E_PASSWORD')

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim()
  if (!value) throw new Error(`${name} is required for the live Bluesky OAuth E2E test`)
  return value
}

type StoredAuth = {
  session?: {
    userId: string
    identities: Array<{
      provider: string
      providerAccountId: string
      handle?: string
    }>
  }
  jwt?: {
    jwt: string
    userId: string
    expiresAt: number
    refreshToken?: string
  }
}

async function readStoredAuth(context: BrowserContext): Promise<StoredAuth> {
  let serviceWorker = context.serviceWorkers()[0]
  if (!serviceWorker) serviceWorker = await context.waitForEvent('serviceworker')

  return serviceWorker.evaluate(async () => {
    const extension = globalThis as typeof globalThis & {
      chrome: {
        storage: {
          local: { get(keys: string[]): Promise<Record<string, unknown>> }
        }
      }
    }
    const stored = await extension.chrome.storage.local.get(['mustard_session', 'supabase_jwt'])
    return {
      session: stored.mustard_session,
      jwt: stored.supabase_jwt,
    } as StoredAuth
  })
}

test('completes a real Bluesky OAuth login and creates both sessions', async ({
  context,
  popupUrl,
}) => {
  // Discard the install-time onboarding page. The OAuth window is the only
  // non-popup page this test cares about.
  await Promise.all(context.pages().map((page) => page.close()))

  const popup = await context.newPage()
  await popup.goto(popupUrl)
  await popup.getByPlaceholder('your.handle.bsky.social').fill(handle)
  await popup.getByRole('button', { name: 'Login', exact: true }).click()

  let oauthPage = context.pages().find((page) => page.url().includes('/oauth/authorize'))
  await expect
    .poll(() => {
      oauthPage = context.pages().find((page) => page.url().includes('/oauth/authorize'))
      return oauthPage?.url()
    })
    .toMatch(/^https:\/\/[^/]+\/oauth\/authorize/)

  const admin = adminClient(getLocalSupabaseStatus())
  const { data: loginState, error: loginStateError } = await admin
    .from('oauth_login_state')
    .select('as_issuer')
    .eq('provider', 'atproto')
    .order('created_at', { ascending: false })
    .limit(1)
    .single()
  expect(loginStateError).toBeNull()
  expect(loginState!.as_issuer).toMatch(/^https:\/\//)

  await expect(oauthPage!.locator('input[name="username"]')).toHaveValue(handle)
  await oauthPage!.locator('input[name="password"]').fill(password)
  await oauthPage!.getByRole('button', { name: 'Sign in', exact: true }).click()

  // A prior grant may let the PDS skip consent. Otherwise authorize the test
  // client explicitly, then wait for Chrome to consume the callback and close
  // its launchWebAuthFlow window.
  const authorize = oauthPage!.getByRole('button', { name: 'Authorize', exact: true })
  const next = await Promise.race([
    authorize.waitFor({ state: 'visible' }).then(() => 'consent' as const),
    oauthPage!.waitForEvent('close').then(() => 'closed' as const),
  ])
  if (next === 'consent') {
    const closed = oauthPage!.waitForEvent('close')
    await authorize.click()
    await closed
  }

  let stored: StoredAuth = {}
  await expect
    .poll(async () => {
      stored = await readStoredAuth(context)
      return stored.session?.identities.some((identity) => identity.provider === 'atproto')
    })
    .toBe(true)

  const identity = stored.session!.identities.find((entry) => entry.provider === 'atproto')!
  expect(identity.providerAccountId).toMatch(/^did:/)
  expect(stored.session!.userId).toMatch(
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
  )
  expect(stored.jwt).toMatchObject({ userId: stored.session!.userId })
  expect(stored.jwt!.jwt).toBeTruthy()
  expect(stored.jwt!.refreshToken).toBeTruthy()
  expect(stored.jwt!.expiresAt).toBeGreaterThan(Math.floor(Date.now() / 1000))

  const { data: providerSession, error } = await admin
    .from('oauth_session')
    .select('provider, provider_account_id, user_id, refresh_token, as_issuer')
    .eq('provider', 'atproto')
    .eq('provider_account_id', identity.providerAccountId)
    .single()
  expect(error).toBeNull()
  expect(providerSession).toMatchObject({
    provider: 'atproto',
    provider_account_id: identity.providerAccountId,
    user_id: stored.session!.userId,
    as_issuer: loginState!.as_issuer,
  })
  expect(providerSession!.refresh_token).toBeTruthy()

  await expect(popup.getByRole('button', { name: 'Logout', exact: true })).toBeVisible()
  await popup.getByRole('button', { name: 'Logout', exact: true }).click()
  await expect.poll(async () => (await readStoredAuth(context)).session).toBeUndefined()
})
