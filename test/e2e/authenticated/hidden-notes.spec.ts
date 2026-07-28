import type { Page } from '@playwright/test'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { expect, test } from './authenticated.fixture'

const FIXTURE_URL = 'http://127.0.0.1:4173/page.html'
const PREVIEW_URL = 'https://preview.example/hidden-note-article'
const CONTENT = `Hidden published note ${PREVIEW_URL}`

/** Decoded pixel width — 0 for an <img> whose bytes never arrived. */
const imageWidth = (img: HTMLImageElement) => img.naturalWidth

/**
 * Publish a remote note straight through the background, skipping the editor —
 * this suite is about what a *published* note looks like once hidden, not about
 * authoring. Mirrors link-preview.spec.ts's runtime publish helper.
 */
async function publishNote(popup: Page, content: string): Promise<void> {
  const response = await popup.evaluate(
    async ({ content, previewUrl, fixtureUrl }) => {
      const preview = await chrome.runtime.sendMessage({
        type: 'GET_LINK_PREVIEW',
        url: previewUrl,
      })
      return chrome.runtime.sendMessage({
        type: 'UPSERT_NOTE',
        target: 'remote',
        data: {
          content,
          linkPreview: preview,
          anchorData: {
            pageUrl: fixtureUrl,
            elementSelector: '#auth-content',
            relativePosition: { xP: 50, yP: 50 },
            clickPosition: { xVw: 50, yPx: 420 },
          },
          updatedAt: Date.now(),
        },
      }) as Promise<{ ok: boolean; data?: unknown[] }>
    },
    { content, previewUrl: PREVIEW_URL, fixtureUrl: FIXTURE_URL },
  )
  expect(response.ok).toBe(true)
  expect(response.data).toHaveLength(1)
}

/**
 * A PUBLISHED note hidden and then reviewed in the options gallery.
 *
 * This is deliberately separate from the unauthenticated hidden-notes spec,
 * which can only use local drafts. The two take materially different paths:
 * a local draft carries its link-preview image inline as `imageDataUrl`, while a
 * published note carries only a `thumbnailPath` and has to fetch the bytes
 * through GET_LINK_PREVIEW_IMAGE. Comment toggles are remote-only too. So the
 * local-draft tests prove nothing about what a real hidden note looks like.
 */
test('a published hidden note keeps its preview, comments and un-hide control in the options gallery', async ({
  authenticatedContext: context,
  popupUrl,
  extensionId,
}) => {
  test.setTimeout(90_000)

  const png = await readFile(path.resolve('src/assets/icons/mustard_bottle_smile_48.png'))
  await context.route('https://preview.example/**', async (route) => {
    if (route.request().url().endsWith('/og.png')) {
      await route.fulfill({ contentType: 'image/png', body: png })
      return
    }
    await route.fulfill({
      contentType: 'text/html',
      body: [
        '<meta property="og:title" content="Hidden note preview">',
        '<meta property="og:description" content="Published, not a local draft">',
        '<meta property="og:image" content="https://preview.example/og.png">',
      ].join(''),
    })
  })

  const page = await context.newPage()
  await page.goto(FIXTURE_URL)
  const mustard = page.locator('#mustard-host')
  await expect(mustard).toBeAttached({ timeout: 8_000 })

  const popup = await context.newPage()
  await popup.goto(popupUrl)
  await publishNote(popup, CONTENT)
  await popup.close()

  await page.reload()
  await expect(mustard).toBeAttached({ timeout: 8_000 })
  const note = mustard.locator('.mustard-note').filter({ hasText: 'Hidden published note' })
  await expect(note).toBeVisible({ timeout: 20_000 })

  // Baseline: on its own page the published note shows a preview thumbnail and a
  // comment toggle. Whatever the gallery does differently has to match this.
  // naturalWidth, not toBeVisible: a broken <img> can still report visible, and
  // the whole question here is whether the thumbnail bytes actually arrived.
  await expect(note.locator('.mustard-link-preview')).toHaveCount(1)
  await expect
    .poll(() => note.locator('.mustard-link-preview img').evaluate(imageWidth), {
      timeout: 10_000,
    })
    .toBeGreaterThan(0)
  await expect(note.locator('.comment-toggle')).toBeVisible()

  await note.hover()
  await note.locator('[title^="Hide this note"]').click()
  await expect(note).toHaveCount(0, { timeout: 8_000 })

  const options = await context.newPage()
  await options.goto(`chrome-extension://${extensionId}/options.html`)
  const header = options.getByRole('button', { name: /Hidden notes \(1\)/ })
  await expect(header).toBeVisible({ timeout: 10_000 })
  await header.click()

  const card = options.locator('.hidden-note-card')
  await expect(card).toHaveCount(1, { timeout: 20_000 })
  await expect(card.getByText('Hidden published note')).toBeVisible()

  // 1. Un-hiding is the point of this section, so the control must not need
  //    discovering by hover here (unlike on a page). Asserted on the wrapper and
  //    its computed style: the button inside keeps a clipped 8px box from its own
  //    padding, so `toBeVisible()` on it passes even while it's collapsed.
  const unhideToggle = card.locator('.mustard-hide-toggle')
  await expect(unhideToggle).toHaveCSS('opacity', '1')
  expect(await unhideToggle.evaluate((el) => el.getBoundingClientRect().width)).toBeGreaterThan(0)
  await expect(card.locator('[title="Un-hide this note"]')).toBeVisible()

  // 2. Same link preview, thumbnail included — fetched via GET_LINK_PREVIEW_IMAGE
  //    since a published preview carries no inline data URL.
  await expect(card.locator('.mustard-link-preview')).toHaveCount(1)
  await expect
    .poll(() => card.locator('.mustard-link-preview img').evaluate(imageWidth), {
      timeout: 10_000,
    })
    .toBeGreaterThan(0)

  // 3. Comments are visible and expandable on a published note.
  await expect(card.locator('.comment-toggle')).toBeVisible()

  // 4. Un-hide returns the note to the page that still has it in memory.
  await card.locator('[title="Un-hide this note"]').click()
  await expect(options.locator('.hidden-note-card')).toHaveCount(0)
  await expect(mustard.getByText('Hidden published note')).toBeVisible({ timeout: 20_000 })
})
