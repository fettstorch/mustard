import { createHmac } from 'node:crypto'

export type TestUser = {
  userId: string
  identity: {
    provider: 'github' | 'atproto'
    providerAccountId: string
    handle: string
  }
}

/**
 * Deterministic test accounts — each has a fixed UUID and GitHub identity.
 * All IDs follow a 1111…/2222…/3333…/4444… pattern so they're easy to spot
 * in DB logs and can never collide with real production UUIDs.
 */
export const TEST_USERS = {
  /** Primary viewer — used by the original single-user smoke tests. */
  viewer: {
    userId: '11111111-1111-4111-8111-111111111111',
    identity: {
      provider: 'github' as const,
      providerAccountId: '999999999',
      handle: 'mustard-e2e',
    },
  },
  /** Publishes notes that the viewer should be able to see. */
  author: {
    userId: '22222222-2222-4222-8222-222222222222',
    identity: {
      provider: 'github' as const,
      providerAccountId: '999999002',
      handle: 'mustard-author',
    },
  },
  /** Reposts author's notes so the viewer can discover them via the reposter. */
  reposter: {
    userId: '33333333-3333-4333-8333-333333333333',
    identity: {
      provider: 'github' as const,
      providerAccountId: '999999003',
      handle: 'mustard-reposter',
    },
  },
  /** Follows nobody and is followed by nobody — a negative-control user. */
  stranger: {
    userId: '44444444-4444-4444-8444-444444444444',
    identity: {
      provider: 'github' as const,
      providerAccountId: '999999004',
      handle: 'mustard-stranger',
    },
  },
} as const satisfies Record<string, TestUser>

/** Back-compat alias so the existing smoke tests still compile unchanged. */
export const AUTH_E2E_USER = TEST_USERS.viewer

export const LOCAL_SUPABASE = {
  apiUrl: 'http://127.0.0.1:54321',
  jwtSecret: 'super-secret-jwt-token-with-at-least-32-characters-long',
}

function encode(value: object): string {
  return Buffer.from(JSON.stringify(value)).toString('base64url')
}

/** Mint a local HS256 JWT for the given Mustard userId. */
export function createAuthE2eJwt(
  userId: string,
  nowSeconds = Math.floor(Date.now() / 1000),
): { jwt: string; expiresAt: number } {
  const expiresAt = nowSeconds + 60 * 60
  const unsigned = `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode({
    sub: userId,
    role: 'authenticated',
    iat: nowSeconds,
    exp: expiresAt,
  })}`
  const signature = createHmac('sha256', LOCAL_SUPABASE.jwtSecret)
    .update(unsigned)
    .digest('base64url')
  return { jwt: `${unsigned}.${signature}`, expiresAt }
}
