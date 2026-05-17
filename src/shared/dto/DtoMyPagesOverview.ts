/**
 * Per-page overview for the popup's "My Pages" list.
 *
 * - `pageUrl`: the exact URL where the user has at least one published note.
 * - `unreadCount`: number of unread comment notifications on notes on that page.
 * - `lastNoteAt`: Unix ms timestamp of the most recently updated note on that page.
 */
export type DtoMyPagesOverviewEntry = {
  pageUrl: string
  unreadCount: number
  lastNoteAt: number
}

export type DtoMyPagesOverview = DtoMyPagesOverviewEntry[]
