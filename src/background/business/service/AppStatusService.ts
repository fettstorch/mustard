// Client-version guard (background-owned). The extension's own manifest version
// is the "client version" — it's uniform across popup/content/background — and
// the minimum supported version comes from the server (`app_config`). The popup
// and content scripts ask the background for this via GET_APP_STATUS; the
// background also uses it to refuse remote writes from an outdated client.

import { supabase } from '@/background/supabase-client'
import { isOutdated } from '@/shared/version'

type AppStatus = {
  currentVersion: string
  minVersion: string
  outdated: boolean
}

const CACHE_TTL_MS = 30 * 60 // * 1000
let cached: { minVersion: string; at: number } | null = null

function currentVersion(): string {
  try {
    return browser.runtime.getManifest().version
  } catch {
    return '0.0.0'
  }
}

async function fetchMinVersion(): Promise<string> {
  const now = Date.now()
  if (cached && now - cached.at < CACHE_TTL_MS) return cached.minVersion

  try {
    const { data, error } = await supabase
      .from('app_config')
      .select('min_client_version')
      .eq('id', 1)
      .maybeSingle()
    if (error) throw error
    const min = (data as { min_client_version?: string } | null)?.min_client_version ?? '0.0.0'
    cached = { minVersion: min, at: now }
    return min
  } catch (err) {
    // Fail OPEN: a transient fetch failure must never lock a user out. Reuse the
    // last known value, or assume compatible ('0.0.0') if we never fetched one.
    console.debug('mustard [app-status] min-version fetch failed, assuming compatible:', err)
    return cached?.minVersion ?? '0.0.0'
  }
}

export async function getAppStatus(): Promise<AppStatus> {
  const current = currentVersion()
  const min = await fetchMinVersion()
  return { currentVersion: current, minVersion: min, outdated: isOutdated(current, min) }
}

/** True when this client is too old to safely perform remote writes. */
export async function isClientOutdated(): Promise<boolean> {
  return (await getAppStatus()).outdated
}

// ─── "Update now" trigger ─────────────────────────────────────────────────────

// Chrome Web Store listing (id pinned in wxt.config.ts). The old /webstore/
// detail-by-id URL reliably redirects to the current listing.
const CHROME_STORE_URL =
  'https://chrome.google.com/webstore/detail/mmdodhbelecgangbkloiaoohdinhkpcj'
// Firefox has no programmatic update lever (no requestUpdateCheck, can't open
// about:addons), so the click just opens the AMO listing.
const FIREFOX_STORE_URL: string | null = 'https://addons.mozilla.org/firefox/addon/mustard-notes/'

let updateApplyListenerRegistered = false
function ensureUpdateApplyListener(): void {
  if (updateApplyListenerRegistered) return
  updateApplyListenerRegistered = true
  // Apply the update by reloading once Chrome has downloaded it. Registered only
  // after the user opts in (clicks "update"), so we never silently reload the
  // extension out from under an unrelated background update.
  browser.runtime.onUpdateAvailable?.addListener(() => browser.runtime.reload())
}

async function openStoreListing(): Promise<void> {
  const url = import.meta.env.FIREFOX ? FIREFOX_STORE_URL : CHROME_STORE_URL
  if (!url) return
  try {
    await browser.tabs.create({ url })
  } catch (err) {
    console.debug('mustard [app-status] open store listing failed:', err)
  }
}

/**
 * Best-effort "update now". On Chrome: ask the Web Store for a newer version and
 * apply it via reload() as soon as it's downloaded (falling back to the listing
 * if none is pending or the check is throttled). Elsewhere: open the store
 * listing if configured. There is no cross-browser "force update" — this just
 * shrinks the window where possible.
 */
export async function requestClientUpdate(): Promise<void> {
  const runtime = browser.runtime as typeof browser.runtime & {
    requestUpdateCheck?: () => Promise<{ status?: string }>
  }

  if (!import.meta.env.FIREFOX && typeof runtime.requestUpdateCheck === 'function') {
    ensureUpdateApplyListener()
    try {
      const result = await runtime.requestUpdateCheck()
      if (result?.status === 'update_available') {
        browser.runtime.reload()
        return
      }
    } catch (err) {
      console.debug('mustard [app-status] requestUpdateCheck failed:', err)
    }
  }

  await openStoreListing()
}
