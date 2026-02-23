// Background service worker
import {
  createOpenNoteEditorMessage,
  type Message,
  type AtprotoSessionResponse,
  type GetProfilesResponse,
} from '@/shared/messaging'
import type { MustardIndex } from '@/shared/model/MustardIndex'
import { mustardNotesManager } from './business/MustardNotesManager'
import { DtoMustardNote } from '@/shared/dto/DtoMustardNote'
import { login, getSession, logout } from './auth/AtprotoAuth'
import { MustardProfileServiceBsky } from './business/service/MustardProfileServiceBsky'

const profileService = new MustardProfileServiceBsky()

console.log('Mustard background service worker loaded')

let cachedIndex: MustardIndex | null = null

async function getIndex(userId?: string): Promise<MustardIndex> {
  if (!cachedIndex) {
    cachedIndex = await mustardNotesManager.queryMustardIndex(userId)
  }
  return cachedIndex
}

function invalidateIndex() {
  cachedIndex = null
}

// Create context menu item when extension is installed
chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: 'mustard-add-note',
    title: 'Add Mustard',
    contexts: ['all'], // Shows on any right-click context
  })
})

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === 'mustard-add-note' && tab?.id) {
    chrome.tabs.sendMessage(tab.id, createOpenNoteEditorMessage())
  }
})

// Receiving messages from the content-script and popup
// IMPORTANT: Cannot be async! Must return true for async responses and use sendResponse callback.
chrome.runtime.onMessage.addListener(
  (
    message: Message,
    _sender,
    sendResponse: (response: DtoMustardNote[] | AtprotoSessionResponse | GetProfilesResponse) => void,
  ) => {
    console.debug('mustard [service-worker] onMessage:', message)

    if (message.type === 'UPSERT_NOTE') {
      getSession().then(async (session) => {
        const target = message.target

        // Set authorId based on target
        let authorId: string
        if (target === 'local') {
          authorId = 'local'
        } else {
          // target === 'remote'
          if (!session) {
            console.error('Cannot publish note - user not logged in')
            sendResponse([])
            return
          }
          authorId = session.did
        }

        const note = DtoMustardNote.fromDto({
          id: crypto.randomUUID(),
          authorId,
          content: message.data.content,
          anchorData: message.data.anchorData,
          updatedAt: message.data.updatedAt,
        })

        await mustardNotesManager.upsertNote(note, target)
        invalidateIndex()

        // Re-query and return fresh notes
        const userId = session?.did
        const notes = await mustardNotesManager.queryMustardNotesFor(note.anchorData.pageUrl, userId)
        sendResponse(notes.map(DtoMustardNote.toDto))
      })
      return true // Keep channel open for async response
    }

    if (message.type === 'QUERY_NOTES') {
      getSession().then(async (session) => {
        const userId = session?.did
        const index = await getIndex(userId)

        if (index.getUsersForPage(message.pageUrl).length === 0) {
          sendResponse([])
          return
        }

        const notes = await mustardNotesManager.queryMustardNotesFor(message.pageUrl, userId)
        sendResponse(notes.map(DtoMustardNote.toDto))
      })
      return true // Keep channel open for async response
    }

    if (message.type === 'DELETE_NOTE') {
      getSession().then(async (session) => {
        await mustardNotesManager.deleteNote(message.noteId, message.pageUrl)
        invalidateIndex()

        // Re-query and return fresh notes
        const userId = session?.did
        const notes = await mustardNotesManager.queryMustardNotesFor(message.pageUrl, userId)
        sendResponse(notes.map(DtoMustardNote.toDto))
      })
      return true // Keep channel open for async response
    }

    // AT Protocol auth messages - handled here because popup can close during OAuth flow
    if (message.type === 'ATPROTO_LOGIN') {
      login(message.handle)
        .then((session) => {
          sendResponse({ did: session.did })
        })
        .catch((err) => {
          console.error('ATPROTO_LOGIN failed:', err)
          sendResponse(null)
        })
      return true // Keep channel open for async response
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
      return true // Keep channel open for async response
    }

    if (message.type === 'ATPROTO_LOGOUT') {
      logout(message.did)
        .then(() => sendResponse(null))
        .catch((err) => {
          console.error('ATPROTO_LOGOUT failed:', err)
          sendResponse(null)
        })
      return true // Keep channel open for async response
    }

    if (message.type === 'GET_PROFILES') {
      profileService
        .getProfiles(message.userIds)
        .then((profiles) => sendResponse(profiles))
        .catch((err) => {
          console.error('GET_PROFILES failed:', err)
          sendResponse({})
        })
      return true // Keep channel open for async response
    }
  },
)

