import {
  createOpenNoteEditorMessage,
  broadcastToAllTabs,
  sendMessage,
  sendTabMessage,
  type Message,
  type ResponseFor,
  type QueryCommentsResponse,
  type QueryNotificationsForNotesResponse,
} from '@/shared/messaging'
import { mustardNotesManager } from '@/background/business/MustardNotesManager'
import { mustardCommentsManager } from '@/background/business/MustardCommentsManager'
import { mustardNotificationsManager } from '@/background/business/MustardNotificationsManager'
import { DtoMustardNote } from '@/shared/dto/DtoMustardNote'
import { DtoMustardComment } from '@/shared/dto/DtoMustardComment'
import { login, getSession, logout } from '@/background/auth/AtprotoAuth'
import { clearSupabaseJwt, storeSupabaseJwt } from '@/background/auth/SupabaseAuth'
import { MustardProfileServiceBsky } from '@/background/business/service/MustardProfileServiceBsky'
import { invalidateRemoteIndexCache } from '@/background/business/service/MustardNotesServiceRemote'

export default defineBackground(() => {
  const profileService = new MustardProfileServiceBsky()

  console.log('Mustard background service worker loaded')

  /** Broadcast session change to all tabs so content scripts can update their state */
  async function broadcastSessionChanged(did: string | null) {
    await broadcastToAllTabs({ type: 'SESSION_CHANGED', did })
  }

  /** Broadcast that the unread-notifications state changed. Popup re-queries; content scripts can refresh in-page dots. */
  async function broadcastNotificationsChanged() {
    await broadcastToAllTabs({ type: 'NOTIFICATIONS_CHANGED' })
    // Popup runtime listener is reached via runtime.sendMessage (not tab-scoped).
    sendMessage({ type: 'NOTIFICATIONS_CHANGED' }).catch(() => {})
  }

  /**
   * Shared cleanup after a mutation that can change THIS user's unread
   * notifications (remote note/comment deletion cascades, mark-seen): drop the
   * stale index cache, refresh the toolbar badge, and tell the popup + content
   * scripts. Fire-and-forget — callers don't need to await the fan-out.
   */
  function afterNotificationMutation(): void {
    invalidateRemoteIndexCache()
    void updateActionBadge()
    void broadcastNotificationsChanged()
  }

  /**
   * Browser-agnostic accessor for the toolbar action API.
   * Chrome MV3 + Firefox MV3 expose `browser.action`; Firefox MV2 only has
   * `browser.browserAction`. WXT's `browser` is a raw global passthrough so
   * we need to fall back ourselves.
   */
  function getActionApi(): {
    setBadgeText: (args: { text: string }) => Promise<void> | void
    setBadgeBackgroundColor: (args: { color: string }) => Promise<void> | void
    openPopup?: () => Promise<void>
  } | null {
    const b = browser as unknown as Record<string, unknown>
    return (
      (b.action as ReturnType<typeof getActionApi>) ??
      (b.browserAction as ReturnType<typeof getActionApi>) ??
      null
    )
  }

  /** Update the extension-icon badge with the current user's unread total. */
  async function updateActionBadge(): Promise<void> {
    const action = getActionApi()
    if (!action) return
    try {
      const session = await getSession()
      if (!session) {
        await action.setBadgeText({ text: '' })
        return
      }
      const count = await mustardNotificationsManager.getTotalUnreadCount()
      await action.setBadgeText({ text: count > 0 ? String(count) : '' })
      // Mustard accent for visibility; safe in both Chrome and Firefox.
      try {
        await action.setBadgeBackgroundColor({ color: '#d32f2f' })
      } catch {
        // Firefox MV2 historically required a different signature on older
        // versions; ignore failures so we never crash the badge update.
      }
    } catch (err) {
      console.debug('mustard [service-worker] updateActionBadge failed:', err)
    }
  }

  // Register the context-menu entry on every background wake-up, not just on
  // install. Firefox MV3 (bug 1771328, fixed only in Fx128) drops MV3 menu
  // entries on browser restart when they're created solely in onInstalled,
  // and disable→re-enable cycles can wipe them on any version. Top-level
  // registration + onStartup re-registration keeps the entry alive across
  // service-worker terminations on both Chrome and Firefox.
  async function ensureContextMenu() {
    try {
      await browser.contextMenus.removeAll()
      browser.contextMenus.create({
        id: 'mustard-add-note',
        title: 'Add Mustard',
        contexts: ['all'],
      })
    } catch (err) {
      console.debug('mustard [service-worker] ensureContextMenu failed:', err)
    }
  }

  browser.runtime.onInstalled.addListener((details) => {
    ensureContextMenu()

    if (details.reason === 'install') {
      browser.tabs.create({ url: 'https://fettstorch.github.io/mustard/' })
    }
  })

  browser.runtime.onStartup.addListener(() => {
    ensureContextMenu()
    updateActionBadge()
  })

  // Initial sync at SW startup (best-effort): re-registers the menu if the
  // browser dropped it, and seeds the badge.
  ensureContextMenu()
  updateActionBadge()

  browser.contextMenus.onClicked.addListener(async (info, tab) => {
    if (info.menuItemId !== 'mustard-add-note' || !tab?.id) return
    try {
      await sendTabMessage(tab.id, createOpenNoteEditorMessage())
    } catch {
      // Content script not available (tab predates extension load, or context was invalidated).
    }
  })

  // Keyboard shortcuts (manifest `commands` field). Toggling storage here
  // automatically fans out to content scripts + popup + options via the
  // existing storage.onChanged listeners — no extra messaging needed.
  const NOTES_MINIMIZED_KEY = 'mustard-notes-minimized'
  browser.commands?.onCommand.addListener(async (command) => {
    if (command === 'toggle-minimize-notes') {
      try {
        const { [NOTES_MINIMIZED_KEY]: current } =
          await browser.storage.local.get(NOTES_MINIMIZED_KEY)
        await browser.storage.local.set({ [NOTES_MINIMIZED_KEY]: !current })
      } catch (err) {
        console.debug('mustard [service-worker] toggle-minimize-notes failed:', err)
      }
    }
  })

  // One async handler per message type the service worker owns. Messages that
  // belong to other contexts (e.g. SESSION_CHANGED → content script) are simply
  // absent and fall through to "no response" in the listener below.
  type MessageHandlers = {
    [K in Message['type']]?: (
      message: Extract<Message, { type: K }>,
    ) => ResponseFor<K> | Promise<ResponseFor<K>>
  }

  const handlers: MessageHandlers = {
    UPSERT_NOTE: async (message) => {
      const session = await getSession()
      const target = message.target
      const pageUrl = message.data.anchorData.pageUrl

      let authorId: string
      if (target === 'local') {
        authorId = 'local'
      } else {
        if (!session) {
          console.error('Cannot publish note - user not logged in')
          return []
        }
        authorId = session.did
      }

      const note = DtoMustardNote.fromDto({
        id: target === 'local' ? crypto.randomUUID() : null,
        authorId,
        content: message.data.content,
        anchorData: message.data.anchorData,
        updatedAt: message.data.updatedAt,
      })

      await mustardNotesManager.upsertNote(note, target)

      if (target === 'local') {
        const localNotes = await mustardNotesManager.queryLocalNotesFor(pageUrl)
        return localNotes.map(DtoMustardNote.toDto)
      }

      invalidateRemoteIndexCache()
      const allNotes = await mustardNotesManager.queryMustardNotesFor(pageUrl, session!.did)

      if (message.localNoteIdToDelete) {
        await mustardNotesManager.deleteNote(message.localNoteIdToDelete, pageUrl, 'local')
        const filteredNotes = allNotes.filter((n) => n.id !== message.localNoteIdToDelete)
        return filteredNotes.map(DtoMustardNote.toDto)
      }

      return allNotes.map(DtoMustardNote.toDto)
    },

    QUERY_NOTES: async (message) => {
      const session = await getSession()
      const notes = await mustardNotesManager.queryMustardNotesFor(message.pageUrl, session?.did)
      return notes.map(DtoMustardNote.toDto)
    },

    DELETE_NOTE: async (message) => {
      await mustardNotesManager.deleteNote(message.noteId, message.pageUrl, message.authorId)

      if (message.authorId === 'local') {
        const localNotes = await mustardNotesManager.queryLocalNotesFor(message.pageUrl)
        return localNotes.map(DtoMustardNote.toDto)
      }

      // Deleting a remote note cascades and may remove comment notifications too.
      afterNotificationMutation()

      const session = await getSession()
      const allNotes = await mustardNotesManager.queryMustardNotesFor(message.pageUrl, session?.did)
      return allNotes.map(DtoMustardNote.toDto)
    },

    SET_REPOST: async (message) => {
      const session = await getSession()
      if (!session) {
        console.error('Cannot repost - user not logged in')
        return []
      }

      await mustardNotesManager.setRepost(message.noteId, session.did, message.reposted)

      // Repost changes visibility → bust the index cache so the next query
      // recomputes reposted note ids / reposter lists.
      invalidateRemoteIndexCache()

      const allNotes = await mustardNotesManager.queryMustardNotesFor(message.pageUrl, session.did)
      return allNotes.map(DtoMustardNote.toDto)
    },

    ATPROTO_LOGIN: async (message) => {
      try {
        const result = await login(message.handle)
        await storeSupabaseJwt(result.jwt, result.expiresAt, result.did)
        invalidateRemoteIndexCache()
        broadcastSessionChanged(result.did)
        updateActionBadge()
        return { did: result.did }
      } catch (err) {
        console.error('ATPROTO_LOGIN failed:', err)
        return null
      }
    },

    GET_ATPROTO_SESSION: async () => {
      try {
        const session = await getSession()
        updateActionBadge()
        return session ? { did: session.did } : null
      } catch (err) {
        console.error('GET_ATPROTO_SESSION failed:', err)
        return null
      }
    },

    ATPROTO_LOGOUT: async (message) => {
      try {
        await logout(message.did)
        await clearSupabaseJwt()
        invalidateRemoteIndexCache()
        broadcastSessionChanged(null)
        updateActionBadge()
        return null
      } catch (err) {
        console.error('ATPROTO_LOGOUT failed:', err)
        return null
      }
    },

    OPEN_POPUP: () => {
      const action = getActionApi()
      action?.openPopup?.()?.catch(() => {})
    },

    GET_PROFILES: async (message) => {
      try {
        return await profileService.getProfiles(message.userIds)
      } catch (err) {
        console.error('GET_PROFILES failed:', err)
        return {}
      }
    },

    QUERY_COMMENTS: async (message) => {
      try {
        const map = await mustardCommentsManager.queryCommentsForNotes(message.noteIds)
        const response: QueryCommentsResponse = {}
        for (const [noteId, comments] of map.entries()) {
          response[noteId] = comments.map(DtoMustardComment.toDto)
        }
        return response
      } catch (err) {
        console.error('QUERY_COMMENTS failed:', err)
        return {}
      }
    },

    UPSERT_COMMENT: async (message) => {
      const session = await getSession()
      if (!session) {
        throw new Error('Cannot create comment - user not logged in')
      }

      await mustardCommentsManager.upsertComment({
        id: '', // not used by the insert path; service ignores empty string
        noteId: message.noteId,
        authorId: session.did,
        content: message.content,
        createdAt: new Date(),
        updatedAt: new Date(),
      })

      // A new comment notifies the note's *author* (not the commenter), so this
      // user's own badge/overview is unaffected — only the cached index needs
      // busting so the author picks it up on their next query.
      invalidateRemoteIndexCache()

      const fresh = await mustardCommentsManager.queryCommentsForNote(message.noteId)
      return fresh.map(DtoMustardComment.toDto)
    },

    DELETE_COMMENT: async (message) => {
      await mustardCommentsManager.deleteComment(message.commentId)
      // The cascade may delete an unread notification row for whoever was about
      // to be notified — refresh badge + overview.
      afterNotificationMutation()
      const fresh = await mustardCommentsManager.queryCommentsForNote(message.noteId)
      return fresh.map(DtoMustardComment.toDto)
    },

    QUERY_NOTIFICATIONS_FOR_NOTES: async (message) => {
      try {
        const session = await getSession()
        if (!session) return {}
        const map = await mustardNotificationsManager.queryUnreadCountsForNotes(message.noteIds)
        const response: QueryNotificationsForNotesResponse = {}
        for (const [noteId, count] of map.entries()) {
          if (count > 0) response[noteId] = count
        }
        return response
      } catch (err) {
        console.error('QUERY_NOTIFICATIONS_FOR_NOTES failed:', err)
        return {}
      }
    },

    MARK_NOTIFICATIONS_SEEN_FOR_NOTE: async (message) => {
      try {
        await mustardNotificationsManager.markSeenForNote(message.noteId)
        afterNotificationMutation()
      } catch (err) {
        console.error('MARK_NOTIFICATIONS_SEEN_FOR_NOTE failed:', err)
      }
      return null
    },

    GET_MY_PAGES_OVERVIEW: async () => {
      try {
        const session = await getSession()
        if (!session) return []
        const overview = await mustardNotificationsManager.queryMyPagesOverview(session.did)
        // Sync the badge whenever the popup pulls the overview — this is a
        // cheap natural-event trigger to keep the badge fresh.
        updateActionBadge()
        return overview
      } catch (err) {
        console.error('GET_MY_PAGES_OVERVIEW failed:', err)
        return []
      }
    },
  }

  // Receiving messages from the content-script and popup. Dispatch to the
  // matching handler; returning its Promise works on both Chrome (99+) and
  // Firefox. Unhandled types return undefined (no response).
  browser.runtime.onMessage.addListener((message: Message) => {
    const handler = handlers[message.type]
    console.debug(
      'mustard [service-worker] onMessage:',
      message,
      handler ? 'has handler' : 'no handler',
    )
    if (!handler) return
    // The map guarantees handler matches message.type at runtime; TS can't
    // correlate the indexed union, so we assert the call here.
    return (handler as (m: Message) => Promise<unknown> | void)(message)
  })
})
