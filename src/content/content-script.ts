// Content script
import {
  createQueryNotesMessage,
  createGetAtprotoSessionMessage,
  type Message,
  type MustardNoteAnchorData,
  type AtprotoSessionResponse,
} from '@/shared/messaging'
import { DtoMustardNote } from '@/shared/dto/DtoMustardNote'
import MustardContent from '@/ui/content/MustardContent.vue'
import { createMustardState } from '@/ui/content/mustard-state'
import { Observable } from '@fettstorch/jule'
import { createApp } from 'vue'

// Reactive state shared with Vue app
const mustardState = createMustardState()

// The page's URL (used for storing/retrieving notes)
const normalizedPageUrl = normalizePageUrl(window.location.href)

// Capture context menu data when user right-clicks on a page
// In order for us to get the click-data
// The service-worker registers the right-click on the 'add mustard' context menu
// but the service-worker can't access the page's click-target
let lastContextMenuData: MustardNoteAnchorData | null = null

// Handle messages from service worker
chrome.runtime.onMessage.addListener((message: Message) => {
  console.debug('mustard [content-script] onMessage:', message)
  if (message.type === 'OPEN_NOTE_EDITOR') {
    mustardState.editor.anchor = lastContextMenuData
    mustardState.editor.isOpen = true
    return
  }
})

// Fetch current session to know if user is logged in (for note ownership checks)
chrome.runtime.sendMessage(createGetAtprotoSessionMessage(), (response: AtprotoSessionResponse) => {
  console.debug('mustard [content-script] session:', response)
  mustardState.currentUserDid = response?.did ?? null
})

// Query notes for the current page (response comes via sendResponse callback)
chrome.runtime.sendMessage(createQueryNotesMessage(normalizedPageUrl), (dtos: DtoMustardNote[]) => {
  console.debug('mustard [content-script] received notes:', dtos)
  mustardState.notes = (dtos ?? []).map(DtoMustardNote.fromDto)
})

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

// content-script will act as a message relay between the vue app and the service worker
// it can alter the mustardState which is reactive and the vue app will act on it
// it can receive messages from the vue app via the event observable which it will relay to the service-worker
event.subscribe((message) => {
  if (message.type === 'UPSERT_NOTE') {
    chrome.runtime.sendMessage(message, (dtos: DtoMustardNote[]) => {
      console.debug('mustard [content-script] received notes after upsert:', dtos)
      mustardState.notes = (dtos ?? []).map(DtoMustardNote.fromDto)
    })
  }

  if (message.type === 'DELETE_NOTE') {
    chrome.runtime.sendMessage(message, (dtos: DtoMustardNote[]) => {
      console.debug('mustard [content-script] received notes after delete:', dtos)
      mustardState.notes = (dtos ?? []).map(DtoMustardNote.fromDto)
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
    pageUrl: normalizedPageUrl,
    elementId: target.id || null,
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

  // Validate selector before returning
  try {
    document.querySelector(selector)
    return selector
  } catch {
    return null
  }
}
