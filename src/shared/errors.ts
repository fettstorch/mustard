/**
 * Thrown when the server returns HTTP 429 (rate limit exceeded).
 * The name is stable across the extension-messaging boundary so callers can
 * branch on `err instanceof RateLimitError` or `err.name === 'RateLimitError'`.
 */
export class RateLimitError extends Error {
  constructor() {
    super('Rate limit exceeded')
    this.name = 'RateLimitError'
  }
}
