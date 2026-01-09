import type { MustardIndex } from '@/shared/model/MustardIndex'
import type { MustardNote } from '@/shared/model/MustardNote'

export interface MustardNotesService {
  /** Returns index of pages with notes for the user's follows (including self) */
  queryIndex(userId: string): Promise<MustardIndex>

  /** Returns notes on a page from the user's follows (including self) */
  queryNotes(pageUrl: string, userId: string): Promise<MustardNote[]>

  upsertNote(note: MustardNote): Promise<void>
  deleteNote(noteId: string, pageUrl: string): Promise<void>
}
