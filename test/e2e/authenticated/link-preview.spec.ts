import type { BrowserContext, Locator, Page } from '@playwright/test'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { expect, test } from './authenticated.fixture'
import { AUTH_E2E_USER, createAuthE2eJwt, TEST_USERS, type TestUser } from './auth-test-data'
import { adminClient, authedClient, getLocalSupabaseStatus } from './local-supabase'

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

async function setExtensionUser(popup: Page, user: TestUser): Promise<void> {
  const token = createAuthE2eJwt(user.userId)
  await popup.evaluate(
    async ({ user, token }) => {
      await chrome.storage.local.set({
        mustard_session: { userId: user.userId, identities: [user.identity] },
        supabase_jwt: { jwt: token.jwt, userId: user.userId, expiresAt: token.expiresAt },
      })
      await chrome.storage.session.clear()
    },
    { user, token },
  )
}

async function cleanupThroughRemote(
  userId: string,
  thumbnailPath: string,
): Promise<{ deleted: boolean }> {
  const status = getLocalSupabaseStatus()
  const { jwt } = createAuthE2eJwt(userId)
  const response = await fetch(`${status.API_URL}/functions/v1/link-preview-thumbnail`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${jwt}` },
    body: JSON.stringify({ action: 'cleanup', path: thumbnailPath }),
  })
  expect(response.ok).toBe(true)
  return response.json() as Promise<{ deleted: boolean }>
}

test('rejects direct authenticated writes to the global thumbnail namespace', async () => {
  const status = getLocalSupabaseStatus()
  const forbiddenPath = `global/${'0'.repeat(64)}.webp`
  const { error } = await authedClient(AUTH_E2E_USER.userId, status)
    .storage.from(BUCKET)
    .upload(forbiddenPath, new Blob(['not trusted'], { type: 'image/webp' }), { upsert: false })
  expect(error).not.toBeNull()

  // Defensive cleanup in case local Storage semantics ever regress.
  await adminClient(status).storage.from(BUCKET).remove([forbiddenPath])
})

test('rejects thumbnail bytes that do not match the referenced global hash', async () => {
  const status = getLocalSupabaseStatus()
  const client = authedClient(AUTH_E2E_USER.userId, status)
  const forgedPath = `global/${'0'.repeat(64)}.webp`
  const content = `Forged preview ${PREVIEW_URL}`
  const { data: note, error: noteError } = await client
    .from('notes')
    .insert({
      author_id: AUTH_E2E_USER.userId,
      page_url: FIXTURE_URL,
      content,
      link_preview: { url: PREVIEW_URL, thumbnailPath: forgedPath },
      relative_position_x: 50,
      relative_position_y: 50,
      click_position_x: 50,
      click_position_y: 420,
    })
    .select('id')
    .single()
  expect(noteError).toBeNull()

  try {
    const { jwt } = createAuthE2eJwt(AUTH_E2E_USER.userId)
    const fakeWebp = btoa('RIFF\u0004\u0000\u0000\u0000WEBPtiny')
    const response = await fetch(`${status.API_URL}/functions/v1/link-preview-thumbnail`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${jwt}` },
      body: JSON.stringify({ action: 'ensure', path: forgedPath, imageBase64: fakeWebp }),
    })
    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toMatchObject({
      error: 'Thumbnail hash does not match its path',
    })
  } finally {
    if (note?.id) await client.from('notes').delete().eq('id', note.id)
    await adminClient(status).storage.from(BUCKET).remove([forgedPath])
  }
})

test('globally deduplicates, renders, and dismisses published link previews', async ({
  authenticatedContext: context,
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
    otherAuthor: `Other author remote preview ${PREVIEW_URL}`,
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
    await setExtensionUser(popup, TEST_USERS.author)
    await publishThroughRuntime(popup, contents.otherAuthor)
    await setExtensionUser(popup, AUTH_E2E_USER)
    await popup.close()

    const { data, error } = await admin
      .from('notes')
      .select('author_id, content, link_preview')
      .in('content', allContents)
    expect(error).toBeNull()
    expect(data).toHaveLength(4)

    const rows = new Map(
      (
        data as Array<{
          author_id: string
          content: string
          link_preview: Record<string, unknown> | null
        }>
      ).map((row) => [row.content, row]),
    )
    const firstPreview = rows.get(contents.first)?.link_preview
    const secondPreview = rows.get(contents.second)?.link_preview
    const otherAuthorPreview = rows.get(contents.otherAuthor)?.link_preview
    expect(firstPreview).toMatchObject({
      url: PREVIEW_URL,
      title: 'Authenticated preview',
      description: 'Stored in local Supabase',
    })
    expect(secondPreview).toMatchObject(firstPreview!)
    expect(otherAuthorPreview).toMatchObject(firstPreview!)
    expect(rows.get(contents.otherAuthor)?.author_id).toBe(TEST_USERS.author.userId)
    expect(rows.get(contents.dismissed)?.link_preview).toBeNull()
    expect(firstPreview).not.toHaveProperty('imageUrl')
    expect(firstPreview).not.toHaveProperty('imageDataUrl')

    const thumbnailPath = firstPreview?.thumbnailPath
    expect(thumbnailPath).toMatch(/^global\/[0-9a-f]{64}\.webp$/)
    expect(secondPreview?.thumbnailPath).toBe(thumbnailPath)
    expect(otherAuthorPreview?.thumbnailPath).toBe(thumbnailPath)

    const filename = String(thumbnailPath).split('/')[1]
    const { data: objects, error: listError } = await bucket.list('global', {
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
    for (const content of [contents.first, contents.second]) {
      const savedCard = page
        .locator('#mustard-host .mustard-note')
        .filter({ hasText: content })
        .locator('.mustard-link-preview')
      await expect(savedCard).toHaveCount(1, { timeout: 8_000 })
      await expect(savedCard.locator('img')).toHaveCount(1)
    }

    await admin
      .from('notes')
      .delete()
      .eq('author_id', AUTH_E2E_USER.userId)
      .in('content', [contents.first, contents.second, contents.dismissed])
    await expect(
      cleanupThroughRemote(AUTH_E2E_USER.userId, String(thumbnailPath)),
    ).resolves.toEqual({ deleted: false })
    const afterFirstAuthorCleanup = await bucket.list('global', { search: filename })
    expect(afterFirstAuthorCleanup.data?.some((object) => object.name === filename)).toBe(true)

    await admin
      .from('notes')
      .delete()
      .eq('author_id', TEST_USERS.author.userId)
      .eq('content', contents.otherAuthor)
    await expect(
      cleanupThroughRemote(TEST_USERS.author.userId, String(thumbnailPath)),
    ).resolves.toEqual({ deleted: true })
    const afterFinalCleanup = await bucket.list('global', { search: filename })
    expect(afterFinalCleanup.data?.some((object) => object.name === filename)).toBe(false)
  } finally {
    const { data: cleanupRows } = await admin
      .from('notes')
      .select('link_preview')
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
    await admin.from('notes').delete().in('content', allContents)
    if (paths.length > 0) await bucket.remove(paths)
    await page.close()
  }
})
