// Content script

// Vite's __vitePreload tries to load CSS for dynamic chunks using root-relative paths
// (e.g. /assets/MustardNoteEditor-*.css). In a content script running on a web page,
// these paths resolve against the page origin (e.g. https://bsky.app/assets/...) and
// fail with a 404. The CSS is already injected by Chrome via the manifest's
// content_scripts.css array, so we can safely suppress these preload errors and let the
// actual JS dynamic import proceed normally.
window.addEventListener('vite:preloadError', (event) => {
  event.preventDefault()
})

import {
  createQueryNotesMessage,
  createGetAtprotoSessionMessage,
  createGetProfilesMessage,
  type Message,
  type MustardNoteAnchorData,
  type AtprotoSessionResponse,
  type GetProfilesResponse,
} from '@/shared/messaging'
import { LIMITS } from '@/shared/constants'
import { DtoMustardNote } from '@/shared/dto/DtoMustardNote'
import MustardContent from '@/ui/content/MustardContent.vue'
import { createMustardState } from '@/ui/content/mustard-state'
import type { MustardNote } from '@/shared/model/MustardNote'
import { Observable } from '@fettstorch/jule'
import { createApp } from 'vue'

// Reactive state shared with Vue app
const mustardState = createMustardState()

function clearPendingNoteIds() {
  Object.keys(mustardState.pendingNoteIds).forEach((key) => delete mustardState.pendingNoteIds[key])
}

/** Fetches profiles for remote note authors that aren't already cached */
function fetchProfilesForNotes(notes: MustardNote[]) {
  const remoteAuthorIds = notes
    .filter((n) => n.authorId !== 'local')
    .map((n) => n.authorId)
    .filter((id) => !(id in mustardState.profiles))

  const uniqueIds = [...new Set(remoteAuthorIds)]
  if (uniqueIds.length === 0) return

  chrome.runtime.sendMessage(
    createGetProfilesMessage(uniqueIds),
    (response: GetProfilesResponse) => {
      console.debug('mustard [content-script] received profiles:', response)
      Object.assign(mustardState.profiles, response ?? {})
    },
  )
}

// The page's URL (used for storing/retrieving notes)
// This is updated when the URL changes (SPA navigation)
let currentPageUrl = normalizePageUrl(window.location.href)

function getCurrentPageUrl(): string {
  return currentPageUrl
}

function handleUrlChange() {
  const newUrl = normalizePageUrl(window.location.href)
  if (newUrl === currentPageUrl) return

  console.debug('mustard [content-script] URL changed:', currentPageUrl, '->', newUrl)
  currentPageUrl = newUrl

  // Clear existing notes and re-query for the new page
  mustardState.notes = []
  chrome.runtime.sendMessage(createQueryNotesMessage(newUrl), (dtos: DtoMustardNote[]) => {
    console.debug('mustard [content-script] received notes for new URL:', dtos)
    const notes = (dtos ?? []).map(DtoMustardNote.fromDto)
    mustardState.notes = notes
    fetchProfilesForNotes(notes)
  })
}

// Listen for SPA navigation (history API)
window.addEventListener('popstate', handleUrlChange)

// Inject script into page's main world to intercept pushState/replaceState
// Content scripts run in isolated world and can't directly intercept the page's history API
// We use an external script file to avoid CSP inline script restrictions
const injectedScript = document.createElement('script')
injectedScript.src = chrome.runtime.getURL('url-change-detector.js')
document.documentElement.appendChild(injectedScript)

// Listen for URL change events from the injected script
window.addEventListener('mustard-url-change', handleUrlChange)

// Capture context menu data when user right-clicks on a page
// In order for us to get the click-data
// The service-worker registers the right-click on the 'add mustard' context menu
// but the service-worker can't access the page's click-target
let lastContextMenuData: MustardNoteAnchorData | null = null

// Handle messages from service worker and popup
chrome.runtime.onMessage.addListener((message: Message, _sender, sendResponse) => {
  console.debug('mustard [content-script] onMessage:', message)
  if (message.type === 'GET_NOTES_VISIBLE') {
    sendResponse(mustardState.areNotesVisible)
    return
  }
  if (message.type === 'SET_NOTES_VISIBLE') {
    mustardState.areNotesVisible = message.visible
    sendResponse(mustardState.areNotesVisible)
    return
  }
  if (message.type === 'OPEN_NOTE_EDITOR') {
    if (!mustardState.areNotesVisible) {
      mustardState.areNotesVisible = true
    }
    mustardState.editor.anchor = lastContextMenuData
    mustardState.editor.isOpen = true
    return
  }
  if (message.type === 'SESSION_CHANGED') {
    mustardState.currentUserDid = message.did
    // Re-query notes now that login state changed (may have remote notes available)
    chrome.runtime.sendMessage(
      createQueryNotesMessage(getCurrentPageUrl()),
      (dtos: DtoMustardNote[]) => {
        console.debug('mustard [content-script] received notes after session change:', dtos)
        const notes = (dtos ?? []).map(DtoMustardNote.fromDto)
        mustardState.notes = notes
        fetchProfilesForNotes(notes)
      },
    )
    return
  }
})

// Fetch current session to know if user is logged in (for note ownership checks)
chrome.runtime.sendMessage(createGetAtprotoSessionMessage(), (response: AtprotoSessionResponse) => {
  console.debug('mustard [content-script] session:', response)
  mustardState.currentUserDid = response?.did ?? null
})

// Query notes for the current page (response comes via sendResponse callback)
chrome.runtime.sendMessage(
  createQueryNotesMessage(getCurrentPageUrl()),
  (dtos: DtoMustardNote[]) => {
    console.debug('mustard [content-script] received notes:', dtos)
    const notes = (dtos ?? []).map(DtoMustardNote.fromDto)
    mustardState.notes = notes
    fetchProfilesForNotes(notes)
  },
)

