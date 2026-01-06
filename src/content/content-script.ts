// Content script
import { createApp, type App } from 'vue'
import MustardNoteEditor from '@/ui/note-editor/MustardNoteEditor.vue'
import styles from '@/styles/main.css?inline'
import type { Message, MustardNoteAnchorData } from '@/shared/messaging'

console.log('Mustard content script loaded')

let editorApp: App | null = null
let editorHost: HTMLElement | null = null
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
  // Remove hash and search params for normalization
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

chrome.runtime.onMessage.addListener((message: Message) => {
  if (message.type === 'OPEN_NOTE_EDITOR') {
    showNoteEditor()
  }
})

function findAnchorElement(anchor: MustardNoteAnchorData): HTMLElement | null {
  // Try by id first
  if (anchor.elementId) {
    const el = document.getElementById(anchor.elementId)
    if (el) return el
  }

  // Try by selector
  if (anchor.elementSelector) {
    const el = document.querySelector<HTMLElement>(anchor.elementSelector)
    if (el) return el
  }

  return null
}

function calculateEditorPosition(anchor: MustardNoteAnchorData): { x: number; y: number } {
  const element = findAnchorElement(anchor)

  if (element) {
    const rect = element.getBoundingClientRect()
    return {
      x: rect.left + (rect.width * anchor.relativePosition.xP) / 100,
      y: rect.top + (rect.height * anchor.relativePosition.yP) / 100 + window.scrollY,
    }
  }

  // Fallback to absolute click position
  return {
    x: (anchor.clickPosition.xVw / 100) * window.innerWidth,
    y: anchor.clickPosition.yPx,
  }
}

function showNoteEditor() {
  if (editorHost) return
  if (!lastContextMenuData) return

  console.log('Opening editor with anchor data:', lastContextMenuData)

  const position = calculateEditorPosition(lastContextMenuData)

  // Create host element with shadow DOM for style isolation
  editorHost = document.createElement('div')
  editorHost.id = 'mustard-note-editor-host'
  editorHost.style.position = 'absolute'
  editorHost.style.left = `${position.x}px`
  editorHost.style.top = `${position.y}px`
  editorHost.style.zIndex = '2147483647'
  document.body.appendChild(editorHost)

  const shadow = editorHost.attachShadow({ mode: 'open' })

  // Inject styles inside shadow DOM only
  const styleElement = document.createElement('style')
  styleElement.textContent = styles
  shadow.appendChild(styleElement)

  // Mount point inside shadow
  const mountPoint = document.createElement('div')
  shadow.appendChild(mountPoint)

  editorApp = createApp(MustardNoteEditor)
  editorApp.mount(mountPoint)
}
