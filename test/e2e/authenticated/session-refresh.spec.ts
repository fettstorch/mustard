// Covers the client's jwt+refreshToken lifecycle end-to-end against the real
// local auth-bridge + mustard_sessions table. Split across two fixtures:
//  - browser tests (authenticated.fixture) for client-visible behavior: no
//    forced re-login on migration, and the session-expired banner on revoke.
//  - plain HTTP tests (local-supabase.fixture) for server-side rotation
//    mechanics, which don't need a browser at all.
import { expect, test as browserTest } from './authenticated.fixture'
import { setSupabaseJwtCache, getSupabaseJwtCache } from './authenticated.fixture'
import { test as dbTest } from './local-supabase.fixture'
import { TEST_USERS, createAuthE2eJwt } from './auth-test-data'
import {
  adminClient,
  authBridgeCall,
  deleteNote,
  exchangeLegacyJwtForSession,
  getLocalSupabaseStatus,
  seedNote,
} from './local-supabase'

const fixtureUrl = 'http://127.0.0.1:4173/page.html'
const { viewer } = TEST_USERS

function expiredJwt(userId: string): string {
  return createAuthE2eJwt(userId, Math.floor(Date.now() / 1000) - 2 * 60 * 60).jwt
}

function expiringSoon(): number {
  return Math.floor(Date.now() / 1000) + 30 // inside SupabaseAuth's 60s refresh window
}

browserTest.describe('client-visible session lifecycle', () => {
  browserTest(
    'silently exchanges a legacy jwt-only cache for a jwt+refreshToken pair and keeps notes loading',
    async ({ authenticatedContext: context }, testInfo) => {
      // The default 30s test timeout leaves too little room around a 25s
      // visibility wait (see below) plus setup/teardown overhead.
      testInfo.setTimeout(45_000)
      const noteId = await seedNote(viewer.userId, fixtureUrl, 'Still here after migration')
      try {
        await setSupabaseJwtCache(context, {
          jwt: expiredJwt(viewer.userId),
          userId: viewer.userId,
          expiresAt: Math.floor(Date.now() / 1000) - 60 * 60,
        })

        const page = await context.newPage()
        await page.goto(fixtureUrl)

        // No forced re-login: the note the (expired-jwt) user is entitled to
        // still loads, proving the exchange happened transparently. Generous
        // timeout: the exchange chain (verify JWT -> oauth_session lookup ->
        // createSession insert) plus the notes round-trip is several sequential
        // edge-function + DB round trips and can be slow under load on a local
        // stack (observed to occasionally exceed 15s deep into a full test run).
        await expect(
          page.locator('#mustard-host').getByText('Still here after migration'),
        ).toBeVisible({ timeout: 25_000 })

        await expect(async () => {
          const cache = await getSupabaseJwtCache(context)
          expect(cache?.refreshToken).toBeTruthy()
        }).toPass({ timeout: 8_000 })
      } finally {
        await deleteNote(noteId)
      }
    },
  )

  browserTest(
    'shows the session-expired banner and clears local credentials once the server-side session is revoked',
    async ({ authenticatedContext: context }) => {
      const pair = await exchangeLegacyJwtForSession(viewer.userId)
      const revoked = await authBridgeCall({ action: 'logout', refreshToken: pair.refreshToken })
      expect(revoked.status).toBe(200)

      await setSupabaseJwtCache(context, {
        jwt: pair.jwt,
        userId: viewer.userId,
        expiresAt: expiringSoon(),
        refreshToken: pair.refreshToken,
      })

      const page = await context.newPage()
      await page.goto(fixtureUrl)

      await expect(page.locator('#mustard-session-expired-banner')).toBeVisible({ timeout: 8_000 })
      await expect(async () => {
        expect(await getSupabaseJwtCache(context)).toBeUndefined()
      }).toPass({ timeout: 8_000 })
    },
  )
})

