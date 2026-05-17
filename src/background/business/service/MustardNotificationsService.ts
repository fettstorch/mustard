/**
 * Service for "unread comment notifications" on the current user's notes.
 *
 * The notifications table only stores unread rows — there is no "read" column.
 * Marking a notification as seen == deleting the row.
 */
export interface MustardNotificationsService {
  /**
   * Returns a map of noteId → unread-count for the given note ids,
   * scoped to the current logged-in user (the recipient).
   * Notes with zero unread are omitted from the map.
   */
  queryUnreadCountsForNotes(noteIds: string[]): Promise<Map<string, number>>

  /**
   * Delete all unread notifications for the given note for the current user.
   * RLS enforces that the caller can only delete notifications they own.
   */
  markSeenForNote(noteId: string): Promise<void>

  /**
   * Total unread count for the current logged-in user (used for the badge).
   */
  getTotalUnreadCount(): Promise<number>
}
