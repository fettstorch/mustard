/**
 * Engagement and notification tests.
 *
 * Covers:
 *  - Comment creation (via extension UI) creates a notification in the DB
 *  - Note authors and prior thread participants are notified of new comments
 *  - Comment actors are excluded and recipients are de-duplicated
 *  - Author popup shows a notification badge for unread comments
 *  - Mark-seen (deleting the notification) clears the badge
 *  - Comment deletion cascades to its notification
 *
 * Viewer is the commenter; author is the note owner.
 */
import { expect, test } from './authenticated.fixture'
import { TEST_USERS } from './auth-test-data'
import {
  adminClient,
  deleteComment,
  deleteNote,
  fetchIndex,
  getLocalSupabaseStatus,
  seedComment,
  seedNote,
  setFollows,
} from './local-supabase'
import { loginAs } from '../extension.fixture'

const { viewer, author } = TEST_USERS
const FIXTURE_URL = 'http://127.0.0.1:4173/page.html'

test.describe('notification trigger', () => {
  let noteId: string

  test.beforeEach(async () => {
    const status = getLocalSupabaseStatus()
    await setFollows(viewer.userId, [author.userId], status)
    noteId = await seedNote(author.userId, FIXTURE_URL, 'Note to receive a comment', status)
  })

  test.afterEach(async () => {
    await deleteNote(noteId)
  })

  test("commenting on another user's note creates a notification row for the author", async () => {
    const status = getLocalSupabaseStatus()
    const commentId = await seedComment(noteId, viewer.userId, 'Great note!', status)
    try {
      const admin = adminClient(status)
      const { data } = await admin
        .from('notifications')
        .select('id, type, actor_id')
        .eq('note_id', noteId)
        .eq('recipient_id', author.userId)
      expect(data).toHaveLength(1)
      expect(data![0].type).toBe('comment')
      expect(data![0].actor_id).toBe(viewer.userId)
    } finally {
      await deleteComment(commentId, status)
    }
  })

  test('self-comment does not create a notification', async () => {
    const status = getLocalSupabaseStatus()
    const commentId = await seedComment(noteId, author.userId, 'Own comment', status)
    try {
      const admin = adminClient(status)
      const { data } = await admin
        .from('notifications')
        .select('id')
        .eq('note_id', noteId)
        .eq('recipient_id', author.userId)
      expect(data).toHaveLength(0)
    } finally {
      await deleteComment(commentId, status)
    }
  })

  test('a new comment notifies the note author and every prior commenter', async () => {
    const status = getLocalSupabaseStatus()
    const firstViewerCommentId = await seedComment(
      noteId,
      viewer.userId,
      'Viewer joins the thread',
      status,
    )
    const strangerCommentId = await seedComment(
      noteId,
      TEST_USERS.stranger.userId,
      'Stranger joins the thread',
      status,
    )

    // Clear the setup notifications so only the notification fan-out caused by
    // the next comment is asserted below.
    const admin = adminClient(status)
    await admin.from('notifications').delete().eq('note_id', noteId)

    const replyId = await seedComment(noteId, author.userId, 'Author replies to everyone', status)
    try {
      const { data, error } = await admin
        .from('notifications')
        .select('recipient_id, actor_id, type')
        .eq('comment_id', replyId)
        .order('recipient_id')
      if (error) throw new Error(`Could not query notifications: ${error.message}`)

      expect(data).toEqual([
        {
          recipient_id: viewer.userId,
          actor_id: author.userId,
          type: 'comment',
        },
        {
          recipient_id: TEST_USERS.stranger.userId,
          actor_id: author.userId,
          type: 'comment',
        },
      ])
    } finally {
      await deleteComment(replyId, status)
      await deleteComment(strangerCommentId, status)
      await deleteComment(firstViewerCommentId, status)
    }
  })

  test('repeated comments by one participant create only one notification per new comment', async () => {
    const status = getLocalSupabaseStatus()
    const firstCommentId = await seedComment(noteId, viewer.userId, 'First comment', status)
    const secondCommentId = await seedComment(noteId, viewer.userId, 'Second comment', status)
    const admin = adminClient(status)
    await admin.from('notifications').delete().eq('note_id', noteId)

    const replyId = await seedComment(
      noteId,
      TEST_USERS.stranger.userId,
      'A reply to the thread',
      status,
    )
    try {
      const { data, error } = await admin
        .from('notifications')
        .select('recipient_id')
        .eq('comment_id', replyId)
        .eq('recipient_id', viewer.userId)
      if (error) throw new Error(`Could not query notifications: ${error.message}`)
      expect(data).toHaveLength(1)
    } finally {
      await deleteComment(replyId, status)
      await deleteComment(secondCommentId, status)
      await deleteComment(firstCommentId, status)
    }
  })

  test('mentioning a prior participant does not double-notify them', async () => {
    const status = getLocalSupabaseStatus()
    const priorCommentId = await seedComment(noteId, viewer.userId, 'Viewer joins', status)
    const admin = adminClient(status)
    await admin.from('notifications').delete().eq('note_id', noteId)

    const { data: reply, error: insertError } = await admin
      .from('comments')
      .insert({
        note_id: noteId,
        author_id: TEST_USERS.stranger.userId,
        content: `Replying to @[p:github:${viewer.identity.providerAccountId}]`,
        mentions: [viewer.identity.providerAccountId],
      })
      .select('id')
      .single()
    if (insertError) throw new Error(`Could not seed mention reply: ${insertError.message}`)
    const replyId = (reply as { id: string }).id

    try {
      const { data, error } = await admin
        .from('notifications')
        .select('type')
        .eq('comment_id', replyId)
        .eq('recipient_id', viewer.userId)
      if (error) throw new Error(`Could not query notifications: ${error.message}`)
      expect(data).toEqual([{ type: 'comment' }])
    } finally {
      await deleteComment(replyId, status)
      await deleteComment(priorCommentId, status)
    }
  })

  test('deleting a comment cascades its notification', async () => {
    const status = getLocalSupabaseStatus()
    const commentId = await seedComment(noteId, viewer.userId, 'Will be deleted', status)
    await deleteComment(commentId, status)

    const admin = adminClient(status)
    const { data } = await admin
      .from('notifications')
      .select('id')
      .eq('note_id', noteId)
      .eq('recipient_id', author.userId)
    expect(data).toHaveLength(0)
  })
})

