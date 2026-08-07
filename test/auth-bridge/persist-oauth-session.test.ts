import { describe, expect, it, vi } from 'vitest'
import { persistOAuthSession } from '../../supabase/functions/auth-bridge/persist-oauth-session'

describe('persistOAuthSession', () => {
  it('retries a transient persistence failure before succeeding', async () => {
    const update = vi
      .fn<() => Promise<{ error: { message: string } | null }>>()
      .mockResolvedValueOnce({ error: { message: 'connection reset' } })
      .mockResolvedValueOnce({ error: { message: 'connection reset' } })
      .mockResolvedValueOnce({ error: null })

    await expect(persistOAuthSession(update)).resolves.toBeUndefined()
    expect(update).toHaveBeenCalledTimes(3)
  })

  it('fails after three unsuccessful persistence attempts', async () => {
    const update = vi.fn<() => Promise<{ error: { message: string } | null }>>().mockResolvedValue({
      error: { message: 'connection reset' },
    })

    await expect(persistOAuthSession(update)).rejects.toThrow(
      'Failed to persist OAuth session after 3 attempts: connection reset',
    )
    expect(update).toHaveBeenCalledTimes(3)
  })
})
