import type { MustardNote } from '@/shared/model/MustardNote'
import { MustardIndex } from '@/shared/model/MustardIndex'
import type { MustardNotesService } from './service/MustardNotesService'
import { MustardNotesServiceLocal } from './service/MustardNotesServiceLocal'
import { MustardNotesServiceRemote } from './service/MustardNotesServiceRemote'

/** Sort notes by date ascending so newest notes render last (on top). */
function sortByCreationDateAsc(notes: MustardNote[]): MustardNote[] {
  return [...notes].sort((a, b) => a.updatedAt.getTime() - b.updatedAt.getTime())
}

// Local service: stores notes in chrome.storage.local (offline, not published)
const localService: MustardNotesService = new MustardNotesServiceLocal()

// Remote service: stores notes on Supabase (published, visible to followers)
const remoteService: MustardNotesService = new MustardNotesServiceRemote()

/**
 * Facade that coordinates local and remote mustard notes services.
 * - Local notes are always available (user's drafts)
 * - Remote notes are available when logged in (followed users' published notes)
 */
export const mustardNotesManager = {
  /**
   * Query notes for a page from all services.
   * @param pageUrl - The page URL to query notes for
   * @param userId - The logged-in user's ID (DID), used for remote service queries
   */
  async queryMustardNotesFor(pageUrl: string, userId?: string): Promise<MustardNote[]> {
    // Always query local notes
    const localNotes = await localService.queryNotes(pageUrl)

    // Query remote notes if user is logged in
    const remoteNotes = userId ? await remoteService.queryNotes(pageUrl, userId) : []

    return sortByCreationDateAsc([...localNotes, ...remoteNotes])
  },

  /**
   * Query only local notes for a page (fast, no network).
   * Used for immediate responses after local operations.
   */
  async queryLocalNotesFor(pageUrl: string): Promise<MustardNote[]> {
    const notes = await localService.queryNotes(pageUrl)
    return sortByCreationDateAsc(notes)
  },

  /**
   * Query the index of pages with notes from all services.
   * @param userId - The logged-in user's ID (DID), used for remote service queries
   */
  async queryMustardIndex(userId?: string): Promise<MustardIndex> {
    // Always get local index
    const localIndex = await localService.queryIndex()

    // Get remote index if user is logged in
    const remoteIndex = userId
      ? await remoteService.queryIndex(userId)
      : new MustardIndex(new Map())

    return localIndex.merge(remoteIndex)
  },

  /**
   * Upsert a note to the appropriate service based on target.
   * - 'local': Store in chrome.storage.local (offline, not published)
   * - 'remote': Publish to server (visible to followers)
   */
  async upsertNote(note: MustardNote, target: 'local' | 'remote'): Promise<void> {
    if (target === 'local') {
      await localService.upsertNote(note)
    } else {
      await remoteService.upsertNote(note)
    }
  },

  /**
   * Delete a note from the appropriate service.
   * @param authorId - The note's author ID ('local' for local notes, DID for remote)
   */
  async deleteNote(noteId: string, pageUrl: string, authorId: string): Promise<void> {
    if (authorId === 'local') {
      await localService.deleteNote(noteId, pageUrl)
    } else {
      await remoteService.deleteNote(noteId, pageUrl)
    }
  },
}
