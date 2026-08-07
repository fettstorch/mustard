// Confidential-client authentication (RFC 7523 `private_key_jwt`) for the
// AT Protocol OAuth profile. auth-bridge is registered as a confidential
// client (docs/client-metadata.json declares `token_endpoint_auth_method:
// "private_key_jwt"` + a `jwks` entry); every PAR, token-exchange, and
// refresh request to an AT Protocol Authorization Server must carry a
// client assertion signed with the matching private key, per
// https://atproto.com/specs/oauth#confidential-client.
//
// This is distinct from DPoP: DPoP proves possession of a per-session key,
// while the client assertion proves *auth-bridge itself* (the client, not the
// session) — the same key is reused across every user's session.

import * as jose from 'https://deno.land/x/jose@v5.2.0/index.ts'

const CLIENT_ASSERTION_TYPE = 'urn:ietf:params:oauth:client-assertion-type:jwt-bearer'
const ASSERTION_TTL_SECONDS = 60

let cachedKey: { jwk: jose.JWK; key: CryptoKey } | null = null

/**
 * Load + cache the confidential client's private key (module-scope: reused
 * across requests within one edge-function instance). The corresponding
 * public half must be published in docs/client-metadata.json's `jwks`
 * (matched by `kid`) — see supabase/functions/.env.example for how the pair
 * is generated and rotated.
 */
async function loadPrivateKey(): Promise<{ jwk: jose.JWK; key: CryptoKey }> {
  if (cachedKey) return cachedKey

  const raw = Deno.env.get('ATPROTO_CLIENT_PRIVATE_JWK')
  if (!raw) {
    throw new Error(
      'ATPROTO_CLIENT_PRIVATE_JWK not configured — required for confidential-client atproto OAuth calls (PAR/token/refresh)',
    )
  }

  const jwk: jose.JWK = JSON.parse(raw)
  const key = (await jose.importJWK(jwk, 'ES256')) as CryptoKey
  cachedKey = { jwk, key }
  return cachedKey
}

/**
 * Build a `client_assertion` JWT proving auth-bridge's identity to an AT
 * Protocol Authorization Server. `audience` must be the AS's `issuer` (not
 * the token/PAR endpoint URL — the spec is explicit that `aud` is the
 * issuer).
 */
export async function createClientAssertion(clientId: string, audience: string): Promise<string> {
  const { jwk, key } = await loadPrivateKey()
  const now = Math.floor(Date.now() / 1000)

  return new jose.SignJWT({
    iss: clientId,
    sub: clientId,
    aud: audience,
    jti: crypto.randomUUID(),
    iat: now,
    exp: now + ASSERTION_TTL_SECONDS,
  })
    .setProtectedHeader({ alg: 'ES256', kid: jwk.kid })
    .sign(key)
}

/** `{ client_assertion_type, client_assertion }` form fields for a confidential-client AS request. */
export async function clientAssertionFormFields(
  clientId: string,
  audience: string,
): Promise<{ client_assertion_type: string; client_assertion: string }> {
  return {
    client_assertion_type: CLIENT_ASSERTION_TYPE,
    client_assertion: await createClientAssertion(clientId, audience),
  }
}
