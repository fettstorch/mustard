import type {
  NativeNotificationDelivery,
  NativeNotificationPayload,
} from './NativeNotificationDelivery'
// Inlined by WXT's inlineIcons plugin: Chrome MV3 workers cannot reliably fetch
// extension-URL icons for notifications.create(). Preserve the data URI delivery.
import notifIconUrl from '@/assets/icons/mustard_bottle_smile_48.png'

export class WebExtensionNotificationDelivery implements NativeNotificationDelivery {
  // Firefox drops rapidly successive toasts. Keep its existing per-batch delay.
  readonly createSpacingMs = import.meta.env.FIREFOX ? 500 : 0

  get supported(): boolean {
    return typeof browser.notifications?.create === 'function'
  }

  async create(id: string, payload: NativeNotificationPayload): Promise<void> {
    await browser.notifications.create(id, { type: 'basic', iconUrl: notifIconUrl, ...payload })
  }

  async clear(id: string): Promise<void> {
    await browser.notifications?.clear?.(id)
  }

  onClicked(listener: (id: string) => void): () => void {
    const event = browser.notifications?.onClicked
    event?.addListener(listener)
    return () => event?.removeListener(listener)
  }
}
