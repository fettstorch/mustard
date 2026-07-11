import { getLocalSupabaseStatus, seedAllE2eUsers, verifyLocalFunctions } from './local-supabase'

export default async function globalSetup(): Promise<void> {
  const status = getLocalSupabaseStatus()
  await seedAllE2eUsers(status)
  await verifyLocalFunctions(status)
}
