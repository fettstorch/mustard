import type { DtoMyPagesOverview } from '@/shared/dto/DtoMyPagesOverview'
import { MustardNotificationsServiceRemote } from './service/MustardNotificationsServiceRemote'
import { mustardNotesServiceRemote } from './service/MustardNotesServiceRemote'

const notificationsService = new MustardNotificationsServiceRemote()
const notesService = mustardNotesServiceRemote

/**
 * Facade for unread-notification operations.
 *
 * - Per-note unread counts are fetched directly from the notifications table
 *   (filtered by RLS to the current recipient).
 * - The per-page overview reuses the existing get-index response (extended
 *   with `myUnreadByPage` + `latestNoteAtByPage`).
 */
export const mustardNotificationsManager = {
  /** Returns Map<noteId, unreadCount>. Notes with zero unread are absent. */
  async queryUnreadCountsForNotes(noteIds: string[]): Promise<Map<string, number>> {
    return notificationsService.queryUnreadCountsForNotes(noteIds)
  },

  /** Delete all unread notifications on this note for the current user. */
  async markSeenForNote(noteId: string): Promise<void> {
    await notificationsService.markSeenForNote(noteId)
  },

  /** Total unread count for the badge. Returns 0 when the table is empty or the call fails. */
  async getTotalUnreadCount(): Promise<number> {
    try {
      return await notificationsService.getTotalUnreadCount()
    } catch (error) {
      console.error('Failed to count notifications:', error)
      return 0
    }
  },

  /**
   * Build the popup's "My Pages" overview from cached get-index data.
   *
   * Sort order:
   *   1. Pages with at least one unread come first, sorted by unread count desc.
   *   2. Remaining pages sorted by lastNoteAt desc (most-recent note first).
   *
   * Returns [] when the user isn't logged in or has no notes.
   */
  async queryMyPagesOverview(userId: string): Promise<DtoMyPagesOverview> {
    const [index, overview] = await Promise.all([
      notesService.queryIndex(userId),
      notesService.queryMyOverviewData(userId),
    ])

    const myPages = index.getPagesForUser(userId)
    const { myUnreadByPage, latestNoteAtByPage } = overview

    const entries = myPages.map((pageUrl) => ({
      pageUrl,
      unreadCount: myUnreadByPage[pageUrl] ?? 0,
      lastNoteAt: latestNoteAtByPage[pageUrl] ?? 0,
    }))

    entries.sort((a, b) => {
      const aHasUnread = a.unreadCount > 0
      const bHasUnread = b.unreadCount > 0
      if (aHasUnread !== bHasUnread) return aHasUnread ? -1 : 1
      if (aHasUnread && bHasUnread && a.unreadCount !== b.unreadCount) {
        return b.unreadCount - a.unreadCount
      }
      return b.lastNoteAt - a.lastNoteAt
    })

    return entries
  },
}
