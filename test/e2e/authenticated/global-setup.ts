import { getLocalSupabaseStatus, seedAuthE2eData, verifyLocalFunctions } from './local-supabase'

export default async function globalSetup(): Promise<void> {
  const status = getLocalSupabaseStatus()
  await seedAuthE2eData(status)
  await verifyLocalFunctions(status)
}
