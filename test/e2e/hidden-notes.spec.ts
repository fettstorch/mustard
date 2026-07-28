import { expect, test } from './extension.fixture'
import type { BrowserContext, Page } from '@playwright/test'
import { readFile } from 'node:fs/promises'
import path from 'node:path'

const fixtureUrl = 'http://127.0.0.1:4173/page.html'

/** Open the note editor via the same path the real context-menu action uses. */
async function openNoteEditor(context: BrowserContext, page: Page): Promise<void> {
  await page.locator('#content').dispatchEvent('contextmenu', {
    button: 2,
    clientX: 100,
    clientY: 100,
  })

  let serviceWorker = context.serviceWorkers()[0]
  if (!serviceWorker) serviceWorker = await context.waitForEvent('serviceworker')
  await serviceWorker.evaluate(async (url: string) => {
    const [tab] = await chrome.tabs.query({ url: `${url}*` })
    if (tab?.id === undefined) throw new Error(`No tab found for ${url}`)
    await chrome.tabs.sendMessage(tab.id, { type: 'OPEN_NOTE_EDITOR' })
  }, fixtureUrl)

  await expect(
    page.locator('#mustard-host').locator('[title="Save this note locally"]'),
  ).toBeVisible({ timeout: 8_000 })
}

/**
 * Create a local note on the fixture page, the same way local-note.spec.ts does.
 */
async function createLocalNote(context: BrowserContext, page: Page, text: string): Promise<void> {
  await openNoteEditor(context, page)

  const mustard = page.locator('#mustard-host')
  const saveButton = mustard.locator('[title="Save this note locally"]')
  await mustard.locator('.tiptap[contenteditable="true"]').click()
  await page.keyboard.type(text)
  await saveButton.click()
  await expect(saveButton).not.toBeVisible({ timeout: 5_000 })
}

/** Hide the single note currently rendered on the page. */
async function hideOnlyNote(page: Page): Promise<void> {
  const mustard = page.locator('#mustard-host')
  const note = mustard.locator('.mustard-note').first()
  await note.hover()
  await note.locator('[title^="Hide this note"]').click()
  await expect(mustard.locator('.mustard-note')).toHaveCount(0, { timeout: 5_000 })
}

