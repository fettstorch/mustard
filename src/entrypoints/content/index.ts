import {
  createQueryNotesMessage,
  createGetAtprotoSessionMessage,
  createGetProfilesMessage,
  createQueryCommentsMessage,
  createQueryNotificationsForNotesMessage,
  createMarkNotificationsSeenForNoteMessage,
  createGetAppStatusMessage,
  createRequestUpdateMessage,
  sendMessage,
  type Message,
} from '@/shared/messaging'
import { isRemoteMutationMessage } from '@/shared/remote-mutation'
import type { MustardNoteAnchorData } from '@/shared/model/MustardNoteAnchorData'
import { LIMITS } from '@/shared/constants'
import { extractMentions, type MentionTarget } from '@/shared/mentions'
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
import { showMustardToast } from './mustard-toast'
import type { MustardNote } from '@/shared/model/MustardNote'
import type { MustardComment } from '@/shared/model/MustardComment'
import { Observable, synchronize } from '@fettstorch/jule'
import { createApp, watch } from 'vue'

const NOTES_MINIMIZED_KEY = 'mustard-notes-minimized'
const SHOW_ANCHOR_IN_EDITOR_KEY = 'mustard-show-anchor-in-editor'
const ALT_CLICK_ENABLED_KEY = 'mustard-alt-click-enabled'

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

    // Client-version guard: when the backend declares a higher minimum version
    // than this build, the extension is too old to write safely. The flag lives
    // on mustardState so the Vue editors can disable publish/comment controls
    // (preventing optimistic teardown + draft loss); the event chokepoint below
    // is the defense-in-depth backstop, and reads are left alone (best-effort).

    function clearPendingNoteIds() {
      Object.keys(mustardState.pendingNoteIds).forEach(
        (key) => delete mustardState.pendingNoteIds[key],
      )
    }

    /**
     * Fetches uncached profiles. `userIds` are opaque Mustard UUIDs (authors,
     * reposters, self); `mentions` are provider-tagged account ids from mention
     * sentinels. Both are deduped against the profile cache (keyed by the id we
     * look up by — UUID for users, accountId for mentions).
     */
    function fetchProfiles(opts: { userIds?: string[]; mentions?: MentionTarget[] }) {
      const userIds = [
        ...new Set(
          (opts.userIds ?? []).filter((id) => id !== 'local' && !(id in mustardState.profiles)),
        ),
      ]
      const seenMentions = new Set<string>()
      const mentions = (opts.mentions ?? []).filter((m) => {
        if (m.accountId in mustardState.profiles || seenMentions.has(m.accountId)) return false
        seenMentions.add(m.accountId)
        return true
      })
      if (userIds.length === 0 && mentions.length === 0) return

      sendMessage(createGetProfilesMessage(userIds, mentions))
        .then((response) => {
          console.debug('mustard [content-script] received profiles:', response)
          Object.assign(mustardState.profiles, response ?? {})
        })
        .catch(() => {})
    }

    /** Fetches profiles for remote note authors + reposters + mentioned users that aren't already cached */
    function fetchProfilesForNotes(notes: MustardNote[]) {
      const userIds = notes
        .filter((n) => n.authorId !== 'local')
        .flatMap((n) => [n.authorId, ...n.reposterIds])
      const mentions = notes.flatMap((n) => extractMentions(n.content))
      fetchProfiles({ userIds, mentions })
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
          const authorIds: string[] = []
          const mentions: MentionTarget[] = []
          for (const noteId of remoteNoteIds) {
            const dtos = (response ?? {})[noteId] ?? []
            const comments: MustardComment[] = dtos.map(DtoMustardComment.fromDto)
            mustardState.comments[noteId] = comments
            mustardState.commentsLoadState[noteId] = 'loaded'
            for (const c of comments) {
              authorIds.push(c.authorId)
              mentions.push(...extractMentions(c.content))
            }
          }
          fetchProfiles({ userIds: authorIds, mentions })
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

      if (remoteNoteIds.length === 0 || !mustardState.currentUserId) {
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
     * Issue one QUERY_NOTES and apply its response, serialized across all
     * callers. `synchronize` runs invocations FIFO, so each query's apply
     * completes before the next begins — the most recently issued query always
     * wins. This prevents an earlier in-flight follow-only response from landing
     * after (and clobbering) a later query, e.g. the one-shot "show all notes"
     * load being overwritten by a slow page-load / SESSION_CHANGED query.
     * Returns the resulting on-screen note count.
     */
    const runNotesQuery = synchronize(
      async (
        pageUrl: string,
        options?: { includeAllAuthors?: boolean; withComments?: boolean },
      ): Promise<number> => {
        const dtos = await sendMessage(createQueryNotesMessage(pageUrl, options?.includeAllAuthors))
        applyNotesResponse(dtos, { withComments: options?.withComments })
        return mustardState.notes.length
      },
    )

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

    /**
     * Optimistically render a brand-new remote note the instant the user hits
     * publish, before the network write returns — so latency never shows as a
     * blank gap. Assigns a temporary `optimistic-…` id; the real server row
     * (from the UPSERT_NOTE response) swaps in later via mergeRemoteUpsertResponse,
     * or removeOptimisticNote tears it down if the publish fails.
     * Returns the temp id, or undefined if we can't attribute an author.
     */
    function insertOptimisticNote(
      data: Omit<DtoMustardNote, 'id' | 'authorId'>,
    ): string | undefined {
      const authorId = mustardState.currentUserId
      if (!authorId) return undefined

      const tempId = `optimistic-${crypto.randomUUID()}`
      // Deep-clone: `data.anchorData` is the editor's reactive object, which the
      // editor may reuse/reset before we reconcile. Detach so our stored note is
      // a stable, plain snapshot (same reason sendMessage strips proxies).
      const snapshot = JSON.parse(JSON.stringify(data)) as Omit<DtoMustardNote, 'id' | 'authorId'>
      const note = DtoMustardNote.fromDto({ ...snapshot, id: tempId, authorId })
      mustardState.notes = [...mustardState.notes, note]
      // Pending → action buttons (delete/repost) stay disabled until confirmed.
      mustardState.pendingNoteIds[tempId] = true
      // A brand-new note has no comments; mark loaded-empty so the toggle works.
      mustardState.comments[tempId] = []
      mustardState.commentsLoadState[tempId] = 'loaded'
      fetchProfilesForNotes([note])
      return tempId
    }

    /** Tear down an optimistic placeholder (publish failed). */
    function removeOptimisticNote(tempId: string): void {
      mustardState.notes = mustardState.notes.filter((n) => n.id !== tempId)
      delete mustardState.pendingNoteIds[tempId]
      delete mustardState.comments[tempId]
      delete mustardState.commentsLoadState[tempId]
    }

    /**
     * Merge a single freshly-published remote note (returned by UPSERT_NOTE)
     * into state without a full index re-query. Drops any prior copy (update
     * case) plus the given stale placeholders — the optimistic temp note and/or
     * the local note it was converted from — then appends the real row (newest →
     * renders on top). A brand-new note has no comments yet, so we mark its
     * thread loaded-empty to make the toggle interactive immediately.
     */
    function mergeRemoteUpsertResponse(
      dtos: DtoMustardNote[] | undefined,
      staleIds: (string | undefined)[] = [],
    ): void {
      const created = (dtos ?? []).map(DtoMustardNote.fromDto)
      if (created.length === 0) return

      const drop = new Set<string>(created.map((n) => n.id).filter((id): id is string => !!id))
      for (const id of staleIds) if (id) drop.add(id)

      const kept = mustardState.notes.filter((n) => !n.id || !drop.has(n.id))
      mustardState.notes = [...kept, ...created]

      // Retire placeholder comment/pending state we just dropped.
      for (const id of staleIds) {
        if (!id) continue
        delete mustardState.comments[id]
        delete mustardState.commentsLoadState[id]
        delete mustardState.pendingNoteIds[id]
      }

      fetchProfilesForNotes(created)
      for (const n of created) {
        if (!n.id) continue
        if (!mustardState.comments[n.id]) mustardState.comments[n.id] = []
        mustardState.commentsLoadState[n.id] = 'loaded'
      }
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
        if (mustardState.unreadByNoteId[id] && !mustardState.clientOutdated) {
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
      runNotesQuery(newUrl, { withComments: true }).catch(() => {})
    }

    window.addEventListener('popstate', handleUrlChange)

    // Inject script into page's main world to intercept pushState/replaceState
    const injectedScript = document.createElement('script')
    injectedScript.src = browser.runtime.getURL('/url-change-detector.js')
    document.documentElement.appendChild(injectedScript)

    window.addEventListener('mustard-url-change', handleUrlChange)

    let lastContextMenuData: MustardNoteAnchorData | null = null
    let lastContextMenuTarget: HTMLElement | null = null
    let isAltPressed = false
    let altClickEnabled = false
    let altBadge: HTMLElement | null = null
    let lastMouseX = 0
    let lastMouseY = 0

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

    function createAltBadge(): HTMLElement {
      const badge = document.createElement('div')
      badge.id = 'mustard-alt-badge'
      badge.textContent = 'Click to create mustard note'
      badge.style.position = 'fixed'
      badge.style.padding = '8px 12px'
      badge.style.borderRadius = '6px'
      badge.style.fontSize = '12px'
      badge.style.fontWeight = '500'
      badge.style.pointerEvents = 'none'
      badge.style.zIndex = '2147483647'
      badge.style.boxShadow = '0 2px 8px rgba(0, 0, 0, 0.15)'
      badge.style.whiteSpace = 'nowrap'
      badge.style.transform = 'translate(10px, 10px)'
      document.body.appendChild(badge)
      return badge
    }

    function updateAltBadgePosition(clientX: number, clientY: number) {
      if (!altBadge) return
      altBadge.style.left = clientX + 'px'
      altBadge.style.top = clientY + 'px'
    }

    function showAltBadge(clientX: number, clientY: number) {
      if (!altBadge) {
        altBadge = createAltBadge()
      }
      const bgColor =
        getComputedStyle(mustardHost).getPropertyValue('--mustard-yellow-light').trim() || '#ffe066'
      const textColor =
        getComputedStyle(mustardHost).getPropertyValue('--mustard-text').trim() || '#3d2200'
      altBadge.style.background = bgColor
      altBadge.style.color = textColor
      updateAltBadgePosition(clientX, clientY)
      altBadge.style.display = 'block'
    }

    function hideAltBadge() {
      if (altBadge) {
        altBadge.style.display = 'none'
      }
    }

    function captureAnchorData(event: MouseEvent): MustardNoteAnchorData {
      const target = event.target as HTMLElement
      const rect = target.getBoundingClientRect()
      removeHighlight()
      lastContextMenuTarget = target
      return {
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
    }

    function openNoteEditor(anchor: MustardNoteAnchorData | null) {
      if (!mustardState.areNotesVisible) {
        mustardState.areNotesVisible = true
      }
      mustardState.editor.anchor = anchor
      mustardState.editor.isOpen = true
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
      if (message.type === 'LOAD_ALL_NOTES') {
        // One-shot: re-query the current page ignoring the follow graph, render
        // the result, and report the count back so the popup can show an
        // empty-state message when nothing was found. Ensure notes are visible
        // so a hidden-notes toggle doesn't make a successful load look empty.
        // `withToast` (keyboard-shortcut path) shows on-page feedback since no
        // popup is open to render it.
        const withToast = message.withToast === true
        mustardState.areNotesVisible = true
        // Loading all notes needs a logged-in session (author profiles resolve
        // via the authenticated path). On the shortcut path, nudge instead of
        // silently doing nothing.
        if (!mustardState.currentUserId) {
          if (withToast) showLoadAllNotesToast('Log in to Mustard to see all notes on this page')
          return Promise.resolve(0)
        }
        return (async (): Promise<number> => {
          try {
            const count = await runNotesQuery(getCurrentPageUrl(), {
              includeAllAuthors: true,
              withComments: true,
            })
            if (withToast) {
              showLoadAllNotesToast(
                count > 0
                  ? `Showing all ${count} note${count === 1 ? '' : 's'} on this page`
                  : 'No mustard here yet — be the first to add a note on this page!',
              )
            }
            return count
          } catch {
            return 0
          }
        })()
      }
      if (message.type === 'OPEN_NOTE_EDITOR') {
        openNoteEditor(lastContextMenuData)
        return
      }
      if (message.type === 'SESSION_EXPIRED') {
        showSessionExpiredBanner()
        return
      }
      if (message.type === 'SESSION_CHANGED') {
        mustardState.currentUserId = message.userId
        mustardState.connectedProviders = message.providers
        if (message.userId) {
          document.getElementById('mustard-session-expired-banner')?.remove()
          fetchProfiles({ userIds: [message.userId] })
        }
        // Session change can change which notes are visible (follows differ),
        // so clear per-note client state to avoid stale dots / comments.
        mustardState.unreadByNoteId = {}
        runNotesQuery(getCurrentPageUrl(), { withComments: true }).catch(() => {})
        return
      }
      if (message.type === 'NOTIFICATIONS_CHANGED') {
        // Re-fetch unread counts only — comments didn't change.
        fetchUnreadForNotes(mustardState.notes)
        return
      }
    })

    // Client-version guard: if the backend has moved past this build, flag the
    // client as outdated and surface the update banner. Fail-open: any error
    // leaves the client usable.
    sendMessage(createGetAppStatusMessage())
      .then((status) => {
        if (status?.outdated) {
          mustardState.clientOutdated = true
          showUpdateRequiredBanner()
        }
      })
      .catch(() => {})

    // Fetch current session
    sendMessage(createGetAtprotoSessionMessage())
      .then((response) => {
        console.debug('mustard [content-script] session:', response)
        mustardState.currentUserId = response?.userId ?? null
        mustardState.connectedProviders = [
          ...new Set(response?.identities?.map((i) => i.provider) ?? []),
        ]
        // Eagerly resolve the current user's profile so the comment editor can
        // render their avatar next to the input (and any other UI that wants it).
        if (response?.userId) fetchProfiles({ userIds: [response.userId] })
        fetchUnreadForNotes(mustardState.notes)
      })
      .catch(() => {})

    // Load preferences from storage
    browser.storage.local
      .get([NOTES_MINIMIZED_KEY, SHOW_ANCHOR_IN_EDITOR_KEY, ALT_CLICK_ENABLED_KEY])
      .then((result) => {
        mustardState.areNotesMinimized = !!result[NOTES_MINIMIZED_KEY]
        mustardState.showAnchorInEditor = !!result[SHOW_ANCHOR_IN_EDITOR_KEY]
        altClickEnabled = !!result[ALT_CLICK_ENABLED_KEY]
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
      if (ALT_CLICK_ENABLED_KEY in changes) {
        altClickEnabled = !!changes[ALT_CLICK_ENABLED_KEY].newValue
        // Disabling mid-press shouldn't leave the badge stuck on screen.
        if (!altClickEnabled && isAltPressed) {
          isAltPressed = false
          hideAltBadge()
        }
      }
      if (MUSTARD_FONT_KEY in changes) {
        applySelectedFont(changes[MUSTARD_FONT_KEY].newValue as string | undefined)
      }
      if (MUSTARD_THEME_KEY in changes) {
        applySelectedTheme(changes[MUSTARD_THEME_KEY].newValue as string | undefined)
      }
    })

    // Query notes for the current page
    runNotesQuery(getCurrentPageUrl(), { withComments: true })
      .then(() => maybeApplyPendingFocus())
      .catch(() => {})

    function showSessionExpiredBanner() {
      showMustardToast({
        id: 'mustard-session-expired-banner',
        text: 'Mustard session expired — open the Mustard extension menu to re-login',
        onClick: (dismiss) => {
          dismiss()
          sendMessage({ type: 'OPEN_POPUP' }).catch(() => {})
        },
      })
    }

    function showUpdateRequiredBanner() {
      showMustardToast({
        id: 'mustard-update-required-banner',
        text: 'Big changes! Mustard needs an update to keep working — click here to update, or do it from your browser’s extensions page. You might also need to re-login from the Mustard menu afterwards.',
        onClick: () => {
          sendMessage(createRequestUpdateMessage()).catch(() => {})
        },
      })
    }

    // Transient, auto-dismissing feedback for the "show all notes" keyboard
    // shortcut (the popup — which normally renders this — isn't open).
    function showLoadAllNotesToast(text: string) {
      showMustardToast({ id: 'mustard-load-all-toast', text, autoDismissMs: 4000 })
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

    // content-script acts as message relay between the vue app and the service
    // worker. `sendMessage` strips Vue reactive Proxies before sending (Firefox's
    // structuredClone rejects them) and types the response by message type.
    event.subscribe((message) => {
      // Guard: block remote mutations from an outdated client (local notes are
      // fine — they never touch the backend). Clear any optimistic pending state
      // the UI set before emitting, and (re)show the update banner.
      if (mustardState.clientOutdated && isRemoteMutationMessage(message)) {
        clearPendingNoteIds()
        showUpdateRequiredBanner()
        return
      }

      if (message.type === 'UPSERT_NOTE') {
        const isLocalOperation = message.target === 'local'
        // Fresh remote publish (not converting an existing local note, which is
        // already on screen) → paint an optimistic placeholder now so the note
        // never waits on network latency to appear.
        const optimisticId =
          !isLocalOperation && !message.localNoteIdToDelete
            ? insertOptimisticNote(message.data)
            : undefined
        sendMessage(message)
          .then((dtos) => {
            console.debug('mustard [content-script] received notes after upsert:', dtos)
            // Local saves swap only local notes. A remote publish returns just
            // the newly-created note (no index re-query) — merge it in place,
            // retiring the optimistic placeholder and/or converted local note.
            if (isLocalOperation) applyLocalNotesResponse(dtos)
            else mergeRemoteUpsertResponse(dtos, [optimisticId, message.localNoteIdToDelete])
            clearPendingNoteIds()
          })
          .catch((err) => {
            console.error('mustard [content-script] UPSERT_NOTE failed:', err)
            // Roll back the optimistic note so a failed publish leaves no ghost.
            if (optimisticId) removeOptimisticNote(optimisticId)
            clearPendingNoteIds()
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
            fetchProfiles({
              userIds: comments.map((c) => c.authorId),
              mentions: comments.flatMap((c) => extractMentions(c.content)),
            })
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
      lastContextMenuData = captureAnchorData(event)
    })

    // Track mouse position globally
    document.addEventListener('mousemove', (event) => {
      lastMouseX = event.clientX
      lastMouseY = event.clientY
      if (!altClickEnabled) return
      if (event.altKey && !isAltPressed) {
        isAltPressed = true
        showAltBadge(lastMouseX, lastMouseY)
      } else if (!event.altKey && isAltPressed) {
        isAltPressed = false
        hideAltBadge()
      } else if (isAltPressed) {
        updateAltBadgePosition(lastMouseX, lastMouseY)
      }
    })

    // Handle Alt key for Alt+Click note creation
    document.addEventListener('keydown', (event) => {
      if (!altClickEnabled) return
      if (event.key === 'Alt' && !isAltPressed) {
        isAltPressed = true
        showAltBadge(lastMouseX, lastMouseY)
      }
    })

    document.addEventListener('keyup', (event) => {
      if (!event.altKey && isAltPressed) {
        isAltPressed = false
        hideAltBadge()
      }
    })

    // Handle window blur to reset Alt state
    window.addEventListener('blur', () => {
      if (isAltPressed) {
        isAltPressed = false
        hideAltBadge()
      }
    })

    // Create note on Alt+Click
    document.addEventListener(
      'click',
      (event) => {
        if (!isAltPressed) return

        event.preventDefault()
        event.stopPropagation()

        isAltPressed = false
        hideAltBadge()

        lastContextMenuData = captureAnchorData(event)
        openNoteEditor(lastContextMenuData)
      },
      true,
    )
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