dbTest.describe('server-side rotation mechanics', () => {
  dbTest('preserves a pre-upgrade atproto session when issuer discovery fails', async () => {
    const admin = adminClient(getLocalSupabaseStatus())
    const { error: deleteError } = await admin
      .from('oauth_session')
      .delete()
      .eq('user_id', viewer.userId)
    expect(deleteError).toBeNull()

    const { error: insertError } = await admin.from('oauth_session').insert({
      provider: 'atproto',
      provider_account_id: 'did:unsupported:temporary-discovery-failure',
      user_id: viewer.userId,
      access_token: 'still-potentially-valid-access-token',
      refresh_token: 'still-potentially-valid-refresh-token',
      token_endpoint: 'https://example.invalid/token',
      dpop_jwk: {},
      dpop_pub_jwk: {},
      scope: 'atproto',
      as_issuer: null,
    })
    expect(insertError).toBeNull()

    const { status } = await authBridgeCall({
      action: 'refresh',
      userId: viewer.userId,
      expired_jwt: expiredJwt(viewer.userId),
      clientVersion: '2.9.0',
    })
    expect(status).toBe(200)

    const { data: preserved, error: lookupError } = await admin
      .from('oauth_session')
      .select('provider_account_id')
      .eq('user_id', viewer.userId)
      .maybeSingle()
    expect(lookupError).toBeNull()
    expect(preserved?.provider_account_id).toBe('did:unsupported:temporary-discovery-failure')
  })

  dbTest('does not create an unreachable session for a legacy client', async () => {
    const { jwt } = createAuthE2eJwt(viewer.userId, Math.floor(Date.now() / 1000) - 2 * 60 * 60)

    const { status, body } = await authBridgeCall({
      action: 'refresh',
      userId: viewer.userId,
      expired_jwt: jwt,
    })

    expect(status).toBe(200)
    expect(body.refreshToken).toBeUndefined()

    const admin = adminClient(getLocalSupabaseStatus())
    const { count, error } = await admin
      .from('mustard_sessions')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', viewer.userId)
    expect(error).toBeNull()
    expect(count).toBe(0)
  })

  dbTest('rejects a revoked v2 session JWT on the legacy exchange path', async () => {
    const pair = await exchangeLegacyJwtForSession(viewer.userId)
    const logout = await authBridgeCall({ action: 'logout', refreshToken: pair.refreshToken })
    expect(logout.status).toBe(200)

    const { status, body } = await authBridgeCall({
      action: 'refresh',
      userId: viewer.userId,
      expired_jwt: pair.jwt,
      clientVersion: '2.9.0',
    })

    expect(status).toBe(403)
    expect(body.error).toMatch(/session-backed jwt.*legacy exchange/i)
  })

  dbTest('rotates a valid refresh token and returns a fresh pair', async () => {
    const pair1 = await exchangeLegacyJwtForSession(viewer.userId)

    const { status, body } = await authBridgeCall({
      action: 'refresh',
      refreshToken: pair1.refreshToken,
    })

    // Only the refresh token is asserted to change: the jwt's claims (sub,
    // sid, iat, exp) can legitimately be byte-identical to the previous mint
    // when both happen within the same wall-clock second (same `sid` - a
    // rotation keeps the session row, only the refresh token rotates).
    expect(status).toBe(200)
    expect(body.refreshToken).not.toBe(pair1.refreshToken)
  })

  dbTest('rotates independently of the upstream provider session', async () => {
    const pair = await exchangeLegacyJwtForSession(viewer.userId)
    const admin = adminClient(getLocalSupabaseStatus())
    const { error } = await admin.from('oauth_session').delete().eq('user_id', viewer.userId)
    expect(error).toBeNull()

    const { status, body } = await authBridgeCall({
      action: 'refresh',
      refreshToken: pair.refreshToken,
    })

    expect(status).toBe(200)
    expect(body.refreshToken).not.toBe(pair.refreshToken)
  })

  dbTest('rejects a refresh token once it is more than one rotation out of date', async () => {
    const pair1 = await exchangeLegacyJwtForSession(viewer.userId)
    const { body: pair2 } = await authBridgeCall({
      action: 'refresh',
      refreshToken: pair1.refreshToken,
    })
    // pair1 is still honored one rotation later (the grace window) -- rotate
    // a second time so it becomes two generations old, which grace never covers.
    await authBridgeCall({ action: 'refresh', refreshToken: pair2.refreshToken as string })

    const { status, body } = await authBridgeCall({
      action: 'refresh',
      refreshToken: pair1.refreshToken,
    })

    expect(status).toBe(401)
    expect(body.error).toMatch(/invalid or expired refresh token/i)
  })

  dbTest('logout deletes the session so the old refresh token stops working', async () => {
    const pair = await exchangeLegacyJwtForSession(viewer.userId)

    const logoutRes = await authBridgeCall({ action: 'logout', refreshToken: pair.refreshToken })
    expect(logoutRes.status).toBe(200)

    const { status } = await authBridgeCall({ action: 'refresh', refreshToken: pair.refreshToken })
    expect(status).toBe(401)
  })
})
