import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { from, select, eq, maybeSingle } = vi.hoisted(() => ({
  from: vi.fn(),
  select: vi.fn(),
  eq: vi.fn(),
  maybeSingle: vi.fn(),
}))

vi.mock('@/background/supabase-client', () => ({ supabase: { from } }))

import { MinimumVersionCriterion } from '@/background/business/service/extension-update/MinimumVersionCriterion'

describe('MinimumVersionCriterion', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-09-11T10:00:00Z'))
    from.mockReset().mockReturnValue({ select })
    select.mockReset().mockReturnValue({ eq })
    eq.mockReset().mockReturnValue({ maybeSingle })
    maybeSingle.mockReset().mockResolvedValue({
      data: { min_client_version: '2.14.0' },
      error: null,
    })
  })

  afterEach(() => vi.useRealTimers())

  it('refreshes the mandatory criterion after five minutes', async () => {
    const criterion = new MinimumVersionCriterion()

    await expect(criterion.getMinimumVersion()).resolves.toBe('2.14.0')
    vi.advanceTimersByTime(5 * 60 * 1000 - 1)
    await expect(criterion.getMinimumVersion()).resolves.toBe('2.14.0')
    expect(maybeSingle).toHaveBeenCalledOnce()

    maybeSingle.mockResolvedValue({
      data: { min_client_version: '2.15.0' },
      error: null,
    })
    vi.advanceTimersByTime(2)

    await expect(criterion.getMinimumVersion()).resolves.toBe('2.15.0')
    expect(maybeSingle).toHaveBeenCalledTimes(2)
  })
})
