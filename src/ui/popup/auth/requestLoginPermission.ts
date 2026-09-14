import { usesTabLogin } from '@/shared/browser-capabilities'
import { TAB_CALLBACK_URI } from '@/shared/oauth-login'

/** Called directly from the sign-in click/submit, before any other await. */
export async function requestLoginPermission(): Promise<void> {
  if (!usesTabLogin()) return
  const allowed = await browser.permissions.request({
    origins: [
      `${new URL(TAB_CALLBACK_URI).origin}/*`,
      `${new URL(import.meta.env.VITE_SUPABASE_URL).origin}/*`,
    ],
  })
  if (!allowed) throw new Error('Allow website access for Mustard to finish signing in.')
}
