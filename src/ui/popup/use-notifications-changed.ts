import { onMounted, onUnmounted } from 'vue'
import type { Message } from '@/shared/messaging'

/**
 * Runs `refresh` whenever the background broadcasts `NOTIFICATIONS_CHANGED`
 * (mark-seen, new fetch with deltas). Registers the listener on mount and tears
 * it down on unmount. Shared by the popup sections that mirror notification
 * state (My Pages, Mentions).
 */
export function useNotificationsChanged(refresh: () => void): void {
  function onMessage(message: Message) {
    if (message?.type === 'NOTIFICATIONS_CHANGED') refresh()
  }

  onMounted(() => browser.runtime.onMessage.addListener(onMessage))
  onUnmounted(() => browser.runtime.onMessage.removeListener(onMessage))
}
