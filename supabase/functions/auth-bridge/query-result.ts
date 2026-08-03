/**
 * Return query data after checking that the query itself succeeded.
 *
 * A failed lookup must remain a transient server error. Treating it as empty
 * data incorrectly tells the client that its account no longer exists.
 */
export function requireQueryData<T>(result: { data: T | null; error: { message: string } | null }): T {
  if (result.error) throw new Error(`oauth_session lookup failed: ${result.error.message}`)
  return result.data as T
}
