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

export { expect } from '@playwright/test'
