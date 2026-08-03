export type PersistenceResult = { error: { message: string } | null }

const MAX_PERSISTENCE_ATTEMPTS = 3

/**
 * Persist an OAuth-session change before reporting an upstream token refresh as
 * successful. ATProto refresh tokens may rotate, so a failed write must not
 * leave the database with a credential the authorization server has revoked.
 */
export async function persistOAuthSession(
  update: () => Promise<PersistenceResult>,
): Promise<void> {
  let lastError: { message: string } | undefined

  for (let attempt = 1; attempt <= MAX_PERSISTENCE_ATTEMPTS; attempt++) {
    const { error } = await update()
    if (!error) return
    lastError = error
  }

  throw new Error(
    `Failed to persist OAuth session after ${MAX_PERSISTENCE_ATTEMPTS} attempts: ${lastError?.message}`,
  )
}
