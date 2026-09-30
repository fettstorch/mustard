import { beforeEach, describe, expect, it, vi } from 'vitest'

const { from } = vi.hoisted(() => ({ from: vi.fn() }))

vi.mock('@/background/supabase-client', () => ({ supabase: { from } }))

import { MustardSubscriptionsServiceRemote } from '@/background/business/service/MustardSubscriptionsServiceRemote'

describe('MustardSubscriptionsServiceRemote', () => {
  const service = new MustardSubscriptionsServiceRemote()

  beforeEach(() => from.mockReset())

  it('maps page and user subscription rows', async () => {
    const overrideTypes = vi.fn().mockResolvedValue({
      data: [
        {
          id: 'page-1',
          kind: 'page',
          page_key: 'https://example.com/article',
          target_user_id: null,
          created_at: '2026-01-02T00:00:00Z',
        },
        {
          id: 'user-1',
          kind: 'user',
          page_key: null,
          target_user_id: '11111111-1111-4111-8111-111111111111',
          created_at: '2026-01-01T00:00:00Z',
        },
      ],
      error: null,
    })
    from.mockReturnValue({
      select: () => ({ order: () => ({ overrideTypes }) }),
    })

    await expect(service.getSubscriptions()).resolves.toEqual([
      {
        id: 'page-1',
        kind: 'page',
        pageKey: 'https://example.com/article',
        createdAt: Date.parse('2026-01-02T00:00:00Z'),
      },
      {
        id: 'user-1',
        kind: 'user',
        targetUserId: '11111111-1111-4111-8111-111111111111',
        createdAt: Date.parse('2026-01-01T00:00:00Z'),
      },
    ])
  })

  it('rejects AT Protocol page subscriptions before writing', async () => {
    await expect(
      service.setPageSubscription('viewer', 'at://alice/app.bsky.feed.post/abc', true),
    ).rejects.toThrow('not supported')
    expect(from).not.toHaveBeenCalled()
  })

  it('treats a duplicate subscription insert as already subscribed', async () => {
    const insert = vi.fn().mockResolvedValue({
      error: { code: '23505', message: 'duplicate key' },
    })
    from.mockReturnValue({ insert })

    await expect(service.setUserSubscription('viewer', 'author', true)).resolves.toBeUndefined()
    expect(insert).toHaveBeenCalledWith({
      subscriber_id: 'viewer',
      kind: 'user',
      target_user_id: 'author',
    })
  })
})
