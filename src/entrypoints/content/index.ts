import mustardIconUrl from '@/assets/icons/mustard_bottle_smile_48.png'
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
import { createApp, watch } from 'vue'

const NOTES_MINIMIZED_KEY = 'mustard-notes-minimized'
const SHOW_ANCHOR_IN_EDITOR_KEY = 'mustard-show-anchor-in-editor'

export default defineContentScript({
  matches: ['<all_urls>'],
  cssInjectionMode: 'manifest',

  main() {
    // Vite's __vitePreload tries to load CSS for dynamic chunks using root-relative paths.
    // In a content script running on a web page these fail with 404.
    // CSS is already injected by the browser via the manifest's content_scripts.css array.
    window.addEventListener('vite:preloadError', (event) => {
      event.preventDefault()
    })

    // Reactive state shared with Vue app
    const mustardState = createMustardState()

    function clearPendingNoteIds() {
      Object.keys(mustardState.pendingNoteIds).forEach(
        (key) => delete mustardState.pendingNoteIds[key],
      )
    }

    /** Fetches profiles for remote note authors that aren't already cached */
    function fetchProfilesForNotes(notes: MustardNote[]) {
      const remoteAuthorIds = notes
        .filter((n) => n.authorId !== 'local')
        .map((n) => n.authorId)
        .filter((id) => !(id in mustardState.profiles))

      const uniqueIds = [...new Set(remoteAuthorIds)]
      if (uniqueIds.length === 0) return

      browser.runtime
        .sendMessage(createGetProfilesMessage(uniqueIds))
        .then((response: GetProfilesResponse) => {
          console.debug('mustard [content-script] received profiles:', response)
          Object.assign(mustardState.profiles, response ?? {})
        })
        .catch(() => {})
    }

    let currentPageUrl = normalizePageUrl(window.location.href)

    function getCurrentPageUrl(): string {
      return currentPageUrl
    }

    function handleUrlChange() {
      const newUrl = normalizePageUrl(window.location.href)
      if (newUrl === currentPageUrl) return

      console.debug('mustard [content-script] URL changed:', currentPageUrl, '->', newUrl)
      currentPageUrl = newUrl

      mustardState.notes = []
      browser.runtime
        .sendMessage(createQueryNotesMessage(newUrl))
        .then((dtos: DtoMustardNote[]) => {
          console.debug('mustard [content-script] received notes for new URL:', dtos)
          const notes = (dtos ?? []).map(DtoMustardNote.fromDto)
          mustardState.notes = notes
          fetchProfilesForNotes(notes)
        })
        .catch(() => {})
    }

    window.addEventListener('popstate', handleUrlChange)

    // Inject script into page's main world to intercept pushState/replaceState
    const injectedScript = document.createElement('script')
    injectedScript.src = browser.runtime.getURL('/url-change-detector.js')
    document.documentElement.appendChild(injectedScript)

    window.addEventListener('mustard-url-change', handleUrlChange)

    let lastContextMenuData: MustardNoteAnchorData | null = null
    let lastContextMenuTarget: HTMLElement | null = null

    const HIGHLIGHT_CLASS = 'mustard-highlight'

    function applyHighlight() {
      if (lastContextMenuTarget) {
        lastContextMenuTarget.classList.add(HIGHLIGHT_CLASS)
      }
    }

    function removeHighlight() {
      if (lastContextMenuTarget) {
        lastContextMenuTarget.classList.remove(HIGHLIGHT_CLASS)
      }
    }

    // Handle messages from service worker and popup.
    // Returning a Promise from the listener works on both Chrome (99+) and Firefox.
    browser.runtime.onMessage.addListener((message: Message) => {
      console.debug('mustard [content-script] onMessage:', message)
      if (message.type === 'GET_NOTES_VISIBLE') {
        return Promise.resolve(mustardState.areNotesVisible)
      }
      if (message.type === 'SET_NOTES_VISIBLE') {
        mustardState.areNotesVisible = message.visible
        return Promise.resolve(mustardState.areNotesVisible)
      }
      if (message.type === 'OPEN_NOTE_EDITOR') {
        if (!mustardState.areNotesVisible) {
          mustardState.areNotesVisible = true
        }
        mustardState.editor.anchor = lastContextMenuData
        mustardState.editor.isOpen = true
        return
      }
      if (message.type === 'SESSION_EXPIRED') {
        showSessionExpiredBanner()
        return
      }
      if (message.type === 'SESSION_CHANGED') {
        mustardState.currentUserDid = message.did
        if (message.did) {
          document.getElementById('mustard-session-expired-banner')?.remove()
        }
        browser.runtime
          .sendMessage(createQueryNotesMessage(getCurrentPageUrl()))
          .then((dtos: DtoMustardNote[]) => {
            console.debug('mustard [content-script] received notes after session change:', dtos)
            const notes = (dtos ?? []).map(DtoMustardNote.fromDto)
            mustardState.notes = notes
            fetchProfilesForNotes(notes)
          })
          .catch(() => {})
        return
      }
    })

    // Fetch current session
    browser.runtime
      .sendMessage(createGetAtprotoSessionMessage())
      .then((response: AtprotoSessionResponse) => {
        console.debug('mustard [content-script] session:', response)
        mustardState.currentUserDid = response?.did ?? null
      })
      .catch(() => {})

    // Load preferences from storage
    browser.storage.local
      .get([NOTES_MINIMIZED_KEY, SHOW_ANCHOR_IN_EDITOR_KEY])
      .then((result) => {
        mustardState.areNotesMinimized = !!result[NOTES_MINIMIZED_KEY]
        mustardState.showAnchorInEditor = !!result[SHOW_ANCHOR_IN_EDITOR_KEY]
      })
      .catch(() => {})

    // Keep in sync when preferences are changed from popup or options page
    browser.storage.onChanged.addListener((changes) => {
      if (NOTES_MINIMIZED_KEY in changes) {
        mustardState.areNotesMinimized = !!changes[NOTES_MINIMIZED_KEY].newValue
      }
      if (SHOW_ANCHOR_IN_EDITOR_KEY in changes) {
        mustardState.showAnchorInEditor = !!changes[SHOW_ANCHOR_IN_EDITOR_KEY].newValue
      }
    })

    // Query notes for the current page
    browser.runtime
      .sendMessage(createQueryNotesMessage(getCurrentPageUrl()))
      .then((dtos: DtoMustardNote[]) => {
        console.debug('mustard [content-script] received notes:', dtos)
        const notes = (dtos ?? []).map(DtoMustardNote.fromDto)
        mustardState.notes = notes
        fetchProfilesForNotes(notes)
      })
      .catch(() => {})

    function showSessionExpiredBanner() {
      if (document.getElementById('mustard-session-expired-banner')) return
      const banner = document.createElement('div')
      banner.id = 'mustard-session-expired-banner'
      banner.style.cssText =
        'position:fixed;top:0;left:50%;transform:translateX(-50%);background:#ffb800;color:#3d2200;' +
        'padding:8px 20px;border-radius:0 0 10px 10px;font-family:monospace;font-size:13px;font-weight:600;' +
        'z-index:2147483647;box-shadow:0 2px 8px rgba(0,0,0,0.25);cursor:pointer;display:flex;align-items:center;gap:8px'
      const icon = document.createElement('img')
      icon.src = mustardIconUrl
      icon.style.cssText = 'width:24px;height:24px;flex-shrink:0'
      const text = document.createElement('span')
      text.textContent = 'Mustard session expired — open the Mustard extension menu to re-login'
      banner.appendChild(icon)
      banner.appendChild(text)
      banner.onclick = () => {
        banner.remove()
        browser.runtime.sendMessage({ type: 'OPEN_POPUP' }).catch(() => {})
      }
      document.body.appendChild(banner)
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

    const app = createApp(MustardContent)
    const event = new Observable<Message>()
    app.provide('mustardState', mustardState)
    app.provide('event', event)
    app.mount(mustardHost)

    watch(
      () => mustardState.editor.isOpen,
      (isOpen) => {
        if (isOpen) {
          applyHighlight()
        } else {
          removeHighlight()
        }
      },
    )

    // When extension context is invalidated (hot-reload / update), unmount and prompt refresh.
    function handlePotentialInvalidation() {
      if (!browser.runtime.id) {
        app.unmount()
        mustardHost.remove()
        showRefreshBanner()
        window.removeEventListener('mousemove', handlePotentialInvalidation)
        window.removeEventListener('keydown', handlePotentialInvalidation)
      }
    }
    window.addEventListener('mousemove', handlePotentialInvalidation, { passive: true })
    window.addEventListener('keydown', handlePotentialInvalidation, { passive: true })

    // content-script acts as message relay between the vue app and the service worker.
    // Strip Vue reactive Proxies before sending — Firefox's structuredClone rejects them.
    const toPlain = <T>(value: T): T => JSON.parse(JSON.stringify(value))

    event.subscribe((message) => {
      if (message.type === 'UPSERT_NOTE') {
        const isLocalOperation = message.target === 'local'
        browser.runtime
          .sendMessage(toPlain(message))
          .then((dtos: DtoMustardNote[]) => {
            console.debug('mustard [content-script] received notes after upsert:', dtos)
            const newNotes = (dtos ?? []).map(DtoMustardNote.fromDto)
            if (isLocalOperation) {
              const remoteNotes = mustardState.notes.filter((n) => n.authorId !== 'local')
              mustardState.notes = [...newNotes, ...remoteNotes]
            } else {
              mustardState.notes = newNotes
              fetchProfilesForNotes(newNotes)
            }
            clearPendingNoteIds()
          })
          .catch((err) => {
            console.error('mustard [content-script] UPSERT_NOTE failed:', err)
          })
      }

      if (message.type === 'DELETE_NOTE') {
        const isLocalDelete = message.authorId === 'local'
        browser.runtime
          .sendMessage(toPlain(message))
          .then((dtos: DtoMustardNote[]) => {
            console.debug('mustard [content-script] received notes after delete:', dtos)
            const newNotes = (dtos ?? []).map(DtoMustardNote.fromDto)
            if (isLocalDelete) {
              const remoteNotes = mustardState.notes.filter((n) => n.authorId !== 'local')
              mustardState.notes = [...newNotes, ...remoteNotes]
            } else {
              mustardState.notes = newNotes
            }
            clearPendingNoteIds()
          })
          .catch((err) => {
            console.error('mustard [content-script] DELETE_NOTE failed:', err)
          })
      }
    })

    // Capture context menu data when right-clicking
    document.addEventListener('contextmenu', (event) => {
      const target = event.target as HTMLElement
      const rect = target.getBoundingClientRect()

      removeHighlight()
      lastContextMenuTarget = target

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
  },
})

function normalizePageUrl(url: string): string {
  const u = new URL(url)
  return `${u.origin}${u.pathname}`
}

function generateSelector(element: HTMLElement): string | null {
  if (element === document.body || element === document.documentElement) return null
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

  const needsBodyPrefix = path.length > 0 && !path[0]!.startsWith('#')
  const selector = needsBodyPrefix ? `body > ${path.join(' > ')}` : path.join(' > ')

  if (selector.length > LIMITS.SELECTOR_MAX_LENGTH) return null

  try {
    document.querySelector(selector)
    return selector
  } catch {
    return null
  }
}
