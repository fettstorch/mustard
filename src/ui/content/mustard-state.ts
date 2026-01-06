import { reactive } from 'vue'
import type { MustardNoteAnchorData } from '@/shared/messaging'

export type MustardState = {
  editor: {
    isOpen: boolean
    anchor: MustardNoteAnchorData | null
  }
}

export function createMustardState(): MustardState {
  return reactive({
    editor: {
      isOpen: false,
      anchor: null,
    },
  })
}
