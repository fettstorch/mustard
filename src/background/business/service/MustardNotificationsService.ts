/**
 * A single unread @-mention, before actor-profile enrichment. The background
 * resolves `actorId` to a profile and maps this to a DtoMustardMention.
 */
export interface RawMention {
  /** notifications.id */
  id: string
  noteId: string
  pageUrl: string
  actorId: string
  source: 'note' | 'comment'
  /** Short, plain-text-ish preview of the source note/comment content. */
  snippet: string
  /** Unix ms */
  createdAt: number
}

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

  /**
   * The current user's unread @-mention notifications (in notes or comments),
   * newest first. RLS scopes to the recipient.
   */
  getMyMentions(): Promise<RawMention[]>

  /** Delete a single notification row by id (acknowledge one mention). */
  markMentionSeen(notificationId: string): Promise<void>
}
