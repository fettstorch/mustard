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

  test('creates a contained code block after a hard break without losing following text', async ({
    context,
  }) => {
    const page = await context.newPage()
    await page.setViewportSize({ width: 600, height: 600 })
    await page.goto(fixtureUrl)
    const mustard = page.locator('#mustard-host')
    await expect(mustard).toBeAttached({ timeout: 8_000 })

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

    const saveButton = mustard.locator('[title="Save this note locally"]')
    const editor = mustard.locator('.tiptap[contenteditable="true"]')
    await expect(saveButton).toBeVisible({ timeout: 8_000 })
    await editor.click()
    const trailingText = 'trailing text'
    await page.keyboard.type(`Short note ${trailingText}`)
    const caretOffset = 'Short note '.length
    await editor.evaluate((element, offset) => {
      const textNode = element.querySelector('p')?.firstChild
      if (!(textNode instanceof Text)) throw new Error('Editor paragraph has no text node')

      const range = document.createRange()
      range.setStart(textNode, offset)
      range.collapse(true)

      const selection = getSelection()
      if (!selection) throw new Error('Document has no selection')
      selection.removeAllRanges()
      selection.addRange(range)
      document.dispatchEvent(new Event('selectionchange'))
    }, caretOffset)
    expect(await editor.evaluate(() => getSelection()?.anchorOffset)).toBe(caretOffset)
    await page.keyboard.press('Shift+Enter')
    await page.keyboard.type('```ts')
    await page.keyboard.press('Space')
    await expect(editor.locator('pre')).toBeVisible()
    await expect(editor.getByText(trailingText, { exact: true })).toBeVisible()
    await page.keyboard.type(
      'const extremelyLongIdentifierThatMustOnlyScrollInsideTheCodeBlock = 1234567890',
    )
    await saveButton.click()

    const savedNote = mustard.locator('.mustard-note').filter({ hasText: 'Short note' })
    await expect(savedNote).toBeVisible()
    await expect(savedNote.getByText(trailingText, { exact: true })).toBeVisible()
    const codeBlock = savedNote.locator('.mustard-note-content pre')
    await expect(codeBlock).toBeVisible()
    const widths = await codeBlock.evaluate((pre) => {
      const content = pre.closest('.mustard-note-content')
      if (!content) throw new Error('Code block is missing its note-content container')
      const note = pre.closest('.mustard-note')
      if (!note) throw new Error('Code block is missing its note container')
      const preRect = pre.getBoundingClientRect()
      const contentRect = content.getBoundingClientRect()
      const noteRect = note.getBoundingClientRect()
      const noteStyle = getComputedStyle(note)
      return {
        preWidth: preRect.width,
        preRight: preRect.right,
        preScrollWidth: pre.scrollWidth,
        contentWidth: contentRect.width,
        contentRight: contentRect.right,
        noteContentRight: noteRect.right - parseFloat(noteStyle.paddingRight),
      }
    })

    expect(widths.preScrollWidth).toBeGreaterThan(widths.preWidth)
    expect(widths.preWidth).toBeLessThanOrEqual(widths.contentWidth)
    expect(widths.preRight).toBeLessThanOrEqual(widths.contentRight)
    expect(widths.preRight).toBeLessThanOrEqual(widths.noteContentRight)
  })
})
