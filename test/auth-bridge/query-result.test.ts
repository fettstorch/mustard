import { describe, expect, it } from 'vitest'
import { requireQueryData } from '../../supabase/functions/auth-bridge/query-result'

describe('requireQueryData', () => {
  it('propagates a failed database lookup instead of treating it as empty data', () => {
    expect(() =>
      requireQueryData({
        data: null,
        error: { message: 'connection to database was interrupted' },
      }),
    ).toThrow('oauth_session lookup failed: connection to database was interrupted')
  })

  it('returns query data when the lookup succeeds', () => {
    const data = [{ provider: 'atproto' }]
    expect(requireQueryData({ data, error: null })).toBe(data)
  })
})
