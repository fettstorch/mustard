import { createOpenNoteEditorMessage, type Message } from '@/shared/messaging'
import { mustardNotesManager } from '@/background/business/MustardNotesManager'
import { DtoMustardNote } from '@/shared/dto/DtoMustardNote'
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

  // Create context menu item when extension is installed, and open welcome page on first install
  browser.runtime.onInstalled.addListener((details) => {
    browser.contextMenus.create({
      id: 'mustard-add-note',
      title: 'Add Mustard',
      contexts: ['all'],
    })

    if (details.reason === 'install') {
      browser.tabs.create({ url: 'https://fettstorch.github.io/mustard/' })
    }
  })

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

    if (message.type === 'ATPROTO_LOGIN') {
      return (async () => {
        try {
          const result = await login(message.handle)
          await storeSupabaseJwt(result.jwt, result.expiresAt, result.did)
          invalidateRemoteIndexCache()
          broadcastSessionChanged(result.did)
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
          return null
        } catch (err) {
          console.error('ATPROTO_LOGOUT failed:', err)
          return null
        }
      })()
    }

    if (message.type === 'OPEN_POPUP') {
      browser.action.openPopup().catch(() => {})
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
  })
})
