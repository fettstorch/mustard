import type { MustardIndex } from '@/shared/model/MustardIndex'
import type { MustardNote } from '@/shared/model/MustardNote'

export interface MustardNotesService {
  /**
   * Returns index of pages with notes.
   * - Local: returns all local notes (userId ignored)
   * - Remote: returns notes from userId's follows
   */
  queryIndex(userId?: string): Promise<MustardIndex>

  /**
   * Returns notes on a page.
   * - Local: returns all local notes for the page (userId ignored)
   * - Remote: returns notes from userId's follows for the page
   */
  queryNotes(pageUrl: string, userId?: string): Promise<MustardNote[]>

  upsertNote(note: MustardNote): Promise<void>
  deleteNote(noteId: string, pageUrl: string): Promise<void>
}
