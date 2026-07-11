import { expect, test } from './authenticated.fixture'

const fixtureUrl = 'http://127.0.0.1:4173/page.html'
const noteContent = 'Authenticated E2E remote note'

test('popup recognizes the seeded GitHub session', async ({ context, popupUrl }) => {
  const popup = await context.newPage()
  await popup.goto(popupUrl)

  await expect(popup.getByRole('button', { name: 'Logout' })).toBeVisible()
  await expect(popup.getByText('@mustard-e2e')).toBeVisible()
  await expect(popup.getByRole('tab', { name: 'GitHub' })).not.toBeVisible()
})

test('publishes a remote note and restores it after reload', async ({ context, popupUrl }) => {
  const popup = await context.newPage()
  await popup.goto(popupUrl)
  await expect(popup.getByRole('button', { name: 'Logout' })).toBeVisible()
  await popup.close()

  const page = await context.newPage()
  await page.goto(fixtureUrl)
  const mustard = page.locator('#mustard-host')
  await expect(mustard).toBeAttached({ timeout: 8_000 })

  await page.locator('#auth-content').click({ button: 'right' })
  await page.keyboard.press('Escape')

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

  const editor = mustard.locator('.tiptap[contenteditable="true"]')
  await expect(editor).toBeVisible({ timeout: 8_000 })
  await editor.click()
  await page.keyboard.type(noteContent)
  await mustard.locator('[title^="Publish this note"]').click()

  const confirm = mustard.getByRole('button', { name: 'Publish', exact: true })
  await expect(confirm).toBeVisible()
  await confirm.click()

  await expect(editor).not.toBeVisible({ timeout: 8_000 })
  await expect(mustard.getByText(noteContent)).toBeVisible()

  await page.reload()
  await expect(page.locator('#mustard-host').getByText(noteContent)).toBeVisible({ timeout: 8_000 })
})
