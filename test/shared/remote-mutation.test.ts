import { describe, expect, it } from 'vitest'
import type { Message } from '../../src/shared/messaging'
import { isRemoteMutationMessage } from '../../src/shared/remote-mutation'

describe('isRemoteMutationMessage', () => {
  it('returns true for UPSERT_NOTE targeting remote', () => {
    const msg = { type: 'UPSERT_NOTE', data: {} as never, target: 'remote' } satisfies Message
    expect(isRemoteMutationMessage(msg)).toBe(true)
  })

  it('returns false for UPSERT_NOTE targeting local', () => {
    const msg = { type: 'UPSERT_NOTE', data: {} as never, target: 'local' } satisfies Message
    expect(isRemoteMutationMessage(msg)).toBe(false)
  })

  it('returns true for DELETE_NOTE with a remote authorId', () => {
    const msg = {
      type: 'DELETE_NOTE',
      noteId: 'n1',
      pageUrl: 'https://example.com',
      authorId: 'did:plc:abc123',
    } satisfies Message
    expect(isRemoteMutationMessage(msg)).toBe(true)
  })

  it('returns false for DELETE_NOTE with authorId "local"', () => {
    const msg = {
      type: 'DELETE_NOTE',
      noteId: 'n1',
      pageUrl: 'https://example.com',
      authorId: 'local',
    } satisfies Message
    expect(isRemoteMutationMessage(msg)).toBe(false)
  })

  it.each([
    'SET_REPOST',
    'UPSERT_COMMENT',
    'DELETE_COMMENT',
    'MARK_NOTIFICATIONS_SEEN_FOR_NOTE',
    'MARK_MENTION_SEEN',
  ] as const)('returns true for %s', (type) => {
    const msg = {
      type,
      ...(type === 'MARK_MENTION_SEEN' ? { notificationId: 'x' } : {}),
      ...(type === 'MARK_NOTIFICATIONS_SEEN_FOR_NOTE' ? { noteId: 'n' } : {}),
      ...(type === 'SET_REPOST'
        ? { noteId: 'n', pageUrl: 'https://example.com', reposted: true }
        : {}),
      ...(type === 'UPSERT_COMMENT' ? { noteId: 'n', content: 'hi' } : {}),
      ...(type === 'DELETE_COMMENT' ? { commentId: 'c', noteId: 'n' } : {}),
    } as Message
    expect(isRemoteMutationMessage(msg)).toBe(true)
  })

  it('returns false for read-only messages', () => {
    const readOnly: Message[] = [
      { type: 'QUERY_NOTES', pageUrl: 'https://example.com' },
      { type: 'GET_APP_STATUS' },
      { type: 'GET_ATPROTO_SESSION' },
    ]
    for (const msg of readOnly) {
      expect(isRemoteMutationMessage(msg)).toBe(false)
    }
  })
})
