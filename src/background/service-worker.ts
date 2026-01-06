// Background service worker
console.log('Mustard background service worker loaded')

// Create context menu item when extension is installed
chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: 'mustard-add-note',
    title: 'Add Mustard',
    contexts: ['all'], // Shows on any right-click context
  })
})

// Handle context menu item clicks
chrome.contextMenus.onClicked.addListener((info) => {
  if (info.menuItemId === 'mustard-add-note') {
    console.log('Mustard: Add Note clicked', {
      pageUrl: info.pageUrl,
      selectionText: info.selectionText,
      targetUrl: info.srcUrl || info.linkUrl,
    })

    // TODO: Send message to content script to open note editor
  }
})