test.describe('popup notification badge', () => {
  let noteId: string

  test.beforeEach(async () => {
    const status = getLocalSupabaseStatus()
    await setFollows(viewer.userId, [author.userId], status)
    noteId = await seedNote(author.userId, FIXTURE_URL, 'Badge test note', status)
    // Comment cascade-deletes when note is deleted; no separate cleanup needed
    await seedComment(noteId, viewer.userId, 'Badge trigger comment', status)
  })

  test.afterEach(async () => {
    await deleteNote(noteId)
  })

  test('author popup shows unread notification count', async ({
    authenticatedContext: context,
    popupUrl,
  }) => {
    // Switch the extension session to the author
    await loginAs(context, author)

    const popup = await context.newPage()
    await popup.goto(popupUrl)

    // The popup "Notes & Threads" section shows unread count when there are notifications
    await expect(popup.getByRole('button', { name: 'Logout' })).toBeVisible()
    const unreadPill = popup.locator('.my-pages-unread-pill')
    await expect(unreadPill).toBeVisible()
    await expect(unreadPill).toContainText('1 unread')

    await popup.close()
    // Restore viewer session for any subsequent tests
    await loginAs(context, viewer)
  })

  test('prior commenter popup shows unread activity on another author’s note', async ({
    authenticatedContext: context,
    popupUrl,
  }) => {
    const status = getLocalSupabaseStatus()
    await seedComment(noteId, TEST_USERS.stranger.userId, 'A later participant replies', status)

    const popup = await context.newPage()
    await popup.goto(popupUrl)

    const unreadPill = popup.locator('.my-pages-unread-pill')
    await expect(unreadPill).toBeVisible()
    await expect(unreadPill).toContainText('1 unread')

    await popup.getByRole('button', { name: /Notes & Threads/ }).click()
    const unreadPage = popup.locator('.my-pages-row.has-unread')
    await expect(unreadPage).toHaveCount(1)
    await expect(unreadPage).toHaveAttribute('title', FIXTURE_URL)

    await popup.close()
  })
})

