/**
 * Thrown when the server returns HTTP 429 (rate limit exceeded).
 * The background catches this internal error and returns a serializable
 * `WriteResponse` marker across the extension-messaging boundary.
 */
export class RateLimitError extends Error {
  constructor() {
    super('Rate limit exceeded')
    this.name = 'RateLimitError'
  }
}
