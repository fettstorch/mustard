import type { MustardNote } from '@/shared/model/MustardNote'
import { MustardIndex } from '@/shared/model/MustardIndex'
import type { MustardNotesService } from './service/MustardNotesService'
import { MustardNotesServiceLocal } from './service/MustardNotesServiceLocal'
// import { MustardNotesServiceRemote } from './service/MustardNotesServiceRemote'

// Local service: stores notes in chrome.storage.local (offline, not published)
const localService: MustardNotesService = new MustardNotesServiceLocal()

// Remote service: stores notes on the server (published, visible to followers)
// TODO: Implement MustardNotesServiceRemote and set this to an instance
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const remoteService: MustardNotesService | null = null

/**
 * Facade that coordinates local and remote mustard notes services.
 * - Local notes are always available (user's drafts)
 * - Remote notes are available when logged in (followed users' published notes)
 */
export const mustardNotesManager = {
  /**
   * Query notes for a page from all services.
   * @param pageUrl - The page URL to query notes for
   * @param _userId - The logged-in user's ID (DID), used for remote service queries (unused until remote is implemented)
   */
  async queryMustardNotesFor(pageUrl: string, _userId?: string): Promise<MustardNote[]> {
    // Always query local notes
    const localNotes = await localService.queryNotes(pageUrl)

    // TODO: When remote service is implemented, also query remote notes:
    // const remoteNotes = remoteService && _userId
    //   ? await remoteService.queryNotes(pageUrl, _userId)
    //   : []
    // return [...localNotes, ...remoteNotes]

    return localNotes
  },

  /**
   * Query the index of pages with notes from all services.
   * @param _userId - The logged-in user's ID (DID), used for remote service queries (unused until remote is implemented)
   */
  async queryMustardIndex(_userId?: string): Promise<MustardIndex> {
    // Always get local index
    const localIndex = await localService.queryIndex()

    // TODO: When remote service is implemented, also get remote index:
    // const remoteIndex = remoteService && _userId
    //   ? await remoteService.queryIndex(_userId)
    //   : new MustardIndex(new Map())
    // return localIndex.merge(remoteIndex)

    return localIndex
  },

  /**
   * Upsert a note to the appropriate service based on target.
   * - 'local': Store in chrome.storage.local (offline, not published)
   * - 'remote': Publish to server (visible to followers)
   */
  async upsertNote(note: MustardNote, target: 'local' | 'remote'): Promise<void> {
    if (target === 'local') {
      await localService.upsertNote(note)
    } else if (target === 'remote') {
      // target === 'remote'
      // TODO: When remoteService is implemented, call remoteService.upsertNote(note)
      console.warn('Remote service not implemented yet - note not saved')
    }
  },

  /**
   * Delete a note from the appropriate service.
   * TODO: Determine which service the note belongs to (by noteId prefix or lookup)
   */
  async deleteNote(noteId: string, pageUrl: string): Promise<void> {
    // For now, delete from local (all local notes have authorId='local')
    // TODO: When remote is implemented, determine which service owns the note
    await localService.deleteNote(noteId, pageUrl)
    // if (remoteService) await remoteService.deleteNote(noteId, pageUrl)
  },
}
