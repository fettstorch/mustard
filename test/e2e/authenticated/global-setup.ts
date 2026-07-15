import {
  cleanupAllE2eUsers,
  getLocalSupabaseStatus,
  seedAllE2eUsers,
  verifyLocalFunctions,
} from './local-supabase'

export default async function globalSetup(): Promise<void> {
  const status = getLocalSupabaseStatus()
  await seedAllE2eUsers(status)
  try {
    await verifyLocalFunctions(status)
  } finally {
    // Individual tests own their deterministic data through the automatic
    // local-Supabase fixture. Leave no suite-scoped rows behind after probing
    // Edge Function readiness.
    await cleanupAllE2eUsers(status)
  }
}
