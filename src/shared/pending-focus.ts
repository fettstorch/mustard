/**
 * Cross-context hand-off for "open this page and focus a note".
 *
 * The popup writes a PendingFocus to `browser.storage.local` right before
 * opening a page in a new tab; the content script on that freshly-loaded page
 * reads it once (one-shot), then expands the relevant comment thread(s) and
 * scrolls the note's anchor into view.
 *
 * `noteId === null` means "no specific note" — the content script falls back to
 * focusing whichever notes on the page currently have unread comments (the
 * "My Mustard Notes" page-row case).
 */
export const PENDING_FOCUS_KEY = 'mustard-pending-focus'

export interface PendingFocus {
  /** Normalized page URL (origin + pathname) the focus applies to. */
  pageUrl: string
  /** The note to focus, or null to focus notes with unread comments. */
  noteId: string | null
}