// Detect when extension context is invalidated (extension reloaded/updated while tab is open).
// When this happens, clean up Mustard UI so the orphaned script doesn't leave broken UI behind.
function isContextInvalidated(): boolean {
  return !chrome.runtime.id
}

function showRefreshBanner() {
  if (document.getElementById('mustard-refresh-banner')) return
  const banner = document.createElement('div')
  banner.id = 'mustard-refresh-banner'
  banner.style.cssText =
    'position:fixed;top:0;left:50%;transform:translateX(-50%);background:#ffb800;color:#3d2200;' +
    'padding:8px 20px;border-radius:0 0 10px 10px;font-family:monospace;font-size:13px;font-weight:600;' +
    'z-index:2147483647;box-shadow:0 2px 8px rgba(0,0,0,0.25);cursor:pointer'
  banner.textContent = '🟡 Mustard was updated — please refresh this page'
  banner.onclick = () => banner.remove()
  document.body.appendChild(banner)
}

// Single host element for all Mustard UI
const mustardHost = document.createElement('div')
mustardHost.id = 'mustard-host'
document.body.appendChild(mustardHost)

// Create Vue app with state provided - mount directly to host (no shadow DOM)
const app = createApp(MustardContent)
const event = new Observable<Message>()
app.provide('mustardState', mustardState)
app.provide('event', event)
app.mount(mustardHost)

// When extension context is invalidated (hot-reload / update), unmount and prompt refresh.
// We check on user interaction (mousemove/click) to avoid polling.
function handlePotentialInvalidation() {
  if (isContextInvalidated()) {
    app.unmount()
    mustardHost.remove()
    showRefreshBanner()
    window.removeEventListener('mousemove', handlePotentialInvalidation)
    window.removeEventListener('keydown', handlePotentialInvalidation)
  }
}
window.addEventListener('mousemove', handlePotentialInvalidation, { passive: true })
window.addEventListener('keydown', handlePotentialInvalidation, { passive: true })

// content-script will act as a message relay between the vue app and the service worker
// it can alter the mustardState which is reactive and the vue app will act on it
// it can receive messages from the vue app via the event observable which it will relay to the service-worker
event.subscribe((message) => {
  if (message.type === 'UPSERT_NOTE') {
    const isLocalOperation = message.target === 'local'
    chrome.runtime.sendMessage(message, (dtos: DtoMustardNote[]) => {
      console.debug('mustard [content-script] received notes after upsert:', dtos)
      const newNotes = (dtos ?? []).map(DtoMustardNote.fromDto)
      if (isLocalOperation) {
        // For local saves, merge: keep existing remote notes, replace local notes
        const remoteNotes = mustardState.notes.filter((n) => n.authorId !== 'local')
        mustardState.notes = [...newNotes, ...remoteNotes]
      } else {
        // For remote publish, response includes all notes
        mustardState.notes = newNotes
        fetchProfilesForNotes(newNotes)
      }
      clearPendingNoteIds()
    })
  }

  if (message.type === 'DELETE_NOTE') {
    const isLocalDelete = message.authorId === 'local'
    chrome.runtime.sendMessage(message, (dtos: DtoMustardNote[]) => {
      console.debug('mustard [content-script] received notes after delete:', dtos)
      const newNotes = (dtos ?? []).map(DtoMustardNote.fromDto)
      if (isLocalDelete) {
        // For local deletes, merge: keep existing remote notes, replace local notes
        const remoteNotes = mustardState.notes.filter((n) => n.authorId !== 'local')
        mustardState.notes = [...newNotes, ...remoteNotes]
      } else {
        // For remote delete, response includes all notes
        mustardState.notes = newNotes
      }
      clearPendingNoteIds()
    })
  }
})

// Capture context menu data when right-clicking
// the service-worker has no permission to capture the click-target
// so we capture the anchor data in the content script (here)
// it will be retrieved when the service-worker informs the content script
// of the user clicking the 'add mustard' context menu item
document.addEventListener('contextmenu', (event) => {
  const target = event.target as HTMLElement
  const rect = target.getBoundingClientRect()

  lastContextMenuData = {
    pageUrl: getCurrentPageUrl(),
    elementSelector: generateSelector(target),
    relativePosition: {
      xP: ((event.clientX - rect.left) / rect.width) * 100,
      yP: ((event.clientY - rect.top) / rect.height) * 100,
    },
    clickPosition: {
      xVw: (event.clientX / window.innerWidth) * 100,
      yPx: event.clientY + window.scrollY,
    },
  }
})

function normalizePageUrl(url: string): string {
  const u = new URL(url)
  return `${u.origin}${u.pathname}`
}

function generateSelector(element: HTMLElement): string | null {
  if (element.id) return `#${element.id}`

  const path: string[] = []
  let current: HTMLElement | null = element

  while (current && current !== document.body) {
    let selector = current.tagName.toLowerCase()

    if (current.id) {
      path.unshift(`#${current.id}`)
      break
    }

    const parent: HTMLElement | null = current.parentElement
    if (parent) {
      const siblings = Array.from(parent.children).filter(
        (el): el is HTMLElement => el.tagName === current!.tagName,
      )
      if (siblings.length > 1) {
        const index = siblings.indexOf(current) + 1
        selector += `:nth-of-type(${index})`
      }
    }

    path.unshift(selector)
    current = parent
  }

  const selector = path.join(' > ')

  // Return null if selector too long - will fall back to clickPosition
  if (selector.length > LIMITS.SELECTOR_MAX_LENGTH) return null

  // Validate selector before returning
  try {
    document.querySelector(selector)
    return selector
  } catch {
    return null
  }
}
