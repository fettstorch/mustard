import { expect, test as base } from '@playwright/test'
import { cleanupAllE2eUsers, getLocalSupabaseStatus, seedAllE2eUsers } from './local-supabase'

type LocalSupabaseFixtures = {
  isolatedLocalSupabase: void
}

/**
 * Give every test a fresh copy of the deterministic Supabase accounts.
 *
 * Browser contexts are already isolated by Playwright, but the local database
 * is shared by the whole worker. Keeping setup and teardown in an automatic
 * test-scoped fixture prevents notes, follows, and notifications from leaking
 * into later tests, including when an assertion fails.
 */
export const test = base.extend<LocalSupabaseFixtures>({
  isolatedLocalSupabase: [
    async ({}, use) => {
      const status = getLocalSupabaseStatus()
      await seedAllE2eUsers(status)
      try {
        await use()
      } finally {
        await cleanupAllE2eUsers(status)
      }
    },
    { auto: true },
  ],
})

export { expect }
