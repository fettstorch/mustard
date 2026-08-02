import { mergeTests, type BrowserContext } from '@playwright/test'
import { test as extensionTest } from '../extension.fixture'
import { AUTH_E2E_USER, createAuthE2eJwt } from './auth-test-data'
import { test as localSupabaseTest } from './local-supabase.fixture'

const base = mergeTests(extensionTest, localSupabaseTest)

type AuthenticatedFixture = {
  authenticatedContext: BrowserContext
}

export const test = base.extend<AuthenticatedFixture>({
  authenticatedContext: async ({ context, isolatedLocalSupabase: _isolatedLocalSupabase }, use) => {
    let serviceWorker = context.serviceWorkers()[0]
    if (!serviceWorker) {
      serviceWorker = await context.waitForEvent('serviceworker')
    }

    // Persistent contexts include tabs created during extension installation
    // (currently the onboarding page). Close them before injecting auth state:
    // their content scripts can otherwise query with the test user and refill
    // storage.session after the cache clear below, hiding data seeded by the test.
    await Promise.all(context.pages().map((page) => page.close()))

    const token = createAuthE2eJwt(AUTH_E2E_USER.userId)
    await serviceWorker.evaluate(
      async ({ user, jwt, expiresAt }) => {
        const extension = globalThis as typeof globalThis & {
          chrome: {
            storage: {
              local: {
                set(items: Record<string, unknown>): Promise<void>
              }
              session: {
                clear(): Promise<void>
              }
            }
          }
        }

        await extension.chrome.storage.local.set({
          mustard_session: {
            userId: user.userId,
            identities: [user.identity],
          },
          supabase_jwt: {
            jwt,
            userId: user.userId,
            expiresAt,
          },
        })
        await extension.chrome.storage.session.clear()
      },
      { user: AUTH_E2E_USER, ...token },
    )

    await use(context)
  },
})

type SupabaseJwtCache = {
  jwt: string
  userId: string
  expiresAt: number
  refreshToken?: string // absent = legacy shape, matching a pre-overhaul cache entry
}

/**
 * Override the extension's cached supabase_jwt entry for the already-injected
 * test user. Lets a spec exercise a specific cache shape (legacy jwt-only, an
 * expiring v2 pair, an already-revoked refreshToken, …) instead of the fresh
 * legacy jwt `authenticatedContext` injects by default.
 */
export async function setSupabaseJwtCache(
  context: BrowserContext,
  cache: SupabaseJwtCache,
): Promise<void> {
  let serviceWorker = context.serviceWorkers()[0]
  if (!serviceWorker) {
    serviceWorker = await context.waitForEvent('serviceworker')
  }
  await serviceWorker.evaluate(async (value) => {
    const extension = globalThis as typeof globalThis & {
      chrome: { storage: { local: { set(items: Record<string, unknown>): Promise<void> } } }
    }
    await extension.chrome.storage.local.set({ supabase_jwt: value })
  }, cache)
}

/** Read back the extension's current supabase_jwt cache entry (undefined once cleared). */
export async function getSupabaseJwtCache(
  context: BrowserContext,
): Promise<SupabaseJwtCache | undefined> {
  let serviceWorker = context.serviceWorkers()[0]
  if (!serviceWorker) {
    serviceWorker = await context.waitForEvent('serviceworker')
  }
  return serviceWorker.evaluate(async () => {
    const extension = globalThis as typeof globalThis & {
      chrome: { storage: { local: { get(key: string): Promise<Record<string, unknown>> } } }
    }
    const result = await extension.chrome.storage.local.get('supabase_jwt')
    return result.supabase_jwt as SupabaseJwtCache | undefined
  })
}

export { expect } from '@playwright/test'
