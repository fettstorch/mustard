import { createOpenDeepLinkMessage, sendMessage } from '@/shared/messaging'

/**
 * Ask the background to open a page focused on a note, then close the popup.
 * All mechanics live in the background's openDeepLink (shared with the
 * native-notification click path); `noteId === null` focuses whichever notes
 * have unread comments. The send is awaited (best-effort) so the focus target
 * is persisted before the popup tears down.
 */
export async function openPageFocused(pageUrl: string, noteId: string | null): Promise<void> {
  await sendMessage(createOpenDeepLinkMessage(pageUrl, noteId)).catch(() => {})
  window.close()
}
