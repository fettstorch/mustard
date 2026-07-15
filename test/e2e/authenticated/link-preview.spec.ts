import type { BrowserContext, Locator, Page } from '@playwright/test'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { expect, test } from './authenticated.fixture'
import { AUTH_E2E_USER } from './auth-test-data'
import { adminClient, getLocalSupabaseStatus } from './local-supabase'

const FIXTURE_URL = 'http://127.0.0.1:4173/page.html'
const PREVIEW_URL = 'https://preview.example/authenticated-article'
const BUCKET = 'link-preview-thumbnails'

async function openEditor(context: BrowserContext, page: Page): Promise<Locator> {
  // Use a real right click so the captured client coordinates position the
  // editor low enough for its above-editor publish confirmation to stay visible.
  await page.locator('#auth-content').click({ button: 'right' })
  await page.keyboard.press('Escape')

  let serviceWorker = context.serviceWorkers()[0]
  if (!serviceWorker) serviceWorker = await context.waitForEvent('serviceworker')
  await serviceWorker.evaluate(async (url: string) => {
    const [tab] = await chrome.tabs.query({ url: `${url}*` })
    if (tab?.id === undefined) throw new Error(`No tab found for ${url}`)
    await chrome.tabs.sendMessage(tab.id, { type: 'OPEN_NOTE_EDITOR' })
  }, FIXTURE_URL)

  const editor = page.locator('#mustard-host .tiptap[contenteditable="true"]')
  await expect(editor).toBeVisible({ timeout: 8_000 })
  return editor
}

async function publishEditorNote(
  context: BrowserContext,
  page: Page,
  content: string,
  dismissPreview = false,
): Promise<void> {
  const mustard = page.locator('#mustard-host')
  const editor = await openEditor(context, page)
  await editor.fill(content)

  const preview = mustard.locator('.mustard-note-editor .mustard-link-preview')
  await expect(preview.getByText('Authenticated preview')).toBeVisible({ timeout: 8_000 })
  await expect(preview.locator('img')).toBeVisible()

  if (dismissPreview) {
    await mustard.getByTitle('Remove link preview').click()
    await expect(preview).toHaveCount(0)
    await page.waitForTimeout(800)
    await expect(preview).toHaveCount(0)
  }

  await mustard.locator('[title^="Publish this note"]').click()
  const confirm = mustard.getByRole('button', { name: 'Publish', exact: true })
  await expect(confirm).toBeVisible()
  await confirm.click()
  await expect(editor).not.toBeVisible({ timeout: 8_000 })
}

