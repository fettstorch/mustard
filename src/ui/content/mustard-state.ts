import { reactive } from 'vue'
import type { MustardNoteAnchorData } from '@/shared/messaging'
import type { MustardNote } from '@/shared/model/MustardNote'
import type { UserProfile } from '@/shared/model/UserProfile'

export type MustardState = {
  currentUserDid: string | null
  editor: {
    isOpen: boolean
    anchor: MustardNoteAnchorData | null
  }
  notes: MustardNote[]
  /** Note IDs currently being synced (publishing, deleting) - actions should be disabled */
  pendingNoteIds: Record<string, boolean>
  /** Cached profiles for note authors (authorId -> profile) */
  profiles: Record<string, UserProfile | null>
}

export function createMustardState(): MustardState {
  return reactive({
    currentUserDid: null,
    editor: {
      isOpen: false,
      anchor: null,
    },
    notes: [],
    pendingNoteIds: {},
    profiles: {},
  })
}
