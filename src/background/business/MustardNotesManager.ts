import type { MustardNote } from '@/shared/model/MustardNote'
import { MustardIndex } from '@/shared/model/MustardIndex'
import type { MustardNotesService } from './service/MustardNotesService'
import { MustardNotesServiceLocal } from './service/MustardNotesServiceLocal'
// import { MustardNotesServiceRemote } from './service/MustardNotesServiceRemote'

// Local service: stores notes in chrome.storage.local (offline, not published)
const localService: MustardNotesService = new MustardNotesServiceLocal()

// Remote service: stores notes on the server (published, visible to followers)
// TODO: Implement MustardNotesServiceRemote
const remoteService: MustardNotesService | null = null // new MustardNotesServiceRemote()

// All services to query from (both local drafts and published notes)
const allServices: MustardNotesService[] = [localService, ...(remoteService ? [remoteService] : [])]

const myself = 'local' // TODO: Pass userId from service worker based on session

export const mustardNotesManager = {
  async queryMustardNotesFor(pageUrl: string): Promise<MustardNote[]> {
    // Query all services and merge results (local + remote notes)
    const results = await Promise.all(allServices.map((s) => s.queryNotes(pageUrl, myself)))
    return results.flat()
  },

  async queryMustardIndex(): Promise<MustardIndex> {
    return (await Promise.all(allServices.map((s) => s.queryIndex(myself)))).reduce(
      (acc, index) => acc.merge(index),
      new MustardIndex(new Map()),
    )
  },

  /**
   * Upsert a note to the appropriate service based on target.
   * - 'local': Store in chrome.storage.local (offline, not published)
   * - 'remote': Publish to server (visible to followers)
   */
  async upsertNote(note: MustardNote, target: 'local' | 'remote'): Promise<void> {
    if (target === 'remote') {
      // TODO: When remoteService is implemented, uncomment:
      // await remoteService.upsertNote(note)
      // For now, fall back to local with a warning
      if (!remoteService) {
        console.warn('Remote service not implemented yet, falling back to local')
      }
      await localService.upsertNote(note)
    } else {
      await localService.upsertNote(note)
    }
  },

  /**
   * Delete a note from the appropriate service.
   * TODO: Determine which service the note belongs to (by noteId prefix or lookup)
   */
  async deleteNote(noteId: string, pageUrl: string): Promise<void> {
    // For now, try deleting from all services
    await Promise.all(allServices.map((s) => s.deleteNote(noteId, pageUrl)))
  },
}
