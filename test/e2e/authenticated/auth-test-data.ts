import { createHmac } from 'node:crypto'

export const AUTH_E2E_USER = {
  userId: '11111111-1111-4111-8111-111111111111',
  identity: {
    provider: 'github' as const,
    providerAccountId: '999999999',
    handle: 'mustard-e2e',
  },
}

export const LOCAL_SUPABASE = {
  apiUrl: 'http://127.0.0.1:54321',
  anonKey:
    'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0',
  jwtSecret: 'super-secret-jwt-token-with-at-least-32-characters-long',
}

function encode(value: object): string {
  return Buffer.from(JSON.stringify(value)).toString('base64url')
}

export function createAuthE2eJwt(nowSeconds = Math.floor(Date.now() / 1000)): {
  jwt: string
  expiresAt: number
} {
  const expiresAt = nowSeconds + 60 * 60
  const unsigned = `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode({
    sub: AUTH_E2E_USER.userId,
    role: 'authenticated',
    iat: nowSeconds,
    exp: expiresAt,
  })}`
  const signature = createHmac('sha256', LOCAL_SUPABASE.jwtSecret)
    .update(unsigned)
    .digest('base64url')

  return { jwt: `${unsigned}.${signature}`, expiresAt }
}
