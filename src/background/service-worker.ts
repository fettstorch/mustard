// Background service worker
import {
  createOpenNoteEditorMessage,
  type Message,
  type AtprotoSessionResponse,
  type GetProfilesResponse,
} from '@/shared/messaging'
import { mustardNotesManager } from './business/MustardNotesManager'
import { DtoMustardNote } from '@/shared/dto/DtoMustardNote'
import { login, getSession, logout } from './auth/AtprotoAuth'
import { MustardProfileServiceBsky } from './business/service/MustardProfileServiceBsky'
import { invalidateRemoteIndexCache } from './business/service/MustardNotesServiceRemote'

const profileService = new MustardProfileServiceBsky()

console.log('Mustard background service worker loaded')

/** Broadcast session change to all tabs so content scripts can update their state */
async function broadcastSessionChanged(did: string | null) {
  const tabs = await chrome.tabs.query({})
  for (const tab of tabs) {
    if (tab.id) {
      chrome.tabs.sendMessage(tab.id, { type: 'SESSION_CHANGED', did }).catch(() => {
        // Tab might not have content script loaded, ignore errors
      })
    }
  }
}

// Create context menu item when extension is installed, and open welcome page on first install
chrome.runtime.onInstalled.addListener((details) => {
  chrome.contextMenus.create({
    id: 'mustard-add-note',
    title: 'Add Mustard',
    contexts: ['all'], // Shows on any right-click context
  })

  if (details.reason === 'install') {
    chrome.tabs.create({ url: 'https://fettstorch.github.io/mustard/' })
  }
})

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === 'mustard-add-note' && tab?.id) {
    chrome.tabs.sendMessage(tab.id, createOpenNoteEditorMessage()).catch(() => {
      // Tab may not have content script loaded (e.g. chrome:// pages or tabs opened before extension load)
    })
  }
})

// Receiving messages from the content-script and popup
// IMPORTANT: Cannot be async! Must return true for async responses and use sendResponse callback.
chrome.runtime.onMessage.addListener(
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
          // For local notes, generate ID client-side; for remote, let DB generate it
          id: target === 'local' ? crypto.randomUUID() : null,
          authorId,
          content: message.data.content,
          anchorData: message.data.anchorData,
          updatedAt: message.data.updatedAt,
        })

        await mustardNotesManager.upsertNote(note, target)

        // Invalidate index cache since this page now has a new/updated note
        if (target === 'remote') {
          invalidateRemoteIndexCache()
        }

        if (target === 'local') {
          // For local saves, just return local notes (fast)
          const localNotes = await mustardNotesManager.queryLocalNotesFor(pageUrl)
          sendResponse(localNotes.map(DtoMustardNote.toDto))
        } else {
          // For remote publish:
          // 1. Re-query all notes (including the just-published remote one)
          const allNotes = await mustardNotesManager.queryMustardNotesFor(pageUrl, session!.did)

          // 2. Delete the local note if specified (after we have remote notes)
          if (message.localNoteIdToDelete) {
            await mustardNotesManager.deleteNote(message.localNoteIdToDelete, pageUrl, 'local')
            // Filter out the deleted local note from response
            const filteredNotes = allNotes.filter((n) => n.id !== message.localNoteIdToDelete)
            sendResponse(filteredNotes.map(DtoMustardNote.toDto))
          } else {
            sendResponse(allNotes.map(DtoMustardNote.toDto))
          }
        }
      })
      return true // Keep channel open for async response
    }

    if (message.type === 'QUERY_NOTES') {
      getSession().then(async (session) => {
        const userId = session?.did
        const notes = await mustardNotesManager.queryMustardNotesFor(message.pageUrl, userId)
        sendResponse(notes.map(DtoMustardNote.toDto))
      })
      return true // Keep channel open for async response
    }

    if (message.type === 'DELETE_NOTE') {
      getSession().then(async (session) => {
        await mustardNotesManager.deleteNote(message.noteId, message.pageUrl, message.authorId)

        // Invalidate index cache if remote note was deleted
        if (message.authorId !== 'local') {
          invalidateRemoteIndexCache()
        }

        // Re-query notes to return fresh list
        if (message.authorId === 'local') {
          const localNotes = await mustardNotesManager.queryLocalNotesFor(message.pageUrl)
          sendResponse(localNotes.map(DtoMustardNote.toDto))
        } else {
          const userId = session?.did
          const allNotes = await mustardNotesManager.queryMustardNotesFor(message.pageUrl, userId)
          sendResponse(allNotes.map(DtoMustardNote.toDto))
        }
      })
      return true // Keep channel open for async response
    }

    // AT Protocol auth messages - handled here because popup can close during OAuth flow
    if (message.type === 'ATPROTO_LOGIN') {
      login(message.handle)
        .then((session) => {
          invalidateRemoteIndexCache() // Clear cached index for new user
          sendResponse({ did: session.did })
          // Broadcast session change to all tabs
          broadcastSessionChanged(session.did)
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
        .then(() => {
          invalidateRemoteIndexCache() // Clear cached index
          sendResponse(null)
          // Broadcast session change to all tabs
          broadcastSessionChanged(null)
        })
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
