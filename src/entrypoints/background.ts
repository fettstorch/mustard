import {
  createOpenNoteEditorMessage,
  type Message,
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
    const tabs = await browser.tabs.query({})
    for (const tab of tabs) {
      if (tab.id) {
        browser.tabs.sendMessage(tab.id, { type: 'SESSION_CHANGED', did }).catch(() => {
          // Tab might not have content script loaded, ignore errors
        })
      }
    }
  }

  /** Broadcast that the unread-notifications state changed. Popup re-queries; content scripts can refresh in-page dots. */
  async function broadcastNotificationsChanged() {
    const tabs = await browser.tabs.query({})
    for (const tab of tabs) {
      if (tab.id) {
        browser.tabs.sendMessage(tab.id, { type: 'NOTIFICATIONS_CHANGED' }).catch(() => {
          // Popup or content script might not be listening — ignore.
        })
      }
    }
    // Popup runtime listener is reached via runtime.sendMessage (not tab-scoped).
    browser.runtime.sendMessage({ type: 'NOTIFICATIONS_CHANGED' }).catch(() => {})
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
      await browser.tabs.sendMessage(tab.id, createOpenNoteEditorMessage())
    } catch {
      // Content script not available (tab predates extension load, or context was invalidated).
    }
  })

  // Receiving messages from the content-script and popup.
  // Returning a Promise from the listener works on both Chrome (99+) and Firefox.
  browser.runtime.onMessage.addListener((message: Message) => {
    console.debug('mustard [service-worker] onMessage:', message)

    if (message.type === 'UPSERT_NOTE') {
      return (async () => {
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

        if (target === 'remote') {
          invalidateRemoteIndexCache()
        }

        if (target === 'local') {
          const localNotes = await mustardNotesManager.queryLocalNotesFor(pageUrl)
          return localNotes.map(DtoMustardNote.toDto)
        }

        const allNotes = await mustardNotesManager.queryMustardNotesFor(pageUrl, session!.did)

        if (message.localNoteIdToDelete) {
          await mustardNotesManager.deleteNote(message.localNoteIdToDelete, pageUrl, 'local')
          const filteredNotes = allNotes.filter((n) => n.id !== message.localNoteIdToDelete)
          return filteredNotes.map(DtoMustardNote.toDto)
        }

        return allNotes.map(DtoMustardNote.toDto)
      })()
    }

    if (message.type === 'QUERY_NOTES') {
      return (async () => {
        const session = await getSession()
        const notes = await mustardNotesManager.queryMustardNotesFor(message.pageUrl, session?.did)
        return notes.map(DtoMustardNote.toDto)
      })()
    }

    if (message.type === 'DELETE_NOTE') {
      return (async () => {
        await mustardNotesManager.deleteNote(message.noteId, message.pageUrl, message.authorId)

        if (message.authorId !== 'local') {
          invalidateRemoteIndexCache()
          // Cascades may have removed comment notifications too.
          updateActionBadge()
          broadcastNotificationsChanged()
        }

        if (message.authorId === 'local') {
          const localNotes = await mustardNotesManager.queryLocalNotesFor(message.pageUrl)
          return localNotes.map(DtoMustardNote.toDto)
        }

        const session = await getSession()
        const allNotes = await mustardNotesManager.queryMustardNotesFor(
          message.pageUrl,
          session?.did,
        )
        return allNotes.map(DtoMustardNote.toDto)
      })()
    }

    if (message.type === 'SET_REPOST') {
      return (async () => {
        const session = await getSession()
        if (!session) {
          console.error('Cannot repost - user not logged in')
          return []
        }

        await mustardNotesManager.setRepost(message.noteId, session.did, message.reposted)

        // Repost changes visibility → bust the index cache so the next query
        // recomputes reposted note ids / reposter lists.
        invalidateRemoteIndexCache()

        const allNotes = await mustardNotesManager.queryMustardNotesFor(
          message.pageUrl,
          session.did,
        )
        return allNotes.map(DtoMustardNote.toDto)
      })()
    }

    if (message.type === 'ATPROTO_LOGIN') {
      return (async () => {
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
      })()
    }

    if (message.type === 'GET_ATPROTO_SESSION') {
      return (async () => {
        try {
          const session = await getSession()
          updateActionBadge()
          return session ? { did: session.did } : null
        } catch (err) {
          console.error('GET_ATPROTO_SESSION failed:', err)
          return null
        }
      })()
    }

    if (message.type === 'ATPROTO_LOGOUT') {
      return (async () => {
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
      })()
    }

    if (message.type === 'OPEN_POPUP') {
      const action = getActionApi()
      action?.openPopup?.()?.catch(() => {})
      return
    }

    if (message.type === 'GET_PROFILES') {
      return (async () => {
        try {
          return await profileService.getProfiles(message.userIds)
        } catch (err) {
          console.error('GET_PROFILES failed:', err)
          return {}
        }
      })()
    }

    if (message.type === 'QUERY_COMMENTS') {
      return (async () => {
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
      })()
    }

    if (message.type === 'UPSERT_COMMENT') {
      return (async () => {
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

        // A new comment may produce a notification row for the note's author
        // (if it isn't a self-comment). Invalidate the cached overview so the
        // popup picks up the change next time it queries.
        invalidateRemoteIndexCache()

        const fresh = await mustardCommentsManager.queryCommentsForNote(message.noteId)
        return fresh.map(DtoMustardComment.toDto)
      })()
    }

    if (message.type === 'DELETE_COMMENT') {
      return (async () => {
        await mustardCommentsManager.deleteComment(message.commentId)
        // The cascade may delete an unread notification row for whoever was
        // about to be notified — refresh badge + overview.
        invalidateRemoteIndexCache()
        updateActionBadge()
        broadcastNotificationsChanged()
        const fresh = await mustardCommentsManager.queryCommentsForNote(message.noteId)
        return fresh.map(DtoMustardComment.toDto)
      })()
    }

    if (message.type === 'QUERY_NOTIFICATIONS_FOR_NOTES') {
      return (async () => {
        try {
          const session = await getSession()
          if (!session) return {} as QueryNotificationsForNotesResponse
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
      })()
    }

    if (message.type === 'MARK_NOTIFICATIONS_SEEN_FOR_NOTE') {
      return (async () => {
        try {
          await mustardNotificationsManager.markSeenForNote(message.noteId)
          invalidateRemoteIndexCache()
          await updateActionBadge()
          broadcastNotificationsChanged()
        } catch (err) {
          console.error('MARK_NOTIFICATIONS_SEEN_FOR_NOTE failed:', err)
        }
        return null
      })()
    }

    if (message.type === 'GET_MY_PAGES_OVERVIEW') {
      return (async () => {
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
      })()
    }
  })
})
