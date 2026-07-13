/**
 * Database write-rate-limit tests using direct authenticated PostgREST writes.
 *
 * Each test creates a transient Mustard account. delete_account removes its
 * content and cascades its private write-event rows, keeping tests isolated
 * without exposing test-only database functions.
 */
import { randomUUID } from 'node:crypto'
import { expect, test } from '@playwright/test'
import { adminClient, authedClient, getLocalSupabaseStatus, seedNote } from './local-supabase'

const PAGE_URL = 'http://127.0.0.1:4173/rate-limit-test.html'

let userId: string

function noteRow(content: string) {
  return {
    author_id: userId,
    page_url: PAGE_URL,
    content,
    relative_position_x: 50,
    relative_position_y: 50,
    click_position_x: 50,
    click_position_y: 300,
  }
}

test.beforeEach(async () => {
  userId = randomUUID()
  const admin = adminClient(getLocalSupabaseStatus())
  const { error } = await admin.from('users').insert({ id: userId })
  if (error) throw new Error(`Could not seed transient rate-limit user: ${error.message}`)
})

test.afterEach(async () => {
  const admin = adminClient(getLocalSupabaseStatus())
  const { error } = await admin.rpc('delete_account', { p_user_id: userId })
  if (error) throw new Error(`Could not remove transient rate-limit user: ${error.message}`)
})

test.describe('note rate limits', () => {
  test('allows 20 inserts and rejects the 21st within one minute', async () => {
    const client = authedClient(userId)

    for (let i = 0; i < 20; i++) {
      const { error } = await client.from('notes').insert(noteRow(`note ${i}`))
      expect(error).toBeNull()
    }

    const { error, status } = await client.from('notes').insert(noteRow('over limit'))
    expect(status).toBe(429)
    expect(error?.code).toBe('MUSTARD_RATE_LIMIT')
  })

  test('rejects an oversized bulk insert atomically', async () => {
    const client = authedClient(userId)
    const rows = Array.from({ length: 21 }, (_, i) => noteRow(`bulk ${i}`))

    const { error, status } = await client.from('notes').insert(rows)
    expect(status).toBe(429)
    expect(error?.code).toBe('MUSTARD_RATE_LIMIT')

    const admin = adminClient(getLocalSupabaseStatus())
    const { count } = await admin
      .from('notes')
      .select('*', { count: 'exact', head: true })
      .eq('author_id', userId)
    expect(count).toBe(0)
  })

  test('serializes concurrent inserts at the limit', async () => {
    const client = authedClient(userId)
    const results = await Promise.all(
      Array.from({ length: 22 }, (_, i) => client.from('notes').insert(noteRow(`concurrent ${i}`))),
    )

    expect(results.filter(({ error }) => error === null)).toHaveLength(20)
    expect(results.filter(({ status }) => status === 429)).toHaveLength(2)
  })

  test('does not limit service-role fixture writes', async () => {
    const status = getLocalSupabaseStatus()

    for (let i = 0; i < 30; i++) {
      await seedNote(userId, PAGE_URL, `service note ${i}`, status)
    }

    const admin = adminClient(status)
    const { count } = await admin
      .from('notes')
      .select('*', { count: 'exact', head: true })
      .eq('author_id', userId)
    expect(count).toBe(30)
  })
})

test.describe('comment rate limits', () => {
  test('allows 50 inserts and rejects the 51st within one minute', async () => {
    const status = getLocalSupabaseStatus()
    const noteId = await seedNote(userId, PAGE_URL, 'comment target', status)
    const client = authedClient(userId, status)

    for (let i = 0; i < 50; i++) {
      const { error } = await client.from('comments').insert({
        note_id: noteId,
        author_id: userId,
        content: `comment ${i}`,
      })
      expect(error).toBeNull()
    }

    const { error, status: httpStatus } = await client.from('comments').insert({
      note_id: noteId,
      author_id: userId,
      content: 'over limit',
    })
    expect(httpStatus).toBe(429)
    expect(error?.code).toBe('MUSTARD_RATE_LIMIT')
  })
})

test('reposts remain unlimited', async () => {
  const status = getLocalSupabaseStatus()
  const noteIds = await Promise.all(
    Array.from({ length: 40 }, (_, i) => seedNote(userId, PAGE_URL, `repost target ${i}`, status)),
  )
  const client = authedClient(userId, status)

  const { error } = await client
    .from('reposts')
    .insert(noteIds.map((noteId) => ({ note_id: noteId, reposter_id: userId })))

  expect(error).toBeNull()
})

test.describe('mention constraints', () => {
  test('rejects more than 5 mention recipients', async () => {
    const client = authedClient(userId)
    const { error } = await client.from('notes').insert({
      ...noteRow('too many mentions'),
      mentions: ['a', 'b', 'c', 'd', 'e', 'f'],
    })

    expect(error).not.toBeNull()
  })

  test('rejects duplicate mention recipients', async () => {
    const client = authedClient(userId)
    const { error } = await client.from('notes').insert({
      ...noteRow('duplicate mentions'),
      mentions: ['a', 'a'],
    })

    expect(error).not.toBeNull()
  })

  test('rejects duplicate recipients for service-role writes', async () => {
    const status = getLocalSupabaseStatus()
    const admin = adminClient(status)

    const { error: noteError } = await admin.from('notes').insert({
      ...noteRow('service-role duplicate mentions'),
      mentions: ['a', 'a'],
    })
    expect(noteError?.message).toContain('notes_mentions_unique')

    const noteId = await seedNote(userId, PAGE_URL, 'comment mention target', status)
    const { error: commentError } = await admin.from('comments').insert({
      note_id: noteId,
      author_id: userId,
      content: 'service-role duplicate mentions',
      mentions: ['a', 'a'],
    })
    expect(commentError?.message).toContain('comments_mentions_unique')
  })

  test('allows 5 distinct mention recipients', async () => {
    const client = authedClient(userId)
    const { error } = await client.from('notes').insert({
      ...noteRow('valid mentions'),
      mentions: ['a', 'b', 'c', 'd', 'e'],
    })

    expect(error).toBeNull()
  })
})
