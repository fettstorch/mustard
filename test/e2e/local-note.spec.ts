import { expect, test } from './extension.fixture'

const fixtureUrl = 'http://127.0.0.1:4173/page.html'

test.describe('Content script smoke', () => {
  test('injects #mustard-host into a local fixture page', async ({ context }) => {
    const page = await context.newPage()
    await page.goto(fixtureUrl)

    await expect(page.locator('#mustard-host')).toBeAttached({ timeout: 8_000 })
  })

  test('saves a local note and restores it after reload', async ({ context }) => {
    const page = await context.newPage()
    await page.goto(fixtureUrl)
    await expect(page.locator('#mustard-host')).toBeAttached({ timeout: 8_000 })

    // This is the same event path as the real context-menu action. It gives
    // OPEN_NOTE_EDITOR an actual anchor instead of the null anchor from the
    // previous test, which the application correctly refuses to save.
    await page.locator('#content').dispatchEvent('contextmenu', {
      button: 2,
      clientX: 100,
      clientY: 100,
    })

    let serviceWorker = context.serviceWorkers()[0]
    if (!serviceWorker) {
      serviceWorker = await context.waitForEvent('serviceworker')
    }
    await serviceWorker.evaluate(async (url: string) => {
      const extension = globalThis as typeof globalThis & {
        chrome: {
          tabs: {
            query(queryInfo: { url: string }): Promise<Array<{ id?: number }>>
            sendMessage(tabId: number, message: { type: string }): Promise<void>
          }
        }
      }
      const [tab] = await extension.chrome.tabs.query({ url: `${url}*` })
      if (tab?.id === undefined) throw new Error(`No tab found for ${url}`)
      await extension.chrome.tabs.sendMessage(tab.id, { type: 'OPEN_NOTE_EDITOR' })
    }, fixtureUrl)

    const saveButton = page.locator('[title="Save this note locally"]')
    await expect(saveButton).toBeVisible({ timeout: 8_000 })

    const editor = page.locator('.tiptap[contenteditable="true"]')
    await editor.click()
    await page.keyboard.type('E2E smoke note')
    await saveButton.click()

    await expect(saveButton).not.toBeVisible({ timeout: 5_000 })

    await page.reload()
    await expect(page.locator('#mustard-host')).toBeAttached({ timeout: 8_000 })
    await expect(page.locator('#mustard-host').getByText('E2E smoke note')).toBeVisible({
      timeout: 8_000,
    })
  })
})