async function publishThroughRuntime(
  popup: Page,
  content: string,
  dismissPreview = false,
): Promise<void> {
  const response = await popup.evaluate(
    async ({ content, previewUrl, fixtureUrl, dismissPreview }) => {
      const preview = dismissPreview
        ? undefined
        : await chrome.runtime.sendMessage({ type: 'GET_LINK_PREVIEW', url: previewUrl })
      return chrome.runtime.sendMessage({
        type: 'UPSERT_NOTE',
        target: 'remote',
        data: {
          content,
          linkPreview: preview,
          linkPreviewDismissed: dismissPreview,
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
    { content, previewUrl: PREVIEW_URL, fixtureUrl: FIXTURE_URL, dismissPreview },
  )
  expect(response.ok).toBe(true)
  expect(response.data).toHaveLength(1)
}

test('publishes, stores, deduplicates, renders, and dismisses link previews', async ({
  context,
  popupUrl,
}) => {
  test.setTimeout(60_000)
  const png = await readFile(path.resolve('src/assets/icons/mustard_bottle_smile_48.png'))
  await context.route('https://preview.example/**', async (route) => {
    if (route.request().url().endsWith('/og.png')) {
      await route.fulfill({ contentType: 'image/png', body: png })
      return
    }
    await route.fulfill({
      contentType: 'text/html',
      body: [
        '<meta property="og:title" content="Authenticated preview">',
        '<meta property="og:description" content="Stored in local Supabase">',
        '<meta property="og:image" content="https://preview.example/og.png">',
      ].join(''),
    })
  })

  const page = await context.newPage()
  await page.goto(FIXTURE_URL)
  const mustard = page.locator('#mustard-host')
  await expect(mustard).toBeAttached({ timeout: 8_000 })

  const contents = {
    first: `First remote preview ${PREVIEW_URL}`,
    second: `Second remote preview ${PREVIEW_URL}`,
    dismissed: `Dismissed remote preview ${PREVIEW_URL}`,
  }
  const allContents = Object.values(contents)
  const status = getLocalSupabaseStatus()
  const admin = adminClient(status)
  const bucket = admin.storage.from(BUCKET)

  try {
    await publishEditorNote(context, page, contents.first)
    const popup = await context.newPage()
    await popup.goto(popupUrl)
    await publishThroughRuntime(popup, contents.second)
    await publishThroughRuntime(popup, contents.dismissed, true)
    await popup.close()

    const { data, error } = await admin
      .from('notes')
      .select('content, link_preview')
      .eq('author_id', AUTH_E2E_USER.userId)
      .in('content', allContents)
    expect(error).toBeNull()
    expect(data).toHaveLength(3)

    const rows = new Map(
      (data as Array<{ content: string; link_preview: Record<string, unknown> | null }>).map(
        (row) => [row.content, row.link_preview],
      ),
    )
    const firstPreview = rows.get(contents.first)
    const secondPreview = rows.get(contents.second)
    expect(firstPreview).toMatchObject({
      url: PREVIEW_URL,
      title: 'Authenticated preview',
      description: 'Stored in local Supabase',
    })
    expect(secondPreview).toMatchObject(firstPreview!)
    expect(rows.get(contents.dismissed)).toBeNull()
    expect(firstPreview).not.toHaveProperty('imageUrl')
    expect(firstPreview).not.toHaveProperty('imageDataUrl')

    const thumbnailPath = firstPreview?.thumbnailPath
    expect(thumbnailPath).toMatch(new RegExp(`^${AUTH_E2E_USER.userId}/[0-9a-f]{64}\\.webp$`))
    expect(secondPreview?.thumbnailPath).toBe(thumbnailPath)

    const filename = String(thumbnailPath).split('/')[1]
    const { data: objects, error: listError } = await bucket.list(AUTH_E2E_USER.userId, {
      limit: 100,
      search: filename,
    })
    expect(listError).toBeNull()
    expect(objects?.filter((object) => object.name === filename)).toHaveLength(1)

    const { data: thumbnail, error: downloadError } = await bucket.download(String(thumbnailPath))
    expect(downloadError).toBeNull()
    expect(thumbnail?.type).toBe('image/webp')
    expect(thumbnail?.size).toBeGreaterThan(0)
    expect(thumbnail?.size).toBeLessThanOrEqual(20 * 1024)

    await page.reload()
    const savedCards = page.locator('#mustard-host .mustard-note .mustard-link-preview')
    await expect(savedCards).toHaveCount(2, { timeout: 8_000 })
    await expect(savedCards.locator('img')).toHaveCount(2)
  } finally {
    const { data: cleanupRows } = await admin
      .from('notes')
      .select('link_preview')
      .eq('author_id', AUTH_E2E_USER.userId)
      .in('content', allContents)
    const paths = [
      ...new Set(
        (
          cleanupRows as
            | Array<{ link_preview: { thumbnailPath?: string } | null }>
            | null
            | undefined
        )
          ?.map((row) => row.link_preview?.thumbnailPath)
          .filter((value): value is string => !!value) ?? [],
      ),
    ]
    await admin
      .from('notes')
      .delete()
      .eq('author_id', AUTH_E2E_USER.userId)
      .in('content', allContents)
    if (paths.length > 0) await bucket.remove(paths)
    await page.close()
  }
})
