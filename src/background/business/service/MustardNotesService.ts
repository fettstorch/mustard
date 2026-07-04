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

  /** Returns the created/updated note when the service can (remote); void otherwise (local). */
  upsertNote(note: MustardNote): Promise<MustardNote | void>
  deleteNote(noteId: string, pageUrl: string): Promise<void>
}
