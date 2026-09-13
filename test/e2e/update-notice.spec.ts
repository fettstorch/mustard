import { expect, test } from './extension.fixture'
import type { ExtensionUpdateState } from '../../src/shared/extension-update'

// Exercise Safari's provider state through the real content-script message path
// in Chromium. This is presentation coverage, not Safari runtime automation.
test('unavailable updates show a notice only when the backend minimum requires one', async ({
  context,
  popupUrl,
}) => {
  const popup = await context.newPage()
  await popup.goto(popupUrl)
  await popup.evaluate(async () => {
    const { chrome } = globalThis as unknown as {
      chrome: typeof import('wxt/browser').browser
    }
    await chrome.runtime.sendMessage({ type: 'CHECK_EXTENSION_UPDATE' })
  })

  const page = await context.newPage()
  await page.goto('http://127.0.0.1:4173/page.html')
  await expect(page.locator('#mustard-host')).toBeAttached()
  const worker = context.serviceWorkers()[0]!
  const toast = page.locator('#mustard-extension-update-banner')

  const state: ExtensionUpdateState = {
    status: 'unavailable',
    currentVersion: '1.0.0',
  }

  async function announce(update: ExtensionUpdateState) {
    await worker.evaluate(async (state) => {
      const { chrome } = globalThis as unknown as {
        chrome: typeof import('wxt/browser').browser
      }
      const [tab] = await chrome.tabs.query({ url: 'http://127.0.0.1:4173/page.html' })
      if (tab?.id === undefined) throw new Error('Fixture tab not found')
      await chrome.tabs.sendMessage(tab.id, { type: 'EXTENSION_UPDATE_STATE_CHANGED', state })
    }, update)
  }

  await announce(state)
  await expect(toast).toHaveCount(0)

  await announce({ ...state, required: true, minimumVersion: '2.0.0' })
  await expect(toast).toBeVisible()
  await expect(toast).toHaveText('You must update Mustard to keep using it.')
  await expect(toast.locator('a, button')).toHaveCount(0)

  await announce(state)
  await expect(toast).toHaveCount(0)
})
