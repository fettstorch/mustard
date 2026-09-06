import { expect, test } from './authenticated.fixture'
import { TEST_USERS } from './auth-test-data'
import { deleteNote, seedComment, seedNote } from './local-supabase'

const { viewer, author } = TEST_USERS
const fixtureUrl = 'http://127.0.0.1:4173/page.html'
const noteContent = 'Remote note whose delete will fail'
const commentContent = `Keep${'unbroken'.repeat(20)}`

test('keeps a short-note comment composer usable without content-driven widening', async ({
  authenticatedContext: context,
}) => {
  const shortNoteContent = 'Hi'
  const wideNoteContent = 'This note is deliberately wider than the comment usability floor.'
  const shortNoteId = await seedNote(viewer.userId, fixtureUrl, shortNoteContent)
  const wideNoteId = await seedNote(viewer.userId, fixtureUrl, wideNoteContent)
  await seedComment(shortNoteId, author.userId, commentContent)
  await seedComment(wideNoteId, author.userId, commentContent)

  try {
    const page = await context.newPage()
    await page.goto(fixtureUrl)

    const note = page.locator('#mustard-host .mustard-note-wrapper').filter({
      has: page.getByText(shortNoteContent, { exact: true }),
    })
    await expect(note).toBeVisible({ timeout: 8_000 })
    const closedWidth = await note.evaluate((element) => element.getBoundingClientRect().width)

    await note.getByTitle('1 comment').evaluate((element: HTMLButtonElement) => element.click())
    await expect(note.getByText(commentContent)).toBeVisible()
    const openWidth = await note.evaluate((element) => element.getBoundingClientRect().width)
    const editorWidth = await note
      .locator('.mustard-comment-editor')
      .evaluate((element) => element.getBoundingClientRect().width)
    const contentOverflow = await note.locator('.mustard-comment-content').evaluate((element) => ({
      clientWidth: element.clientWidth,
      scrollWidth: element.scrollWidth,
    }))

    expect(openWidth).toBeGreaterThan(closedWidth)
    expect(openWidth).toBe(400)
    expect(editorWidth).toBeGreaterThan(0)
    expect(contentOverflow.scrollWidth).toBeLessThanOrEqual(contentOverflow.clientWidth)

    const wideNote = page.locator('#mustard-host .mustard-note-wrapper').filter({
      has: page.getByText(wideNoteContent, { exact: true }),
    })
    await expect(wideNote).toBeVisible()
    const wideClosedWidth = await wideNote.evaluate(
      (element) => element.getBoundingClientRect().width,
    )
    expect(wideClosedWidth).toBeGreaterThan(400)

    await wideNote.getByTitle('1 comment').evaluate((element: HTMLButtonElement) => element.click())
    await expect(wideNote.getByText(commentContent)).toBeVisible()
    await expect
      .poll(() => wideNote.evaluate((element) => element.getBoundingClientRect().width))
      .toBe(wideClosedWidth)
  } finally {
    await Promise.all([deleteNote(shortNoteId), deleteNote(wideNoteId)])
  }
})

test.describe('failed remote-note deletion', () => {
  let noteId: string

  test.beforeEach(async () => {
    noteId = await seedNote(viewer.userId, fixtureUrl, noteContent)
    await seedComment(noteId, author.userId, commentContent)
  })

  test.afterEach(async () => {
    await deleteNote(noteId)
  })

  test('keeps the note and its thread usable after the server rejects deletion', async ({
    authenticatedContext: context,
  }) => {
    const page = await context.newPage()
    await page.goto(fixtureUrl)

    const mustard = page.locator('#mustard-host')
    const note = mustard.locator('.mustard-note-wrapper').filter({ hasText: noteContent })
    await expect(note).toBeVisible({ timeout: 8_000 })
    const closedWidth = await note.evaluate((element) => element.getBoundingClientRect().width)

    await note.getByTitle('1 comment').click()
    await expect(note.getByText(commentContent)).toBeVisible()
    await expect
      .poll(() => note.evaluate((element) => element.getBoundingClientRect().width))
      .toBe(closedWidth)

    let serviceWorker = context.serviceWorkers()[0]
    if (!serviceWorker) {
      serviceWorker = await context.waitForEvent('serviceworker')
    }
    // Keep the session, but replace the access JWT after initial data load.
    // The delete call is then rejected by RLS, reproducing a remote failure.
    await serviceWorker.evaluate(async () => {
      const { supabase_jwt: cachedJwt } = await chrome.storage.local.get('supabase_jwt')
      if (!cachedJwt?.refreshToken) {
        throw new Error(
          'Expected the authenticated fixture to have migrated to a refresh-token session',
        )
      }

      await chrome.storage.local.set({
        supabase_jwt: {
          ...cachedJwt,
          jwt: 'not-a-valid-jwt',
          userId: '11111111-1111-4111-8111-111111111111',
          expiresAt: Math.floor(Date.now() / 1000) + 60 * 60,
        },
      })
    })

    const deleteButton = note.getByTitle('Delete this note')
    await note.hover()
    await deleteButton.click()

    // The failed request must undo only this note's pending lock; the note and
    // its already-loaded comments must not be cleared optimistically.
    await expect(deleteButton).toBeEnabled({ timeout: 8_000 })
    await expect(note).toBeVisible()
    await expect(note.getByText(commentContent)).toBeVisible()
  })
})
