import { expect, test } from './authenticated.fixture'
import { TEST_USERS } from './auth-test-data'
import { deleteNote, seedComment, seedNote } from './local-supabase'

const { viewer, author } = TEST_USERS
const fixtureUrl = 'http://127.0.0.1:4173/page.html'
const noteContent = 'Remote note whose delete will fail'
const commentContent = 'Keep this comment visible after failure'

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
    context,
  }) => {
    const page = await context.newPage()
    await page.goto(fixtureUrl)

    const mustard = page.locator('#mustard-host')
    const note = mustard.locator('.mustard-note-wrapper').filter({ hasText: noteContent })
    await expect(note).toBeVisible({ timeout: 8_000 })

    await note.getByTitle('1 comment').click()
    await expect(note.getByText(commentContent)).toBeVisible()

    let serviceWorker = context.serviceWorkers()[0]
    if (!serviceWorker) {
      serviceWorker = await context.waitForEvent('serviceworker')
    }
    // Keep the session, but replace the access JWT after initial data load.
    // The delete call is then rejected by RLS, reproducing a remote failure.
    await serviceWorker.evaluate(async () => {
      await chrome.storage.local.set({
        supabase_jwt: {
          jwt: 'not-a-valid-jwt',
          userId: '11111111-1111-4111-8111-111111111111',
          expiresAt: Date.now() + 60 * 60 * 1000,
        },
      })
    })

    const deleteButton = note.getByTitle('Delete this note')
    await deleteButton.click()

    // The failed request must undo only this note's pending lock; the note and
    // its already-loaded comments must not be cleared optimistically.
    await expect(deleteButton).toBeEnabled({ timeout: 8_000 })
    await expect(note).toBeVisible()
    await expect(note.getByText(commentContent)).toBeVisible()
  })
})
