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
 * An unread notification of any kind (a mention OR a comment on your note),
 * before actor-profile enrichment. The `type` distinguishes the two so a native
 * browser notification can title itself appropriately. `source` still records
 * whether the snippet came from a note or a comment.
 */
export interface RawNotification extends RawMention {
  type: 'mention' | 'comment'
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
   * pageUrl → unread count across the current user's OWN notes (both comment
   * and mention types). Pages with zero unread are absent. Drives the popup's
   * My Pages overview; always fresh (no index cache involved).
   */
  queryMyUnreadByPage(userId: string): Promise<Record<string, number>>

  /**
   * ALL of the current user's unread notifications — both mentions and comments
   * on their notes — newest first. RLS scopes to the recipient. Drives native
   * browser notifications and the popup's Mentions list (filtered to mentions by
   * the caller), mirroring every event the in-app system tracks.
   */
  getUnreadNotifications(): Promise<RawNotification[]>

  /** Delete a single notification row by id (mention or comment). */
  markNotificationSeen(notificationId: string): Promise<void>
}
