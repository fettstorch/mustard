/**
 * Social visibility tests — prove that get-index-v2 applies the follow graph
 * correctly. These tests bypass the extension UI and call the function directly
 * so they are fast and free from UI flakiness.
 *
 * Layout:
 *   viewer  follows  author
 *   viewer  follows  reposter
 *   stranger follows nobody
 *   reposter reposts author's notes
 *
 * All data is seeded/torn down per test to stay deterministic.
 */
import { test, expect } from '@playwright/test'
import { TEST_USERS } from './auth-test-data'
import {
  deleteNote,
  deleteRepost,
  fetchIndex,
  getLocalSupabaseStatus,
  seedNote,
  seedRepost,
  setFollows,
} from './local-supabase'

const { viewer, author, reposter, stranger } = TEST_USERS
const FIXTURE_URL = 'http://127.0.0.1:4173/page.html'

test.describe('direct follow visibility', () => {
  let noteId: string

  test.beforeEach(async () => {
    const status = getLocalSupabaseStatus()
    // viewer follows author; stranger follows nobody
    await setFollows(viewer.userId, [author.userId], status)
    await setFollows(stranger.userId, [], status)
    noteId = await seedNote(author.userId, FIXTURE_URL, 'Direct follow test note', status)
  })

  test.afterEach(async () => {
    await deleteNote(noteId)
  })

  test('viewer sees the author note in the index', async () => {
    const payload = await fetchIndex(viewer.userId)
    expect(payload.index[author.userId]).toContain(FIXTURE_URL)
  })

  test('stranger does not see the author note', async () => {
    const payload = await fetchIndex(stranger.userId)
    // index contains only the stranger's own pages (empty here since no notes)
    expect(payload.index[author.userId]).toBeUndefined()
  })

  test('viewer always sees their own notes regardless of follow graph', async () => {
    const ownNoteId = await seedNote(viewer.userId, FIXTURE_URL, 'Own note')
    try {
      const payload = await fetchIndex(viewer.userId)
      expect(payload.index[viewer.userId]).toContain(FIXTURE_URL)
    } finally {
      await deleteNote(ownNoteId)
    }
  })
})

test.describe('repost visibility bridge', () => {
  let authorNoteId: string
  let authorNote2Id: string

  test.beforeEach(async () => {
    const status = getLocalSupabaseStatus()
    // viewer follows reposter only (not author directly)
    await setFollows(viewer.userId, [reposter.userId], status)
    await setFollows(stranger.userId, [], status)
    authorNoteId = await seedNote(author.userId, FIXTURE_URL, 'Reposted note', status)
    authorNote2Id = await seedNote(
      author.userId,
      'http://127.0.0.1:4173/other.html',
      'Non-reposted author note',
      status,
    )
  })

  test.afterEach(async () => {
    await deleteNote(authorNoteId)
    await deleteNote(authorNote2Id)
  })

  test('repost bridges the note to viewers who follow the reposter', async () => {
    await seedRepost(authorNoteId, reposter.userId)
    try {
      const payload = await fetchIndex(viewer.userId)
      expect(payload.repostedNoteIds).toContain(authorNoteId)
    } finally {
      await deleteRepost(authorNoteId, reposter.userId)
    }
  })

  test("repost does not expose author's other notes (only the reposted one)", async () => {
    await seedRepost(authorNoteId, reposter.userId)
    try {
      const payload = await fetchIndex(viewer.userId)
      // Viewer sees the reposted note but NOT all of author's pages
      expect(payload.repostedNoteIds).toContain(authorNoteId)
      expect(payload.index[author.userId]).toBeUndefined()
    } finally {
      await deleteRepost(authorNoteId, reposter.userId)
    }
  })

  test('unrepost revokes the visibility bridge', async () => {
    await seedRepost(authorNoteId, reposter.userId)
    await deleteRepost(authorNoteId, reposter.userId)

    const payload = await fetchIndex(viewer.userId)
    expect(payload.repostedNoteIds).not.toContain(authorNoteId)
    expect(payload.index[author.userId]).toBeUndefined()
  })

  test('stranger does not see the repost bridge', async () => {
    await seedRepost(authorNoteId, reposter.userId)
    try {
      const payload = await fetchIndex(stranger.userId)
      expect(payload.repostedNoteIds).not.toContain(authorNoteId)
    } finally {
      await deleteRepost(authorNoteId, reposter.userId)
    }
  })
})

test.describe('repostersByNoteId', () => {
  let noteId: string

  test.beforeEach(async () => {
    const status = getLocalSupabaseStatus()
    await setFollows(viewer.userId, [author.userId, reposter.userId], status)
    noteId = await seedNote(author.userId, FIXTURE_URL, 'Reposter list note', status)
  })

  test.afterEach(async () => {
    await deleteNote(noteId)
  })

  test('repostersByNoteId lists all reposters for notes visible to the viewer', async () => {
    await seedRepost(noteId, reposter.userId)
    try {
      const payload = await fetchIndex(viewer.userId)
      expect(payload.repostersByNoteId[noteId]).toContain(reposter.userId)
    } finally {
      await deleteRepost(noteId, reposter.userId)
    }
  })
})
