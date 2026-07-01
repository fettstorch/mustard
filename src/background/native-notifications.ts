// Native browser (OS) notifications for Mustard.
//
// Owns the dispatch mechanics — throttling, the "already shown" seen-set,
// diffing unread → fresh, creating toasts, and routing a click back to the note
// — so the background service worker only wires in its data sources and calls
// dispatch() on its existing every-page-load / popup-open trigger.
//
// We never poll: dispatch() is meant to ride along on notification-adjacent
// events the app already fires. Default-on; users opt out in the options page.

import type { DtoMustardNotification } from '@/shared/dto/DtoMustardMention'
import { PENDING_FOCUS_KEY, type PendingFocus } from '@/shared/pending-focus'
// Inlined as a base64 data URI by the `inlineIcons` Vite plugin (see
// wxt.config.ts). Chrome's MV3 notifications.create() fails to fetch an
// extension-URL iconUrl from the service worker ("Unable to download all
// specified images"), so we hand it the bytes directly instead.
import notifIconUrl from '@/assets/icons/mustard_bottle_smile_48.png'

// Off only when explicitly `false` (default ON). The options page mirrors this key.
const ENABLED_KEY = 'mustard-browser-notifications-enabled'
// The notification ids we've already toasted, kept in sync with the current
// unread set so acknowledged ones drop out and the list stays bounded.
const NOTIFIED_IDS_KEY = 'mustard-native-notified-ids'
// notificationId → where to deep-link on click (the note's page + the note to
// expand & scroll to), mirroring a popup mention click.
const TARGETS_KEY = 'mustard-native-notif-targets'
// Coalesce bursts (e.g. many tabs reloading) into at most one fetch per window.
const DISPATCH_MIN_INTERVAL_MS = 15_000

type NativeNotifTarget = { pageUrl: string; noteId: string }

interface NativeNotificationsDeps {
  /**
   * The current user's enriched unread notifications, or `null` when there's no
   * usable session yet. `null` (vs `[]`) is deliberate: it skips seeding so a
   * later login doesn't blast the existing backlog as "fresh".
   */
  fetchUnread: () => Promise<DtoMustardNotification[] | null>
  /** Mark a single notification (any type) seen by its id. */
  acknowledge: (notificationId: string) => Promise<void>
}

interface NativeNotifications {
  /**
   * Diff current unread against what's already been shown and toast anything
   * new. Fire-and-forget-safe: self-throttles and guards against re-entrancy.
   */
  dispatch: () => Promise<void>
}

/**
 * Drop the per-session dispatch state (the "already shown" seen-set + click
 * targets). Both keys are global in storage.local while the data behind them is
 * session-scoped, so a logout/account switch must reset them — otherwise the
 * next account's `seen` set is non-empty, its existing unread never gets seeded,
 * and the first dispatch toasts its whole backlog. Clearing makes the next login
 * hit the first-run seed path (no backlog blast). Call on session teardown.
 */
export async function clearNativeNotificationState(): Promise<void> {
  await browser.storage.local.remove([NOTIFIED_IDS_KEY, TARGETS_KEY])
}

/**
 * Create the native-notifications dispatcher and register the toast-click
 * handler. Call once from the background composition root.
 */
export function createNativeNotifications(deps: NativeNotificationsDeps): NativeNotifications {
  let inFlight = false
  let lastDispatchAt = 0

  function actorName(n: DtoMustardNotification): string {
    return n.actorDisplayName || (n.actorHandle ? `@${n.actorHandle}` : 'Someone')
  }

  async function dispatch(): Promise<void> {
    // Absent on some surfaces (e.g. older Firefox MV2); WXT types assume it
    // exists, so guard before touching it.
    if (!browser.notifications?.create) return
    if (inFlight) return
    const now = Date.now()
    if (now - lastDispatchAt < DISPATCH_MIN_INTERVAL_MS) return
    inFlight = true
    lastDispatchAt = now
    try {
      const store = await browser.storage.local.get([ENABLED_KEY, NOTIFIED_IDS_KEY, TARGETS_KEY])
      // Default ON: only an explicit `false` disables it.
      if (store[ENABLED_KEY] === false) return

      const notifications = await deps.fetchUnread()
      if (!notifications) return
      const currentIds = notifications.map((n) => n.id)

      // First run (key never written): seed the "already shown" set without
      // toasting, so enabling the feature never blasts a backlog of old unread.
      const seen = store[NOTIFIED_IDS_KEY] as string[] | undefined
      if (seen === undefined) {
        await browser.storage.local.set({ [NOTIFIED_IDS_KEY]: currentIds })
        return
      }

      const seenSet = new Set(seen)
      const fresh = notifications.filter((n) => !seenSet.has(n.id))
      const targets = { ...((store[TARGETS_KEY] as Record<string, NativeNotifTarget>) ?? {}) }
      const fired = new Set<string>()

      for (const n of fresh) {
        const title =
          n.type === 'mention'
            ? `${actorName(n)} mentioned you`
            : `${actorName(n)} commented on your note`
        try {
          await browser.notifications.create(n.id, {
            type: 'basic',
            iconUrl: notifIconUrl,
            title,
            message: n.snippet || '',
          })
          targets[n.id] = { pageUrl: n.pageUrl, noteId: n.noteId }
          fired.add(n.id)
        } catch (err) {
          // Leave it OUT of the seen set so the next dispatch retries it —
          // never record a toast we failed to actually show.
          console.warn('mustard [native-notif] create failed:', err)
        }
      }

      // Persist the seen set as the currently-unread ids we've actually shown:
      // ones already seen, plus ones just fired. Acknowledged ids drop out (set
      // stays bounded); ids that failed to toast are excluded so they retry.
      const nextSeen = currentIds.filter((id) => seenSet.has(id) || fired.has(id))
      const nextTargets: Record<string, NativeNotifTarget> = {}
      for (const id of nextSeen) if (targets[id]) nextTargets[id] = targets[id]
      await browser.storage.local.set({
        [NOTIFIED_IDS_KEY]: nextSeen,
        [TARGETS_KEY]: nextTargets,
      })
    } catch (err) {
      console.debug('mustard [native-notif] dispatch failed:', err)
    } finally {
      inFlight = false
    }
  }

  // Clicking a toast acknowledges that exact notification (its id IS the DB
  // notification id) and deep-links to the note — same as pressing its row in
  // the popup. We stash a PendingFocus before opening a fresh tab so that page's
  // content script expands the thread and scrolls the note into view on load.
  browser.notifications?.onClicked?.addListener(async (notificationId) => {
    try {
      void deps.acknowledge(notificationId).catch(() => {})

      const store = await browser.storage.local.get(TARGETS_KEY)
      const targets = (store[TARGETS_KEY] as Record<string, NativeNotifTarget>) ?? {}
      const target = targets[notificationId]
      browser.notifications?.clear?.(notificationId)
      if (!target) return
      const focus: PendingFocus = { pageUrl: target.pageUrl, noteId: target.noteId }
      await browser.storage.local.set({ [PENDING_FOCUS_KEY]: focus }).catch(() => {})
      await browser.tabs.create({ url: target.pageUrl, active: true })
    } catch (err) {
      console.debug('mustard [native-notif] click failed:', err)
    }
  })

  return { dispatch }
}
