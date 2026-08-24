import type { MustardNote } from '@/shared/model/MustardNote'
import { MustardIndex } from '@/shared/model/MustardIndex'
import type { MustardNotesService } from './service/MustardNotesService'
import { MustardNotesServiceLocal } from './service/MustardNotesServiceLocal'
import { mustardNotesServiceRemote } from './service/MustardNotesServiceRemote'

/** Sort notes by date ascending so newest notes render last (on top). */
function sortByCreationDateAsc(notes: MustardNote[]): MustardNote[] {
  return [...notes].sort((a, b) => a.updatedAt.getTime() - b.updatedAt.getTime())
}

// Local service: stores notes in chrome.storage.local (offline, not published)
const localService: MustardNotesService = new MustardNotesServiceLocal()

// Remote service: stores notes on Supabase (published, visible to followers).
// Shared singleton (cache lives in module scope) — also exposes repost methods
// concretely, since reposting is inherently a remote-only operation.
const remoteService = mustardNotesServiceRemote

/**
 * Facade that coordinates local and remote mustard notes services.
 * - Local notes are always available (user's drafts)
 * - Remote notes are available when logged in (followed users' published notes)
 */
export const mustardNotesManager = {
  /**
   * Query notes for a page from all services.
   * @param pageUrl - The page URL to query notes for
   * @param userId - The logged-in user's ID (UUID), used for remote service queries
   * @param opts.includeAllAuthors - One-shot "show all notes on this page": fetch
   *   every published note on the page (ignoring the follow graph) instead of the
   *   follow-filtered set. Requires a logged-in user; ignored when logged out.
   */
  async queryMustardNotesFor(
    pageUrl: string,
    userId?: string,
    opts?: { includeAllAuthors?: boolean },
  ): Promise<MustardNote[]> {
    // Always query local notes
    const localNotes = await localService.queryNotes(pageUrl)

    // Query remote notes if user is logged in
    let remoteNotes: MustardNote[] = []
    if (userId) {
      remoteNotes = opts?.includeAllAuthors
        ? await remoteService.queryAllNotesForPage(pageUrl)
        : await remoteService.queryNotes(pageUrl, userId)
    }

    return sortByCreationDateAsc([...localNotes, ...remoteNotes])
  },

  /**
   * Query notes across several pages in one call — the feed path, where every
   * atproto post embedded in the page contributes its canonical key.
   */
  async queryMustardNotesForPages(pageUrls: string[], userId?: string): Promise<MustardNote[]> {
    if (pageUrls.length === 0) return []
    const localNotes = await localService.queryNotesForPages(pageUrls)
    const remoteNotes = userId ? await remoteService.queryNotesForPages(pageUrls, userId) : []
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
   * Fetch specific notes by id, ignoring the follow graph. Two callers:
   * notification deep-link repair, and the Options page's hidden-notes gallery.
   *
   * Checks local storage as well as remote, so an unpublished draft note can be
   * resolved by id too (the gallery needs this; deep-link repair only ever passes
   * remote ids, for which the local lookup simply contributes nothing).
   *
   * Deliberately propagates a remote rejection instead of degrading to the local
   * hits — see `MustardNotesServiceRemote.queryNotesByIds`: repair treats an empty
   * result as proof the note is gone, so a transient failure must not masquerade
   * as "confirmed not found". Callers that prefer partial results over an error
   * (the gallery) catch per page themselves.
   */
  async queryMustardNotesByIds(pageUrl: string, noteIds: string[]): Promise<MustardNote[]> {
    if (noteIds.length === 0) return []

    const wanted = new Set(noteIds)
    const localNotes = (await localService.queryNotes(pageUrl)).filter(
      (note) => note.id && wanted.has(note.id),
    )
    const remoteNotes = await remoteService.queryNotesByIds(pageUrl, noteIds)

    return sortByCreationDateAsc([...localNotes, ...remoteNotes])
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
   *
   * Returns the created/updated note for remote target (carrying the
   * server-generated id) so the caller can merge it without re-querying the
   * index; returns undefined for local (the caller re-reads local notes).
   */
  async upsertNote(
    note: MustardNote,
    target: 'local' | 'remote',
  ): Promise<MustardNote | undefined> {
    if (target === 'local') {
      await localService.upsertNote(note)
      return undefined
    }
    return remoteService.upsertNote(note)
  },

  /**
   * Repost or un-repost a remote note (visibility grant). Remote-only.
   * @param reposterId - The current user's DID
   */
  async setRepost(noteId: string, reposterId: string, reposted: boolean): Promise<void> {
    if (reposted) {
      await remoteService.repostNote(noteId, reposterId)
    } else {
      await remoteService.unrepostNote(noteId, reposterId)
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
