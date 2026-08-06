export const REFRESH_TOKEN_CLIENT_VERSION = '2.9.0'

/** Numeric extension-version comparison for compatibility routing only. */
export function isClientVersionAtLeast(current: string | undefined, minimum: string): boolean {
  if (!current || !/^\d+(\.\d+)*$/.test(current)) return false
  const currentParts = current.split('.').map(Number)
  const minimumParts = minimum.split('.').map(Number)
  const length = Math.max(currentParts.length, minimumParts.length)
  for (let index = 0; index < length; index++) {
    const difference = (currentParts[index] ?? 0) - (minimumParts[index] ?? 0)
    if (difference !== 0) return difference > 0
  }
  return true
}

/** Whether this caller can receive and retain a Mustard refresh token. */
export function shouldMintRefreshSession(
  clientVersion: string | undefined,
  supersededSessionId?: string | null,
): boolean {
  // A sid-backed JWT can only have come from a v2.9+ client. Do not let a
  // callback-provided clientVersion downgrade that live session into a sid-less
  // JWT, which would bypass server-side revocation for the JWT's remaining TTL.
  return Boolean(supersededSessionId) || isClientVersionAtLeast(clientVersion, REFRESH_TOKEN_CLIENT_VERSION)
}
