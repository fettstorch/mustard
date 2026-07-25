/**
 * Per-page overview for the popup's "Notes & Threads" list.
 *
 * - `pageUrl`: a URL where the user published a note or has unread thread activity.
 * - `unreadCount`: number of unread comment notifications on that page.
 * - `lastNoteAt`: Unix ms timestamp of the user's most recently updated note
 *   there, or 0 for an unread joined-thread-only page.
 */
export type DtoMyPagesOverviewEntry = {
  pageUrl: string
  unreadCount: number
  lastNoteAt: number
}

export type DtoMyPagesOverview = DtoMyPagesOverviewEntry[]
