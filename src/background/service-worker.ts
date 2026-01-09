// Background service worker
import { createOpenNoteEditorMessage, type Message } from '@/shared/messaging'
import type { MustardIndex } from '@/shared/model/MustardIndex'
import { awaitable } from '@fettstorch/jule'
import { mustardNotesManager } from './business/MustardNotesManager'
import { DtoMustardNote } from '@/shared/dto/DtoMustardNote'

console.log('Mustard background service worker loaded')
const mustardIndex = awaitable<MustardIndex>()

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

// Receiving messages from the content-script
// IMPORTANT: Cannot be async! Must return true for async responses and use sendResponse callback.
chrome.runtime.onMessage.addListener(
  (message: Message, _sender, sendResponse: (response: DtoMustardNote[]) => void) => {
    console.debug('mustard [service-worker] onMessage:', message)

    if (message.type === 'UPSERT_NOTE') {
      // Convert DTO to domain model at the boundary
      const note = DtoMustardNote.fromDto({
        id: crypto.randomUUID(),
        authorId: 'local', // TODO get from mustardnotesmanager or whoever will manage the login
        content: message.data.content,
        anchorData: message.data.anchorData,
        updatedAt: message.data.updatedAt,
      })
      mustardNotesManager.upsertNote(note).then(async () => {
        // Re-query and return fresh notes
        const notes = await mustardNotesManager.queryMustardNotesFor(note.anchorData.pageUrl)
        sendResponse(notes.map(DtoMustardNote.toDto))
      })
      return true // Keep channel open for async response
    }

    if (message.type === 'QUERY_NOTES') {
      mustardNotesManager.queryMustardNotesFor(message.pageUrl).then((notes) => {
        // Convert to DTOs for serialization over chrome.runtime messaging
        sendResponse(notes.map(DtoMustardNote.toDto))
      })
      return true // Keep channel open for async response
    }

    if (message.type === 'DELETE_NOTE') {
      mustardNotesManager.deleteNote(message.noteId, message.pageUrl).then(async () => {
        // Re-query and return fresh notes
        const notes = await mustardNotesManager.queryMustardNotesFor(message.pageUrl)
        sendResponse(notes.map(DtoMustardNote.toDto))
      })
      return true // Keep channel open for async response
    }
  },
)

chrome.runtime.onStartup.addListener(async () => {
  mustardNotesManager.queryMustardIndex().then((index) => mustardIndex.resolve(index))
})
