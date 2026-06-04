import { PENDING_FOCUS_KEY, type PendingFocus } from '@/shared/pending-focus'

/**
 * Open a page in a new tab with a focus target, then close the popup.
 *
 * The focus is written to storage *before* the tab is created so the new page's
 * content script can read it on load and expand/scroll to the relevant note.
 * `noteId === null` focuses whichever notes have unread comments.
 */
export async function openPageFocused(pageUrl: string, noteId: string | null): Promise<void> {
  const focus: PendingFocus = { pageUrl, noteId }
  await browser.storage.local.set({ [PENDING_FOCUS_KEY]: focus }).catch(() => {})
  await browser.tabs.create({ url: pageUrl, active: true }).catch(() => {})
  window.close()
}
