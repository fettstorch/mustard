// Content script
import { createApp } from 'vue'
import MustardContent from '@/ui/content/MustardContent.vue'
import { createMustardState } from '@/ui/content/mustard-state'
import type { Message, MustardNoteAnchorData } from '@/shared/messaging'

// Reactive state shared with Vue app
const mustardState = createMustardState()

// Single host element for all Mustard UI
const mustardHost = document.createElement('div')
mustardHost.id = 'mustard-host'
document.body.appendChild(mustardHost)

// Create Vue app with state provided - mount directly to host (no shadow DOM)
const app = createApp(MustardContent)
app.provide('mustardState', mustardState)
app.mount(mustardHost)

// Capture context menu data
let lastContextMenuData: MustardNoteAnchorData | null = null

// Capture context menu data when right-clicking
// the service-worker has no permission to capture the click-target
// so we capture the anchor data in the content script (here)
// it will be retrieved when the service-worker informs the content script
// of the user clicking the 'add mustard' context menu item
document.addEventListener('contextmenu', (event) => {
  const target = event.target as HTMLElement
  const rect = target.getBoundingClientRect()

  lastContextMenuData = {
    pageUrl: normalizePageUrl(window.location.href),
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

// Handle messages from service worker
chrome.runtime.onMessage.addListener((message: Message) => {
  if (message.type === 'OPEN_NOTE_EDITOR') {
    mustardState.editor.anchor = lastContextMenuData
    mustardState.editor.isOpen = true
  }
})
