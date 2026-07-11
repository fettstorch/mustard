import { cleanupAuthE2eData } from './local-supabase'

export default async function globalTeardown(): Promise<void> {
  await cleanupAuthE2eData()
}
