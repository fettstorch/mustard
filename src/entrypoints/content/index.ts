import mustardIconUrl from '@/assets/icons/mustard_bottle_smile_48.png'
import {
  createQueryNotesMessage,
  createGetAtprotoSessionMessage,
  createGetProfilesMessage,
  createQueryCommentsMessage,
  createQueryNotificationsForNotesMessage,
  createMarkNotificationsSeenForNoteMessage,
  sendMessage,
  type Message,
} from '@/shared/messaging'
import type { MustardNoteAnchorData } from '@/shared/model/MustardNoteAnchorData'
import { LIMITS } from '@/shared/constants'
import { extractMentionDids } from '@/shared/mentions'
import { PENDING_FOCUS_KEY, type PendingFocus } from '@/shared/pending-focus'
import { MUSTARD_FONT_KEY, getFontById, ensureFontStylesheet, applyFontVar } from '@/shared/fonts'
import {
  MUSTARD_THEME_KEY,
  getThemeById,
  applyTheme,
  getThemeHighlightColor,
} from '@/shared/themes'
import { DtoMustardNote } from '@/shared/dto/DtoMustardNote'
import { DtoMustardComment } from '@/shared/dto/DtoMustardComment'
import MustardContent from '@/ui/content/MustardContent.vue'
import { createMustardState } from '@/ui/content/mustard-state'
import type { MustardNote } from '@/shared/model/MustardNote'
import type { MustardComment } from '@/shared/model/MustardComment'
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

    /** Fetches profiles for a set of user IDs that aren't already cached */
    function fetchProfiles(userIds: string[]) {
      const uniqueIds = [
        ...new Set(userIds.filter((id) => id !== 'local' && !(id in mustardState.profiles))),
      ]
      if (uniqueIds.length === 0) return

      sendMessage(createGetProfilesMessage(uniqueIds))
        .then((response) => {
          console.debug('mustard [content-script] received profiles:', response)
          Object.assign(mustardState.profiles, response ?? {})
        })
        .catch(() => {})
    }

    /** Fetches profiles for remote note authors + reposters + mentioned users that aren't already cached */
    function fetchProfilesForNotes(notes: MustardNote[]) {
      const ids = notes
        .filter((n) => n.authorId !== 'local')
        .flatMap((n) => [n.authorId, ...n.reposterIds])
      // Mentioned DIDs (from `@[did]` sentinels) so mentions resolve to handles.
      const mentionIds = notes.flatMap((n) => extractMentionDids(n.content))
      fetchProfiles([...ids, ...mentionIds])
    }

    function collectRemoteNoteIds(notes: MustardNote[]): string[] {
      return notes.filter((n) => n.authorId !== 'local' && n.id).map((n) => n.id as string)
    }

    /** Fetch comments for the given remote note ids (populates state + author profiles). */
    function fetchCommentsForNotes(notes: MustardNote[]) {
      const remoteNoteIds = collectRemoteNoteIds(notes)

      if (remoteNoteIds.length === 0) {
        mustardState.comments = {}
        mustardState.commentsLoadState = {}
        return
      }

      // Mark all as loading. Existing rows stay so the UI doesn't flicker.
      for (const id of remoteNoteIds) {
        if (!mustardState.commentsLoadState[id]) {
          mustardState.commentsLoadState[id] = 'loading'
        }
      }

      sendMessage(createQueryCommentsMessage(remoteNoteIds))
        .then((response) => {
          console.debug('mustard [content-script] received comments:', response)
          const allAuthorIds: string[] = []
          for (const noteId of remoteNoteIds) {
            const dtos = (response ?? {})[noteId] ?? []
            const comments: MustardComment[] = dtos.map(DtoMustardComment.fromDto)
            mustardState.comments[noteId] = comments
            mustardState.commentsLoadState[noteId] = 'loaded'
            for (const c of comments) {
              allAuthorIds.push(c.authorId)
              // Mentioned DIDs in the comment so @-mentions resolve to handles.
              allAuthorIds.push(...extractMentionDids(c.content))
            }
          }
          if (allAuthorIds.length > 0) fetchProfiles(allAuthorIds)
        })
        .catch((err) => {
          console.error('mustard [content-script] QUERY_COMMENTS failed:', err)
          for (const id of remoteNoteIds) {
            mustardState.commentsLoadState[id] = 'loaded'
          }
        })
    }

    /** Fetch unread-notification counts for the given remote note ids. */
    function fetchUnreadForNotes(notes: MustardNote[]) {
      const remoteNoteIds = collectRemoteNoteIds(notes)

      if (remoteNoteIds.length === 0 || !mustardState.currentUserDid) {
        mustardState.unreadByNoteId = {}
        return
      }

      sendMessage(createQueryNotificationsForNotesMessage(remoteNoteIds))
        .then((response) => {
          console.debug('mustard [content-script] received notification counts:', response)
          // Replace entirely so previously-unread-but-now-acknowledged notes lose their dot.
          const next: Record<string, number> = {}
          for (const [noteId, count] of Object.entries(response ?? {})) {
            if (count > 0) next[noteId] = count
          }
          mustardState.unreadByNoteId = next
          maybeApplyPendingFocus()
        })
        .catch((err) => {
          console.error('mustard [content-script] QUERY_NOTIFICATIONS_FOR_NOTES failed:', err)
        })
    }

    /**
     * Convenience wrapper: comments + notifications in parallel, used right
     * after notes are loaded for a page so the UI populates progressively.
     */
    function fetchCommentsAndNotificationsForNotes(notes: MustardNote[]) {
      fetchCommentsForNotes(notes)
      fetchUnreadForNotes(notes)
    }

    /**
     * Apply a fresh full notes list (from a QUERY/UPSERT/REPOST response) to
     * state and fan out the dependent fetches. `withComments` is opt-in because
     * some flows (e.g. repost, delete) don't need a comment/notification refresh.
     */
    function applyNotesResponse(
      dtos: DtoMustardNote[] | undefined,
      options?: { withComments?: boolean },
    ): void {
      const notes = (dtos ?? []).map(DtoMustardNote.fromDto)
      mustardState.notes = notes
      fetchProfilesForNotes(notes)
      if (options?.withComments) fetchCommentsAndNotificationsForNotes(notes)
    }

    /**
     * Apply a local-only notes response: the background returns just the local
     * notes (fast path, no network), so we keep the already-loaded remote notes
     * in place and swap only the local ones.
     */
    function applyLocalNotesResponse(dtos: DtoMustardNote[] | undefined): void {
      const localNotes = (dtos ?? []).map(DtoMustardNote.fromDto)
      const remoteNotes = mustardState.notes.filter((n) => n.authorId !== 'local')
      mustardState.notes = [...localNotes, ...remoteNotes]
    }

    let currentPageUrl = normalizePageUrl(window.location.href)

    function getCurrentPageUrl(): string {
      return currentPageUrl
    }

    // --- Pending focus (deep-link from the popup) ---
    // The popup writes a PendingFocus before opening a page; we consume it once
    // here to expand the relevant comment thread(s) and scroll the note into
    // view. It's retried as notes/unread-counts arrive (whichever the focus
    // needs) and cleared after it successfully applies.
    let pendingFocus: PendingFocus | null = null

    function scrollToNote(noteId: string): void {
      const note = mustardState.notes.find((n) => n.id === noteId)
      if (!note) return
      // The note is fixed-positioned at its host-page anchor, so bringing the
      // anchor element into view brings the note with it. Fall back to the
      // recorded click position when the anchor element can't be found.
      requestAnimationFrame(() => {
        const selector = note.anchorData.elementSelector
        const el = selector ? document.querySelector<HTMLElement>(selector) : null
        if (el) {
          el.scrollIntoView({ behavior: 'smooth', block: 'center' })
        } else {
          const top = note.anchorData.clickPosition.yPx - window.innerHeight / 2
          window.scrollTo({ top: Math.max(0, top), behavior: 'smooth' })
        }
      })
    }

    function maybeApplyPendingFocus(): void {
      if (!pendingFocus || pendingFocus.pageUrl !== getCurrentPageUrl()) return
      if (mustardState.notes.length === 0) return // wait for notes to load

      let targetIds: string[]
      const targetNoteId = pendingFocus.noteId
      if (targetNoteId) {
        // Bail (don't keep waiting) if the note simply isn't visible to this user.
        if (!mustardState.notes.some((n) => n.id === targetNoteId)) {
          pendingFocus = null
          return
        }
        targetIds = [targetNoteId]
      } else {
        // Page-row case: focus notes that currently have unread comments. If
        // none are loaded yet, wait — fetchUnreadForNotes will retry us.
        targetIds = Object.keys(mustardState.unreadByNoteId).filter(
          (id) => (mustardState.unreadByNoteId[id] ?? 0) > 0,
        )
        if (targetIds.length === 0) return
      }

      mustardState.areNotesVisible = true
      for (const id of targetIds) {
        mustardState.expandedCommentNoteIds[id] = true
        // Reading the thread acknowledges its unread comment notifications.
        // Routed through the same event the manual toggle uses, so the optimistic
        // clear + sendMessage stay in one canonical place.
        if (mustardState.unreadByNoteId[id]) {
          event.emit(createMarkNotificationsSeenForNoteMessage(id))
        }
      }
      scrollToNote(targetIds[0]!)
      pendingFocus = null
    }

    browser.storage.local
      .get(PENDING_FOCUS_KEY)
      .then((result) => {
        const focus = result[PENDING_FOCUS_KEY] as PendingFocus | undefined
        if (focus) {
          // One-shot: clear immediately so it never fires on later navigations.
          browser.storage.local.remove(PENDING_FOCUS_KEY).catch(() => {})
          if (focus.pageUrl === getCurrentPageUrl()) {
            pendingFocus = focus
            maybeApplyPendingFocus()
          }
        }
      })
      .catch(() => {})

    function handleUrlChange() {
      const newUrl = normalizePageUrl(window.location.href)
      if (newUrl === currentPageUrl) return

      console.debug('mustard [content-script] URL changed:', currentPageUrl, '->', newUrl)
      currentPageUrl = newUrl

      mustardState.notes = []
      mustardState.comments = {}
      mustardState.commentsLoadState = {}
      mustardState.expandedCommentNoteIds = {}
      mustardState.unreadByNoteId = {}
      sendMessage(createQueryNotesMessage(newUrl))
        .then((dtos) => {
          console.debug('mustard [content-script] received notes for new URL:', dtos)
          applyNotesResponse(dtos, { withComments: true })
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
      if (!lastContextMenuTarget) return
      lastContextMenuTarget.style.setProperty(
        '--mustard-yellow-mid',
        getThemeHighlightColor(mustardHost),
      )
      lastContextMenuTarget.classList.add(HIGHLIGHT_CLASS)
    }

    function removeHighlight() {
      if (!lastContextMenuTarget) return
      lastContextMenuTarget.classList.remove(HIGHLIGHT_CLASS)
      lastContextMenuTarget.style.removeProperty('--mustard-yellow-mid')
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
          fetchProfiles([message.did])
        }
        // Session change can change which notes are visible (follows differ),
        // so clear per-note client state to avoid stale dots / comments.
        mustardState.unreadByNoteId = {}
        sendMessage(createQueryNotesMessage(getCurrentPageUrl()))
          .then((dtos) => {
            console.debug('mustard [content-script] received notes after session change:', dtos)
            applyNotesResponse(dtos, { withComments: true })
          })
          .catch(() => {})
        return
      }
      if (message.type === 'NOTIFICATIONS_CHANGED') {
        // Re-fetch unread counts only — comments didn't change.
        fetchUnreadForNotes(mustardState.notes)
        return
      }
    })

    // Fetch current session
    sendMessage(createGetAtprotoSessionMessage())
      .then((response) => {
        console.debug('mustard [content-script] session:', response)
        mustardState.currentUserDid = response?.did ?? null
        // Eagerly resolve the current user's profile so the comment editor can
        // render their avatar next to the input (and any other UI that wants it).
        if (response?.did) fetchProfiles([response.did])
        fetchUnreadForNotes(mustardState.notes)
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
      if (MUSTARD_FONT_KEY in changes) {
        applySelectedFont(changes[MUSTARD_FONT_KEY].newValue as string | undefined)
      }
      if (MUSTARD_THEME_KEY in changes) {
        applySelectedTheme(changes[MUSTARD_THEME_KEY].newValue as string | undefined)
      }
    })

    // Query notes for the current page
    sendMessage(createQueryNotesMessage(getCurrentPageUrl()))
      .then((dtos) => {
        console.debug('mustard [content-script] received notes:', dtos)
        applyNotesResponse(dtos, { withComments: true })
        maybeApplyPendingFocus()
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
        sendMessage({ type: 'OPEN_POPUP' }).catch(() => {})
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

    // Apply the user's selected text font. The `--mustard-font` override is set
    // on the host element so it cascades to all Mustard UI without touching the
    // host page. Web fonts also need their stylesheet injected into the host
    // page <head> — note this download is subject to the host page's CSP, so on
    // strict-CSP sites it (silently) falls back to the generic family in the
    // stack. System fonts need no download and always apply.
    function applySelectedFont(id: string | undefined | null) {
      const font = getFontById(id)
      ensureFontStylesheet(document, font)
      applyFontVar(mustardHost, font)
    }
    function applySelectedTheme(id: string | undefined | null) {
      applyTheme(mustardHost, getThemeById(id))
      if (mustardState.editor.isOpen && lastContextMenuTarget) {
        lastContextMenuTarget.style.setProperty(
          '--mustard-yellow-mid',
          getThemeHighlightColor(mustardHost),
        )
      }
    }
    browser.storage.local
      .get([MUSTARD_FONT_KEY, MUSTARD_THEME_KEY])
      .then((result) => {
        applySelectedFont(result[MUSTARD_FONT_KEY] as string | undefined)
        applySelectedTheme(result[MUSTARD_THEME_KEY] as string | undefined)
      })
      .catch(() => {})

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

    // content-script acts as message relay between the vue app and the service
    // worker. `sendMessage` strips Vue reactive Proxies before sending (Firefox's
    // structuredClone rejects them) and types the response by message type.
    event.subscribe((message) => {
      if (message.type === 'UPSERT_NOTE') {
        const isLocalOperation = message.target === 'local'
        sendMessage(message)
          .then((dtos) => {
            console.debug('mustard [content-script] received notes after upsert:', dtos)
            // A new remote note populates comments too (so the toggle becomes
            // interactive); local saves keep the existing remote notes in place.
            if (isLocalOperation) applyLocalNotesResponse(dtos)
            else applyNotesResponse(dtos, { withComments: true })
            clearPendingNoteIds()
          })
          .catch((err) => {
            console.error('mustard [content-script] UPSERT_NOTE failed:', err)
          })
      }

      if (message.type === 'DELETE_NOTE') {
        const isLocalDelete = message.authorId === 'local'
        // Free per-note state immediately for the deleted note (best-effort).
        delete mustardState.comments[message.noteId]
        delete mustardState.commentsLoadState[message.noteId]
        delete mustardState.expandedCommentNoteIds[message.noteId]
        delete mustardState.unreadByNoteId[message.noteId]
        sendMessage(message)
          .then((dtos) => {
            console.debug('mustard [content-script] received notes after delete:', dtos)
            if (isLocalDelete) applyLocalNotesResponse(dtos)
            else applyNotesResponse(dtos)
            clearPendingNoteIds()
          })
          .catch((err) => {
            console.error('mustard [content-script] DELETE_NOTE failed:', err)
          })
      }

      if (message.type === 'SET_REPOST') {
        sendMessage(message)
          .then((dtos) => {
            console.debug('mustard [content-script] received notes after repost:', dtos)
            // Reposter avatars need their profiles resolved for the stack.
            applyNotesResponse(dtos)
          })
          .catch((err) => {
            console.error('mustard [content-script] SET_REPOST failed:', err)
          })
      }

      if (message.type === 'UPSERT_COMMENT') {
        mustardState.pendingCommentForNoteIds[message.noteId] = true
        sendMessage(message)
          .then((dtos) => {
            console.debug('mustard [content-script] received comments after upsert:', dtos)
            const comments = (dtos ?? []).map(DtoMustardComment.fromDto)
            mustardState.comments[message.noteId] = comments
            mustardState.commentsLoadState[message.noteId] = 'loaded'
            fetchProfiles([
              ...comments.map((c) => c.authorId),
              ...comments.flatMap((c) => extractMentionDids(c.content)),
            ])
          })
          .catch((err) => {
            console.error('mustard [content-script] UPSERT_COMMENT failed:', err)
          })
          .finally(() => {
            delete mustardState.pendingCommentForNoteIds[message.noteId]
          })
      }

      if (message.type === 'DELETE_COMMENT') {
        mustardState.pendingCommentIds[message.commentId] = true
        sendMessage(message)
          .then((dtos) => {
            console.debug('mustard [content-script] received comments after delete:', dtos)
            const comments = (dtos ?? []).map(DtoMustardComment.fromDto)
            mustardState.comments[message.noteId] = comments
            mustardState.commentsLoadState[message.noteId] = 'loaded'
          })
          .catch((err) => {
            console.error('mustard [content-script] DELETE_COMMENT failed:', err)
          })
          .finally(() => {
            delete mustardState.pendingCommentIds[message.commentId]
          })
      }

      if (message.type === 'MARK_NOTIFICATIONS_SEEN_FOR_NOTE') {
        // Optimistic clear; background also broadcasts NOTIFICATIONS_CHANGED.
        delete mustardState.unreadByNoteId[message.noteId]
        sendMessage(message).catch((err) => {
          console.error('mustard [content-script] MARK_NOTIFICATIONS_SEEN_FOR_NOTE failed:', err)
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
