import type { MustardNoteAnchorData } from '../messaging'

export type MustardNote = {
  id: string | null // null means the note is not yet saved (either local or remote)
  authorId: string
  content: string
  anchorData: MustardNoteAnchorData
  updatedAt: Date
}
