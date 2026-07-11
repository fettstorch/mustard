import { test as base } from '../extension.fixture'
import { AUTH_E2E_USER, createAuthE2eJwt } from './auth-test-data'

type AuthenticatedFixture = {
  authenticated: void
}

export const test = base.extend<AuthenticatedFixture>({
  authenticated: [
    async ({ context }, use) => {
      let serviceWorker = context.serviceWorkers()[0]
      if (!serviceWorker) {
        serviceWorker = await context.waitForEvent('serviceworker')
      }

      const token = createAuthE2eJwt()
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

      await use()
    },
    { auto: true },
  ],
})

export { expect } from '@playwright/test'
