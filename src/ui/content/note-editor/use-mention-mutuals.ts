import { onMounted, ref } from 'vue'
import { createGetMutualsMessage, sendMessage } from '@/shared/messaging'
import type { BskyProfile } from '@/shared/model/BskyProfile'

/**
 * Loads the current user's mutuals (people they follow who follow them back)
 * once on mount, to power the @-mention autocomplete. The returned ref is read
 * lazily by the mention suggestion on each keystroke, so it can start empty and
 * fill in when the background responds.
 */
export function useMentionMutuals() {
  const mutuals = ref<BskyProfile[]>([])

  onMounted(() => {
    sendMessage(createGetMutualsMessage())
      .then((list) => {
        mutuals.value = list ?? []
      })
      .catch(() => {})
  })

  return { mutuals }
}