test.describe('joined-thread deep link (unfollowed author)', () => {
  let noteId: string

  test.beforeEach(async () => {
    noteId = await seedNote(author.userId, FIXTURE_URL, 'Note the stranger joins uninvited')
    await seedComment(
      noteId,
      TEST_USERS.stranger.userId,
      'Stranger joins without following the author',
    )
    // A later reply creates the unread notification the stranger clicks through.
    await seedComment(noteId, viewer.userId, 'Someone else replies to the thread')
  })

  test.afterEach(async () => {
    await deleteNote(noteId)
  })

  test('clicking the joined-thread popup row reveals the note even though the author is unfollowed', async ({
    authenticatedContext: context,
    popupUrl,
  }) => {
    // stranger follows nobody — a genuine "joined an unfollowed author's
    // thread" scenario, not just an unread-count check.
    await loginAs(context, TEST_USERS.stranger)

    const popup = await context.newPage()
    await popup.goto(popupUrl)

    const unreadPill = popup.locator('.my-pages-unread-pill')
    await expect(unreadPill).toBeVisible()
    await expect(unreadPill).toContainText('1 unread')

    await popup.getByRole('button', { name: /Notes & Threads/ }).click()
    const unreadRow = popup.locator('.my-pages-row.has-unread')
    await expect(unreadRow).toHaveCount(1)

    const [notePage] = await Promise.all([context.waitForEvent('page'), unreadRow.click()])
    await notePage.waitForLoadState()

    const mustard = notePage.locator('#mustard-host')
    const note = mustard
      .locator('.mustard-note-wrapper')
      .filter({ hasText: 'Note the stranger joins uninvited' })
    // This is the exact gap the Codex review flagged: queryNotes only fetches
    // notes reachable via follow/repost/mention, so a joined-thread note from
    // an unfollowed author never loads here even though the popup linked to it.
    // The repair path is a few sequential round trips (unread-ids → notes-by-id
    // → comments/counts), slower than a normal page load, hence the longer wait.
    await expect(note).toBeVisible({ timeout: 15_000 })
    await expect(note.getByText('Someone else replies to the thread')).toBeVisible()

    await loginAs(context, viewer)
  })
})

test.describe('mention visibility in index', () => {
  let noteId: string

  test.afterEach(async () => {
    if (noteId) await deleteNote(noteId)
  })

  test('a note mentioning a user appears in their mentionedNoteIds', async () => {
    const status = getLocalSupabaseStatus()
    const admin = adminClient(status)

    // Mentions are stored as provider account IDs, matched against the viewer's
    // identities.provider_account_id by the get_index_payload SQL function.
    const mentionedAccountId = viewer.identity.providerAccountId

    const { data, error } = await admin
      .from('notes')
      .insert({
        author_id: author.userId,
        page_url: 'http://127.0.0.1:4173/mention-page.html',
        content: `Hey @[p:github:${mentionedAccountId}]!`,
        mentions: [mentionedAccountId],
        relative_position_x: 50,
        relative_position_y: 50,
        click_position_x: 50,
        click_position_y: 300,
      })
      .select('id')
      .single()
    if (error) throw new Error(`Could not seed mention note: ${error.message}`)
    noteId = (data as { id: string }).id

    // The get_index_payload function resolves mentions via the identities table:
    // `mentions && viewer_account_ids.ids` — the note should appear in mentionedNoteIds
    const payload = await fetchIndex(viewer.userId)
    expect(payload.mentionedNoteIds).toContain(noteId)
  })
})
