import { describe, expect, it } from 'vitest'
import { shouldMintRefreshSession } from '../../supabase/functions/auth-bridge/client-session-compatibility'

describe('shouldMintRefreshSession', () => {
  it('keeps genuinely legacy callers on the JWT-only response shape', () => {
    expect(shouldMintRefreshSession('2.8.0')).toBe(false)
  })

  it('keeps a sid-backed linking session on the v2 response shape despite a downgraded client version', () => {
    expect(shouldMintRefreshSession('2.8.0', 'existing-session-id')).toBe(true)
  })
})