test.describe('Hiding individual notes', () => {
  test('hiding a note removes it from the page and it stays gone after a reload', async ({
    context,
  }) => {
    const page = await context.newPage()
    await page.goto(fixtureUrl)
    const mustard = page.locator('#mustard-host')
    await expect(mustard).toBeAttached({ timeout: 8_000 })

    await createLocalNote(context, page, 'Note to hide')
    const note = mustard.locator('.mustard-note').filter({ hasText: 'Note to hide' })
    await expect(note).toBeVisible()

    // The control is hover-gated: collapsed to zero width and transparent on a
    // resting note. Saving left the cursor parked over the note, so step off it
    // first. Asserted on the wrapper, since the button inside keeps a (clipped)
    // box from its own padding.
    const hideToggle = note.locator('.mustard-hide-toggle')
    await page.mouse.move(5, 5)
    await expect(hideToggle).toHaveCSS('opacity', '0')
    await expect(hideToggle).toHaveCSS('width', '0px')

    await note.hover()
    await expect(hideToggle).toHaveCSS('opacity', '1')
    await note.locator('[title^="Hide this note"]').click()

    await expect(note).toHaveCount(0, { timeout: 5_000 })
    // The toast points users at the un-hide gallery, since hiding has no inline undo.
    await expect(page.getByText('Note hidden — un-hide it in Mustard options')).toBeVisible()

    await page.reload()
    await expect(mustard).toBeAttached({ timeout: 8_000 })
    // Give the notes query time to land, so this can't pass just by being early.
    await page.waitForTimeout(1_500)
    await expect(mustard.getByText('Note to hide')).toHaveCount(0)
  })

  test('the options page lists a hidden note and un-hiding it brings the note back', async ({
    context,
    extensionId,
  }) => {
    const page = await context.newPage()
    await page.goto(fixtureUrl)
    const mustard = page.locator('#mustard-host')
    await expect(mustard).toBeAttached({ timeout: 8_000 })

    await createLocalNote(context, page, 'Hidden then restored')
    const note = mustard.locator('.mustard-note').filter({ hasText: 'Hidden then restored' })
    await note.hover()
    await note.locator('[title^="Hide this note"]').click()
    await expect(note).toHaveCount(0, { timeout: 5_000 })

    const options = await context.newPage()
    await options.goto(`chrome-extension://${extensionId}/options.html`)

    // Collapsed header carries the count straight from local storage — no network.
    const header = options.getByRole('button', { name: /Hidden notes \(1\)/ })
    await expect(header).toBeVisible({ timeout: 8_000 })
    await header.click()

    const card = options.locator('.hidden-note-card')
    await expect(card).toHaveCount(1, { timeout: 8_000 })
    await expect(card.getByText('Hidden then restored')).toBeVisible()
    // The tile renders the real MustardNote, not a lookalike, and adds the page.
    await expect(card.locator('.mustard-note')).toHaveCount(1)
    await expect(card.locator('.hidden-note-page')).toContainText('127.0.0.1:4173/page.html')
    // Deleting your own note stays available wherever you can see it...
    await expect(card.locator('[title="Delete this note"]')).toBeVisible()
    // ...but affordances that only mean something on the note's own page don't.
    await expect(card.locator('[title^="Publish this note"]')).toHaveCount(0)

    await card.locator('.mustard-note').hover()
    await card.locator('[title="Un-hide this note"]').click()
    await expect(options.locator('.hidden-note-card')).toHaveCount(0)

    // storage.onChanged fans the un-hide back to the open tab, which still holds
    // the note in memory — so it renders again without a reload.
    await expect(mustard.getByText('Hidden then restored')).toBeVisible({ timeout: 8_000 })
  })

  test('hiding a note keeps it hidden after another note is saved on the same page', async ({
    context,
  }) => {
    const page = await context.newPage()
    await page.goto(fixtureUrl)
    const mustard = page.locator('#mustard-host')
    await expect(mustard).toBeAttached({ timeout: 8_000 })

    await createLocalNote(context, page, 'First note hidden')
    const first = mustard.locator('.mustard-note').filter({ hasText: 'First note hidden' })
    await first.hover()
    await first.locator('[title^="Hide this note"]').click()
    await expect(first).toHaveCount(0, { timeout: 5_000 })

    // Saving a local note re-reads every local note for the page, so a hidden one
    // could easily reappear here.
    await createLocalNote(context, page, 'Second note visible')

    await expect(mustard.getByText('Second note visible')).toBeVisible()
    await expect(mustard.getByText('First note hidden')).toHaveCount(0)
  })

  test('an open gallery live-updates when a note is hidden from a page tab', async ({
    context,
    extensionId,
  }) => {
    const page = await context.newPage()
    await page.goto(fixtureUrl)
    const mustard = page.locator('#mustard-host')
    await expect(mustard).toBeAttached({ timeout: 8_000 })

    await createLocalNote(context, page, 'First hidden note')
    await hideOnlyNote(page)

    const options = await context.newPage()
    await options.goto(`chrome-extension://${extensionId}/options.html`)
    await options.getByRole('button', { name: /Hidden notes \(1\)/ }).click()
    // Section is now open AND loaded — the state that arms syncFromStorage's reload.
    await expect(options.locator('.hidden-note-card')).toHaveCount(1, { timeout: 8_000 })

    // Hide a second note from the page while the gallery stays open. The gallery
    // never reloads here; storage.onChanged has to pull the new note in on its own.
    await page.bringToFront()
    await createLocalNote(context, page, 'Second hidden note')
    await hideOnlyNote(page)

    const cards = options.locator('.hidden-note-card')
    await expect(cards).toHaveCount(2, { timeout: 8_000 })
    // Proof the reload actually fetched it, not just bumped a count.
    await expect(
      options.locator('.hidden-note-card', { hasText: 'Second hidden note' }),
    ).toHaveCount(1)
    await expect(options.getByRole('button', { name: /Hidden notes \(2\)/ })).toBeVisible()
  })

  test('deleting a note from the gallery removes the tile and drops its hidden entry', async ({
    context,
    extensionId,
  }) => {
    const page = await context.newPage()
    await page.goto(fixtureUrl)
    await expect(page.locator('#mustard-host')).toBeAttached({ timeout: 8_000 })

    await createLocalNote(context, page, 'Note to delete from gallery')
    await hideOnlyNote(page)

    const options = await context.newPage()
    await options.goto(`chrome-extension://${extensionId}/options.html`)
    await options.getByRole('button', { name: /Hidden notes \(1\)/ }).click()
    const card = options.locator('.hidden-note-card')
    await expect(card).toHaveCount(1, { timeout: 8_000 })

    await card.locator('[title="Delete this note"]').click()
    await expect(options.locator('.hidden-note-card')).toHaveCount(0, { timeout: 8_000 })

    // The ref has to go with the note, otherwise the entry would come back as a
    // "Note no longer available" row on the next visit.
    await expect(options.locator('.hidden-note-missing')).toHaveCount(0)
    await options.reload()
    await expect(options.getByRole('button', { name: /Hidden notes/ })).toBeVisible({
      timeout: 8_000,
    })
    await expect(options.getByRole('button', { name: /Hidden notes \(/ })).toHaveCount(0)
  })

  test('gallery notes get the shared note stylesheet, so code blocks and link previews render', async ({
    context,
    extensionId,
  }) => {
    // Regression guard for a real trap: the code-block and highlight.js rules in
    // mustard-notes.css are root-scoped, and an extension page only picks them up
    // via `.mustard-surface`. Without it the gallery renders the markup with none
    // of the styling — unstyled `pre`, no syntax colours.
    const png = await readFile(path.resolve('src/assets/icons/mustard_bottle_smile_48.png'))
    await context.route('https://preview.example/**', async (route) => {
      if (route.request().url().endsWith('/og.png')) {
        await route.fulfill({ contentType: 'image/png', body: png })
        return
      }
      await route.fulfill({
        contentType: 'text/html',
        body: [
          '<meta property="og:title" content="A preview title">',
          '<meta property="og:site_name" content="A preview site">',
          '<meta property="og:image" content="https://preview.example/og.png">',
        ].join(''),
      })
    })

    const page = await context.newPage()
    await page.goto(fixtureUrl)
    const mustard = page.locator('#mustard-host')
    await expect(mustard).toBeAttached({ timeout: 8_000 })

    await openNoteEditor(context, page)
    const editor = mustard.locator('.tiptap[contenteditable="true"]')
    await editor.click()
    await page.keyboard.type('```ts')
    await page.keyboard.press('Space')
    await expect(editor.locator('pre')).toBeVisible()
    await page.keyboard.type('const answer = 42')
    await page.keyboard.press('ArrowDown')
    await page.keyboard.type('https://preview.example/article')
    await expect(mustard.locator('.mustard-note-editor .mustard-link-preview')).toBeVisible({
      timeout: 8_000,
    })
    await mustard.locator('[title="Save this note locally"]').click()
    await hideOnlyNote(page)

    const options = await context.newPage()
    await options.goto(`chrome-extension://${extensionId}/options.html`)
    await options.getByRole('button', { name: /Hidden notes \(1\)/ }).click()
    const note = options.locator('.hidden-note-card .mustard-note')
    await expect(note).toHaveCount(1, { timeout: 8_000 })

    // Syntax highlighting: tokens present AND actually themed. A transparent
    // background is exactly what the unscoped bug looked like.
    await expect(note.locator('pre span[class^="hljs-"]').first()).toBeAttached()
    const preBackground = await note
      .locator('pre')
      .evaluate((pre) => getComputedStyle(pre).backgroundColor)
    expect(preBackground).not.toBe('rgba(0, 0, 0, 0)')
    expect(preBackground).not.toBe('transparent')

    // Link preview renders with its thumbnail, same as on the page.
    await expect(note.locator('.mustard-link-preview')).toHaveCount(1)
    await expect(note.locator('.mustard-link-preview img')).toBeVisible()
  })
})
