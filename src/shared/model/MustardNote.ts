import type { MustardNoteAnchorData } from './MustardNoteAnchorData'

export type MustardNote = {
  id: string | null // null means the note is not yet saved (either local or remote)
  authorId: string
  content: string
  anchorData: MustardNoteAnchorData
  updatedAt: Date
  /**
   * DIDs of users (the current user + people they follow) who reposted this note.
   * A repost is a visibility grant — it's why this note may be shown even when
   * the viewer doesn't follow the author. Always [] for local notes and for
   * notes with no in-network reposters. Rendered as an avatar stack.
   */
  reposterIds: string[]
}
