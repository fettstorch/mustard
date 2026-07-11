import { cleanupAllE2eUsers } from './local-supabase'

export default async function globalTeardown(): Promise<void> {
  await cleanupAllE2eUsers()
}
