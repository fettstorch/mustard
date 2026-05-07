import {
  createOpenNoteEditorMessage,
  type Message,
  type AtprotoSessionResponse,
  type GetProfilesResponse,
} from '@/shared/messaging'
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

  // Receiving messages from the content-script and popup
  // IMPORTANT: Cannot be async! Must return true for async responses and use sendResponse callback.
  browser.runtime.onMessage.addListener(
    (
      message: Message,
      _sender,
      sendResponse: (
        response: DtoMustardNote[] | AtprotoSessionResponse | GetProfilesResponse,
      ) => void,
    ) => {
      console.debug('mustard [service-worker] onMessage:', message)

      if (message.type === 'UPSERT_NOTE') {
        getSession().then(async (session) => {
          const target = message.target
          const pageUrl = message.data.anchorData.pageUrl

          let authorId: string
          if (target === 'local') {
            authorId = 'local'
          } else {
            if (!session) {
              console.error('Cannot publish note - user not logged in')
              sendResponse([])
              return
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
            sendResponse(localNotes.map(DtoMustardNote.toDto))
          } else {
            const allNotes = await mustardNotesManager.queryMustardNotesFor(pageUrl, session!.did)

            if (message.localNoteIdToDelete) {
              await mustardNotesManager.deleteNote(message.localNoteIdToDelete, pageUrl, 'local')
              const filteredNotes = allNotes.filter((n) => n.id !== message.localNoteIdToDelete)
              sendResponse(filteredNotes.map(DtoMustardNote.toDto))
            } else {
              sendResponse(allNotes.map(DtoMustardNote.toDto))
            }
          }
        })
        return true
      }

      if (message.type === 'QUERY_NOTES') {
        getSession().then(async (session) => {
          const userId = session?.did
          const notes = await mustardNotesManager.queryMustardNotesFor(message.pageUrl, userId)
          sendResponse(notes.map(DtoMustardNote.toDto))
        })
        return true
      }

      if (message.type === 'DELETE_NOTE') {
        getSession().then(async (session) => {
          await mustardNotesManager.deleteNote(message.noteId, message.pageUrl, message.authorId)

          if (message.authorId !== 'local') {
            invalidateRemoteIndexCache()
          }

          if (message.authorId === 'local') {
            const localNotes = await mustardNotesManager.queryLocalNotesFor(message.pageUrl)
            sendResponse(localNotes.map(DtoMustardNote.toDto))
          } else {
            const userId = session?.did
            const allNotes = await mustardNotesManager.queryMustardNotesFor(message.pageUrl, userId)
            sendResponse(allNotes.map(DtoMustardNote.toDto))
          }
        })
        return true
      }

      if (message.type === 'ATPROTO_LOGIN') {
        login(message.handle)
          .then(async (result) => {
            await storeSupabaseJwt(result.jwt, result.expiresAt, result.did)
            invalidateRemoteIndexCache()
            sendResponse({ did: result.did })
            broadcastSessionChanged(result.did)
          })
          .catch((err) => {
            console.error('ATPROTO_LOGIN failed:', err)
            sendResponse(null)
          })
        return true
      }

      if (message.type === 'GET_ATPROTO_SESSION') {
        getSession()
          .then((session) => {
            sendResponse(session ? { did: session.did } : null)
          })
          .catch((err) => {
            console.error('GET_ATPROTO_SESSION failed:', err)
            sendResponse(null)
          })
        return true
      }

      if (message.type === 'ATPROTO_LOGOUT') {
        logout(message.did)
          .then(() => clearSupabaseJwt())
          .then(() => {
            invalidateRemoteIndexCache()
            sendResponse(null)
            broadcastSessionChanged(null)
          })
          .catch((err) => {
            console.error('ATPROTO_LOGOUT failed:', err)
            sendResponse(null)
          })
        return true
      }

      if (message.type === 'OPEN_POPUP') {
        browser.action.openPopup().catch(() => {})
        return
      }

      if (message.type === 'GET_PROFILES') {
        profileService
          .getProfiles(message.userIds)
          .then((profiles) => sendResponse(profiles))
          .catch((err) => {
            console.error('GET_PROFILES failed:', err)
            sendResponse({})
          })
        return true
      }
    },
  )
})
