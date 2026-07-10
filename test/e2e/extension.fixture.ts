import { chromium, type BrowserContext, test as base } from '@playwright/test'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const extensionPath = path.resolve(__dirname, '../../dist/chrome')

export type ExtensionFixtures = {
  context: BrowserContext
  extensionId: string
  popupUrl: string
}

/**
 * Launches a persistent Chromium context with Mustard loaded from dist/chrome.
 * The extension must be built before running E2E tests (`nr build:e2e`).
 */
export const test = base.extend<ExtensionFixtures>({
  context: async ({}, use, testInfo) => {
    const context = await chromium.launchPersistentContext(testInfo.outputPath('user-data-dir'), {
      headless: false,
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
