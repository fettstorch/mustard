// Background service worker
import { createOpenNoteEditorMessage } from '@/shared/messaging'

console.log('Mustard background service worker loaded')

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
