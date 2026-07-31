import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fakeBrowser } from 'wxt/testing/fake-browser'
import { storeSession } from '../../../src/background/auth/SessionStore'
import {
  getSupabaseJwt,
  revokeSupabaseSession,
  storeSupabaseJwt,
} from '../../../src/background/auth/SupabaseAuth'

const USER_ID = '11111111-1111-4111-8111-111111111111'
const SUPABASE_JWT_KEY = 'supabase_jwt' // mirrors the module-private STORAGE_KEY

const now = () => Math.floor(Date.now() / 1000)
// isExpiringSoon triggers within 60s of expiry — EXPIRING is inside that window.
const EXPIRING = now() + 30
const FRESH = now() + 3600

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status })
}

/** Bypass storeSupabaseJwt's (now-required) refreshToken param to simulate a
 * pre-overhaul cache entry that predates refresh tokens entirely. */
async function seedLegacyCache(jwt: string, expiresAt: number, userId: string): Promise<void> {
  await browser.storage.local.set({ [SUPABASE_JWT_KEY]: { jwt, userId, expiresAt } })
}

describe('SupabaseAuth', () => {
  beforeEach(async () => {
    fakeBrowser.reset()
    await storeSession({ userId: USER_ID, identities: [] })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('returns the cached jwt without a network call when not expiring soon', async () => {
    await storeSupabaseJwt('jwt-1', FRESH, USER_ID, 'refresh-1')
    const fetch = vi.fn<typeof globalThis.fetch>()
    vi.stubGlobal('fetch', fetch)

    await expect(getSupabaseJwt()).resolves.toBe('jwt-1')
    expect(fetch).not.toHaveBeenCalled()
  })

  it('rotates via the cached refreshToken when the jwt is expiring soon', async () => {
    await storeSupabaseJwt('jwt-old', EXPIRING, USER_ID, 'refresh-old')
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValue(
        jsonResponse({ jwt: 'jwt-new', expiresAt: FRESH, refreshToken: 'refresh-new' }),
      )
    vi.stubGlobal('fetch', fetch)

    await expect(getSupabaseJwt()).resolves.toBe('jwt-new')
    expect(fetch).toHaveBeenCalledTimes(1)
    const body = JSON.parse(fetch.mock.calls[0]?.[1]?.body as string)
    expect(body).toEqual({ action: 'refresh', refreshToken: 'refresh-old' })

    const stored = await browser.storage.local.get(SUPABASE_JWT_KEY)
    expect(stored[SUPABASE_JWT_KEY]).toMatchObject({ jwt: 'jwt-new', refreshToken: 'refresh-new' })
  })

  it('exchanges a legacy jwt-only cache for a jwt+refreshToken pair (one-time migration)', async () => {
    await seedLegacyCache('jwt-legacy', EXPIRING, USER_ID)
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValue(
        jsonResponse({ jwt: 'jwt-new', expiresAt: FRESH, refreshToken: 'refresh-new' }),
      )
    vi.stubGlobal('fetch', fetch)

    await expect(getSupabaseJwt()).resolves.toBe('jwt-new')
    const body = JSON.parse(fetch.mock.calls[0]?.[1]?.body as string)
    expect(body).toEqual({ action: 'refresh', userId: USER_ID, expired_jwt: 'jwt-legacy' })

    // The exchange leaves a steady-state cache — no more legacy branch on next call.
    const stored = await browser.storage.local.get(SUPABASE_JWT_KEY)
    expect(stored[SUPABASE_JWT_KEY]).toMatchObject({ jwt: 'jwt-new', refreshToken: 'refresh-new' })
  })

  it('rejects a legacy did-prefixed cache entry and returns null without a network call', async () => {
    await seedLegacyCache('jwt-ancient', EXPIRING, 'did:plc:abc123')
    const fetch = vi.fn<typeof globalThis.fetch>()
    vi.stubGlobal('fetch', fetch)

    await expect(getSupabaseJwt()).resolves.toBeNull()
    expect(fetch).not.toHaveBeenCalled()
  })

  it('serializes concurrent callers so only one refresh request hits auth-bridge', async () => {
    await storeSupabaseJwt('jwt-old', EXPIRING, USER_ID, 'refresh-old')
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValue(
        jsonResponse({ jwt: 'jwt-new', expiresAt: FRESH, refreshToken: 'refresh-new' }),
      )
    vi.stubGlobal('fetch', fetch)

    const [first, second] = await Promise.all([getSupabaseJwt(), getSupabaseJwt()])

    expect(first).toBe('jwt-new')
    expect(second).toBe('jwt-new')
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it('keeps credentials and returns null on a transient 503 refresh failure', async () => {
    await storeSupabaseJwt('jwt-old', EXPIRING, USER_ID, 'refresh-old')
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(jsonResponse({}, 503))
    vi.stubGlobal('fetch', fetch)

    await expect(getSupabaseJwt()).resolves.toBeNull()

    const stored = await browser.storage.local.get(SUPABASE_JWT_KEY)
    expect(stored[SUPABASE_JWT_KEY]).toMatchObject({ jwt: 'jwt-old', refreshToken: 'refresh-old' })
  })

  it('clears credentials on a non-transient refresh failure (server-side session gone)', async () => {
    await storeSupabaseJwt('jwt-old', EXPIRING, USER_ID, 'refresh-old')
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValue(jsonResponse({ error: 'Invalid or expired refresh token' }, 401))
    vi.stubGlobal('fetch', fetch)

    await expect(getSupabaseJwt()).resolves.toBeNull()

    const stored = await browser.storage.local.get(SUPABASE_JWT_KEY)
    expect(stored[SUPABASE_JWT_KEY]).toBeUndefined()
  })

  it('revokeSupabaseSession posts logout with the refreshToken and clears local credentials', async () => {
    await storeSupabaseJwt('jwt-1', FRESH, USER_ID, 'refresh-1')
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(jsonResponse({ ok: true }))
    vi.stubGlobal('fetch', fetch)

    await revokeSupabaseSession()

    const body = JSON.parse(fetch.mock.calls[0]?.[1]?.body as string)
    expect(body).toEqual({ action: 'logout', refreshToken: 'refresh-1' })
    const stored = await browser.storage.local.get(SUPABASE_JWT_KEY)
    expect(stored[SUPABASE_JWT_KEY]).toBeUndefined()
  })

  it('revokeSupabaseSession clears local credentials even if the network call fails', async () => {
    await storeSupabaseJwt('jwt-1', FRESH, USER_ID, 'refresh-1')
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof globalThis.fetch>().mockRejectedValue(new Error('network down')),
    )

    await revokeSupabaseSession()

    const stored = await browser.storage.local.get(SUPABASE_JWT_KEY)
    expect(stored[SUPABASE_JWT_KEY]).toBeUndefined()
  })
})
