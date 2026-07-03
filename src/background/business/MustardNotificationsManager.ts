import type { DtoMyPagesOverview } from '@/shared/dto/DtoMyPagesOverview'
import type { DtoMustardNotification } from '@/shared/dto/DtoMustardMention'
import type { UserProfile } from '@/shared/model/UserProfile'
import { MustardNotificationsServiceRemote } from './service/MustardNotificationsServiceRemote'
import { mustardNotesServiceRemote } from './service/MustardNotesServiceRemote'

const notificationsService = new MustardNotificationsServiceRemote()
const notesService = mustardNotesServiceRemote

/**
 * Facade for unread-notification operations.
 *
 * - Per-note unread counts are fetched directly from the notifications table
 *   (filtered by RLS to the current recipient).
 * - The per-page overview combines the get-index index + latestNoteAtByPage
 *   with unread-per-page queried directly from the notifications table.
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

  /** Acknowledge a single notification (mention or comment) by its id. */
  async markNotificationSeen(notificationId: string): Promise<void> {
    await notificationsService.markNotificationSeen(notificationId)
  },

  /**
   * All of the current user's unread notifications (mentions AND comments on
   * their notes), newest first, with each actor resolved to a profile. Drives
   * both native browser notifications and the popup's Mentions list (filtered to
   * `type === 'mention'` by the caller).
   *
   * Actor ids are opaque Mustard UUIDs (post multi-provider migration), so
   * resolution goes through the caller-supplied resolver (identities → atproto
   * Bluesky / github) rather than a direct DID-based Bluesky lookup.
   */
  async getUnreadNotifications(
    resolveProfiles: (userIds: string[]) => Promise<Record<string, UserProfile | null>>,
  ): Promise<DtoMustardNotification[]> {
    const raw = await notificationsService.getUnreadNotifications()
    const actorIds = [...new Set(raw.map((n) => n.actorId))]
    const profiles = actorIds.length > 0 ? await resolveProfiles(actorIds) : {}

    return raw.map((n) => {
      const profile = profiles[n.actorId] ?? null
      return {
        id: n.id,
        noteId: n.noteId,
        pageUrl: n.pageUrl,
        actorId: n.actorId,
        actorHandle: profile?.handle ?? null,
        actorDisplayName: profile?.displayName ?? null,
        actorAvatarUrl: profile?.avatarUrl ?? null,
        source: n.source,
        snippet: n.snippet,
        createdAt: n.createdAt,
        type: n.type,
      } satisfies DtoMustardNotification
    })
  },

  /**
   * Build the popup's "My Pages" overview. Pages + latest-note timestamps come
   * from the cached get-index data; unread counts come straight from the
   * notifications table so they're fresh even while the index cache is warm.
   *
   * Sort order:
   *   1. Pages with at least one unread come first, sorted by unread count desc.
   *   2. Remaining pages sorted by lastNoteAt desc (most-recent note first).
   *
   * Returns [] when the user isn't logged in or has no notes.
   */
  async queryMyPagesOverview(userId: string): Promise<DtoMyPagesOverview> {
    const [index, latestNoteAtByPage, myUnreadByPage] = await Promise.all([
      notesService.queryIndex(userId),
      notesService.queryMyLatestNoteAtByPage(userId),
      notificationsService.queryMyUnreadByPage(userId),
    ])

    const myPages = index.getPagesForUser(userId)

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
