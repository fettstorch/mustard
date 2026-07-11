import { chromium, type BrowserContext, test as base } from '@playwright/test'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import type { TestUser } from './authenticated/auth-test-data'
import { createAuthE2eJwt } from './authenticated/auth-test-data'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const extensionPath = path.resolve(__dirname, '../../dist/chrome')

export type ExtensionFixtures = {
  context: BrowserContext
  extensionId: string
  popupUrl: string
}

/**
 * Swap the Mustard session inside the running extension to act as a different
 * test user. Call this from inside a test; reload any open popup pages after.
 */
export async function loginAs(context: BrowserContext, user: TestUser): Promise<void> {
  let sw = context.serviceWorkers()[0]
  if (!sw) sw = await context.waitForEvent('serviceworker')
  const token = createAuthE2eJwt(user.userId)
  await sw.evaluate(
    async (args: {
      session: { userId: string; identities: TestUser['identity'][] }
      jwt: { jwt: string; userId: string; expiresAt: number }
    }) => {
      const ext = globalThis as typeof globalThis & {
        chrome: {
          storage: {
            local: { set(items: Record<string, unknown>): Promise<void> }
            session: { clear(): Promise<void> }
          }
        }
      }
      await ext.chrome.storage.local.set({
        mustard_session: args.session,
        supabase_jwt: args.jwt,
      })
      await ext.chrome.storage.session.clear()
    },
    {
      session: { userId: user.userId, identities: [user.identity] },
      jwt: { jwt: token.jwt, userId: user.userId, expiresAt: token.expiresAt },
    },
  )
}

/**
 * Launches a persistent Chromium context with Mustard loaded from dist/chrome.
 * Uses `channel: 'chromium'` so extensions work in headless mode (no Xvfb needed in CI).
 * The extension must be built before running E2E tests (`nr build:e2e`).
 */
export const test = base.extend<ExtensionFixtures>({
  context: async ({}, use, testInfo) => {
    const context = await chromium.launchPersistentContext(testInfo.outputPath('user-data-dir'), {
      channel: 'chromium',
      args: [
        `--disable-extensions-except=${extensionPath}`,
        `--load-extension=${extensionPath}`,
        '--no-sandbox',
      ],
    })
    await use(context)
    await context.close()
  },

  extensionId: async ({ context }, use) => {
    let serviceWorker = context.serviceWorkers()[0]
    if (!serviceWorker) {
      serviceWorker = await context.waitForEvent('serviceworker')
    }
    await use(new URL(serviceWorker.url()).hostname)
  },

  popupUrl: async ({ extensionId }, use) => {
    await use(`chrome-extension://${extensionId}/popup.html`)
  },
})

export { expect } from '@playwright/test'
