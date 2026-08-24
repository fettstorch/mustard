import {
  createQueryNotesMessage,
  createQueryNotesForPagesMessage,
  createQueryNotesByIdsMessage,
  createQueryUnreadCommentNoteIdsMessage,
  createGetAtprotoSessionMessage,
  createGetProfilesMessage,
  createQueryCommentsMessage,
  createQueryNotificationsForNotesMessage,
  createMarkNotificationsSeenForNoteMessage,
  createGetAppStatusMessage,
  createRequestUpdateMessage,
  sendMessage,
  type Message,
  RATE_LIMIT_ERROR_CODE,
} from '@/shared/messaging'
import { isRemoteMutationMessage } from '@/shared/remote-mutation'
import { siteStrategyFor } from '@/shared/site-strategies'
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
import { showMustardToast } from '@/ui/content/mustard-toast'
import {
  HIDDEN_NOTES_KEY,
  readHiddenNoteIds,
  toHiddenNoteIds,
  type HiddenNotesStore,
} from '@/shared/hidden-notes'
import type { MustardNote } from '@/shared/model/MustardNote'
import type { MustardComment } from '@/shared/model/MustardComment'
import { getVideoElementAnchorData, isVideoAdShowing } from '@/shared/video-note'
import { isVideoElement } from '@/shared/video-element'
import { Observable, subject, synchronize } from '@fettstorch/jule'
import { createApp, watch } from 'vue'

const NOTES_MINIMIZED_KEY = 'mustard-notes-minimized'
const SHOW_ANCHOR_IN_EDITOR_KEY = 'mustard-show-anchor-in-editor'
const ALT_CLICK_ENABLED_KEY = 'mustard-alt-click-enabled'

function setMustardLandingPageState(userId?: string | null): void {
  if (!document.body.hasAttribute('data-mustard-landing-page')) return
  const root = document.documentElement
  root.setAttribute('data-mustard-installed', '')
  if (userId !== undefined) {
    root.setAttribute('data-mustard-session', userId ? 'connected' : 'disconnected')
  }
}

export default defineContentScript({
  matches: ['<all_urls>'],
  cssInjectionMode: 'manifest',

  main() {
    setMustardLandingPageState()

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

    /** Remove a confirmed-deleted note and all of its per-note UI state. */
    function dropDeletedNote(noteId: string): void {
      mustardState.notes = mustardState.notes.filter((note) => note.id !== noteId)
      delete mustardState.revealedHiddenNoteIds[noteId]
      delete mustardState.comments[noteId]
      delete mustardState.commentsLoadState[noteId]
      delete mustardState.expandedCommentNoteIds[noteId]
      delete mustardState.unreadByNoteId[noteId]
      delete mustardState.pendingNoteIds[noteId]
    }

    function revealHiddenNotes(noteIds: string[]): void {
      for (const noteId of noteIds) mustardState.revealedHiddenNoteIds[noteId] = true
    }

    /** Exempt timed notes from the playback-window gate until navigation. */
    function revealTimedNotes(noteIds: string[]): void {
      for (const noteId of noteIds) mustardState.revealedTimedNoteIds[noteId] = true
    }

    /**
     * A freshly saved timed note must visibly exist for its author even when
     * the video has played past its window while they wrote it. The exemption
     * is temporary so the authored timing takes over again afterwards.
     */
    const TIMED_NOTE_SAVE_REVEAL_MS = 5000
    function revealTimedNotesTemporarily(noteIds: string[]): void {
      const timedIds = noteIds.filter(
        (id) =>
          mustardState.notes.find((n) => n.id === id)?.anchorData.elementAnchorData?.type ===
          'video',
      )
      if (timedIds.length === 0) return
      revealTimedNotes(timedIds)
      setTimeout(() => {
        for (const id of timedIds) delete mustardState.revealedTimedNoteIds[id]
      }, TIMED_NOTE_SAVE_REVEAL_MS)
    }

    /**
     * Resolves the anchored video element, waiting for SPA players that mount
     * after the notes query settles (the usual case on a fresh deep link).
     */
    function awaitVideoElement(
      selector: string,
      timeoutMs = 15000,
    ): Promise<HTMLVideoElement | null> {
      const existing = document.querySelector(selector)
      if (isVideoElement(existing)) return Promise.resolve(existing)

      return new Promise((resolve) => {
        const observer = new MutationObserver(() => {
          const el = document.querySelector(selector)
          if (!isVideoElement(el)) return
          cleanup()
          resolve(el)
        })
        const timer = setTimeout(() => {
          cleanup()
          resolve(null)
        }, timeoutMs)
        function cleanup() {
          observer.disconnect()
          clearTimeout(timer)
        }
        observer.observe(document.documentElement, { childList: true, subtree: true })
      })
    }

    /**
     * Resolves once the player is out of ad playback (immediately when no ad
     * is showing). Ads run in the same <video> element, so seeking during one
     * lands in the ad's timeline instead of the video's.
     */
    function awaitAdEnd(timeoutMs = 180000): Promise<void> {
      if (!isVideoAdShowing()) return Promise.resolve()
      const player = document.querySelector('#movie_player')
      if (!player) return Promise.resolve()

      return new Promise((resolve) => {
        const observer = new MutationObserver(() => {
          if (isVideoAdShowing()) return
          cleanup()
          resolve()
        })
        const timer = setTimeout(() => {
          cleanup()
          resolve()
        }, timeoutMs)
        function cleanup() {
          observer.disconnect()
          clearTimeout(timer)
        }
        observer.observe(player, { attributes: true, attributeFilter: ['class'] })
      })
    }

    function awaitVideoMetadata(video: HTMLVideoElement, timeoutMs = 10000): Promise<void> {
      if (video.readyState >= HTMLMediaElement.HAVE_METADATA) return Promise.resolve()
      return new Promise((resolve) => {
        const timer = setTimeout(() => resolve(), timeoutMs)
        video.addEventListener(
          'loadedmetadata',
          () => {
            clearTimeout(timer)
            resolve()
          },
          { once: true },
        )
      })
    }

    /**
     * The point of following a timed-note notification: land the video at the
     * note's moment so it plays out in its authored context — no visibility
     * workaround, the seek itself brings the note into its timeframe.
     */
    async function seekVideoToNoteStart(noteId: string): Promise<void> {
      const note = mustardState.notes.find((n) => n.id === noteId)
      const anchorData = note?.anchorData.elementAnchorData
      if (!note || anchorData?.type !== 'video') return
      const selector = note.anchorData.elementSelector
      if (!selector) return

      const video = await awaitVideoElement(selector)
      if (!video) return
      // Pre-roll ads hijack the video element; only the content stream that
      // follows them may be seeked.
      await awaitAdEnd()
      await awaitVideoMetadata(video)

      const seek = () => {
        video.currentTime = anchorData.startAt
      }
      seek()
      // The player can still override the position after our seek (watch-
      // history resume, the ad→content stream handoff) — re-assert on
      // playback until the position sticks.
      let attemptsLeft = 5
      const onPlaying = () => {
        if (isVideoAdShowing()) return
        if (Math.abs(video.currentTime - anchorData.startAt) <= 1.5 || --attemptsLeft <= 0) {
          video.removeEventListener('playing', onPlaying)
          return
        }
        seek()
      }
      video.addEventListener('playing', onPlaying)
    }

    function applyHiddenNoteIds(hiddenNoteIds: Record<string, boolean>): void {
      mustardState.hiddenNoteIds = hiddenNoteIds
      // Once a note is genuinely un-hidden, its temporary reveal must not linger
      // and accidentally exempt a future hide of that same note.
      for (const noteId of Object.keys(mustardState.revealedHiddenNoteIds)) {
        if (!hiddenNoteIds[noteId]) delete mustardState.revealedHiddenNoteIds[noteId]
      }
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
        unreadCountsSettledOnce.resolve()
        maybeApplyPendingFocus()
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
          unreadCountsSettledOnce.resolve()
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
        pageUrls: string[],
        options?: { includeAllAuthors?: boolean; withComments?: boolean },
      ): Promise<number> => {
        // A page can carry legacy keys next to its canonical one (see
        // getCurrentPageKeys) — query them all and merge.
        const dtoLists = await Promise.all(
          pageUrls.map((pageUrl) =>
            sendMessage(createQueryNotesMessage(pageUrl, options?.includeAllAuthors)),
          ),
        )
        const seenIds = new Set<string>()
        const dtos = dtoLists.flat().filter((dto) => {
          if (!dto.id) return true
          if (seenIds.has(dto.id)) return false
          seenIds.add(dto.id)
          return true
        })
        applyNotesResponse(dtos, { withComments: options?.withComments })
        return mustardState.notes.length
      },
    )

    /**
     * Merge additionally loaded notes (embedded posts in a feed) into state
     * without disturbing what's already rendered.
     */
    function mergeAdditionalNotes(dtos: DtoMustardNote[] | undefined): void {
      const existingIds = new Set(mustardState.notes.map((n) => n.id))
      const added = (dtos ?? [])
        .map(DtoMustardNote.fromDto)
        .filter((n) => !n.id || !existingIds.has(n.id))
      if (added.length === 0) return
      mustardState.notes = [...mustardState.notes, ...added]
      fetchProfilesForNotes(added)
      // Guarded: fetchCommentsForNotes treats an all-local set as "no remote
      // notes on this page" and would reset the whole comments state.
      if (collectRemoteNoteIds(added).length > 0) {
        fetchCommentsForNotes(added)
        fetchUnreadForNotes(mustardState.notes)
      }
    }

    /**
     * Feed pages embed many posts, each addressable by its own canonical key.
     * Load notes for the posts currently in the DOM (batched, once per key per
     * page visit) and merge them next to the page's own notes.
     */
    let queriedEmbeddedPostKeys = new Set<string>()
    const loadEmbeddedPostNotes = synchronize(async (): Promise<void> => {
      const strategy = siteStrategyFor(window.location.href)
      if (!strategy.supportsEmbeddedPosts()) return
      const keys = strategy
        .collectEmbeddedPostKeys()
        .filter((key) => !queriedEmbeddedPostKeys.has(key) && !isCurrentPageKey(key))
      if (keys.length === 0) return
      for (const key of keys) queriedEmbeddedPostKeys.add(key)
      try {
        const dtos = await sendMessage(createQueryNotesForPagesMessage(keys))
        mergeAdditionalNotes(dtos)
      } catch (err) {
        // Allow a later scan to retry these keys after a transient failure.
        for (const key of keys) queriedEmbeddedPostKeys.delete(key)
        console.debug('mustard [content-script] embedded post query failed:', err)
      }
    })

    // Feeds render and grow asynchronously (infinite scroll) — watch the DOM
    // and re-scan, debounced. Only attached on pages whose strategy embeds
    // posts, so ordinary sites carry no observer cost.
    let embeddedPostObserver: MutationObserver | null = null
    let embeddedPostScanTimer: number | undefined
    function syncEmbeddedPostObserver(): void {
      const supports = siteStrategyFor(window.location.href).supportsEmbeddedPosts()
      if (!supports) {
        embeddedPostObserver?.disconnect()
        embeddedPostObserver = null
        return
      }
      loadEmbeddedPostNotes().catch(() => {})
      if (embeddedPostObserver) return
      embeddedPostObserver = new MutationObserver(() => {
        if (embeddedPostScanTimer !== undefined) return
        embeddedPostScanTimer = window.setTimeout(() => {
          embeddedPostScanTimer = undefined
          loadEmbeddedPostNotes().catch(() => {})
          // SPA screen transitions swap post items without any scroll/resize —
          // nudge anchor resolution and video tracking to re-evaluate.
          mustardState.domTick++
        }, 800)
      })
      embeddedPostObserver.observe(document.body, { childList: true, subtree: true })
    }

    /**
     * Apply a local-only notes response: the background returns just the local
     * notes (fast path, no network), so we keep the already-loaded remote notes
     * in place and swap only the local ones.
     */
    function applyLocalNotesResponse(dtos: DtoMustardNote[] | undefined, pageKey: string): void {
      const localNotes = (dtos ?? []).map(DtoMustardNote.fromDto)
      // Swap only the local notes stored under the responding key — a page can
      // also show local notes from its legacy keys, which this response
      // doesn't cover.
      const keptNotes = mustardState.notes.filter(
        (n) => n.authorId !== 'local' || n.anchorData.pageUrl !== pageKey,
      )
      mustardState.notes = [...localNotes, ...keptNotes]
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

    // Canonical key first, plus any legacy keys existing notes may live under
    // (e.g. appview URLs from before AT-URI keying). Writes always use the
    // canonical key; loading and focus matching honor the whole set.
    let currentPageKeys = siteStrategyFor(window.location.href).getPageKeys()

    function getCurrentPageUrl(): string {
      return currentPageKeys[0]!
    }

    function getCurrentPageKeys(): string[] {
      return currentPageKeys
    }

    function isCurrentPageKey(pageUrl: string): boolean {
      return currentPageKeys.includes(pageUrl)
    }

    // --- Pending focus (deep-link from the popup) ---
    // The popup writes a PendingFocus before opening a page; we consume it once
    // here to expand the relevant comment thread(s) and scroll the note into
    // view. It's retried as notes/unread-counts arrive (whichever the focus
    // needs) and cleared after it successfully applies.
    let pendingFocus: PendingFocus | null = null
    // Resolves once the page's initial (follow-graph-restricted) notes query
    // has settled, whether or not it returned any notes — distinguishes
    // "still loading" from "loaded and legitimately empty" for the guard
    // below. A subject rather than a boolean: .status() is a synchronous
    // "has this settled yet" check, and .resolve() is a plain milestone
    // signal (this never needs its resolved value).
    const initialNotesQuerySettled = subject<void>()
    // Resolves once fetchUnreadForNotes has completed at least one real round
    // trip (even a trivial one with zero ids) — lets the page-row branch tell
    // "the normal cycle hasn't reported back yet" from "it reported back and
    // the target genuinely isn't in the loaded note set". fetchUnreadForNotes
    // runs repeatedly all session long; resolve() is idempotent, so calling
    // it every time still correctly means "at least once".
    const unreadCountsSettledOnce = subject<void>()

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

    /**
     * When a pending-focus target isn't in the currently-loaded note set — e.g.
     * a notification about a joined thread on an unfollowed author's note,
     * which `queryNotes` never fetches since it only covers the follow/repost/
     * mention channels — fetch just the missing note(s) by id (never the whole
     * page) and merge them in. Gives up (clears `pendingFocus`) only once an
     * authoritative source confirms there's genuinely nothing to find.
     *
     * Wrapped in `synchronize` so overlapping calls (e.g. one from the boot
     * query settling, another from fetchUnreadForNotes settling moments later)
     * queue instead of racing, and — unlike a hand-rolled "already ran" guard —
     * naturally allow a fresh attempt any time it's called again, including
     * after a transient failure below.
     */
    const repairPendingFocusVisibility = synchronize(async (focus: PendingFocus): Promise<void> => {
      const pageUrl = focus.pageUrl
      let missingIds: string[]

      if (focus.noteId) {
        missingIds = [focus.noteId]
      } else {
        let unreadIds: string[]
        try {
          unreadIds = await sendMessage(createQueryUnreadCommentNoteIdsMessage(pageUrl))
        } catch {
          // Transient failure — don't treat it as "no unread threads"; leave
          // pendingFocus alone so a later trigger (e.g. the next
          // NOTIFICATIONS_CHANGED) can retry.
          return
        }
        if (unreadIds.length === 0) {
          if (pendingFocus === focus) pendingFocus = null
          return
        }
        const loadedIds = new Set(mustardState.notes.map((n) => n.id))
        missingIds = unreadIds.filter((id) => !loadedIds.has(id))
        // Every unread note is already loaded — confirmed nothing hidden, the
        // in-flight/normal fetchUnreadForNotes cycle already expanded it (the
        // caller may have deferred clearing pendingFocus to us for exactly
        // this determination — see maybeApplyPendingFocus's repairTriggered).
        if (missingIds.length === 0) {
          if (pendingFocus === focus) pendingFocus = null
          return
        }
      }

      let dtos: DtoMustardNote[]
      try {
        dtos = await sendMessage(createQueryNotesByIdsMessage(pageUrl, missingIds))
      } catch {
        // Transient failure — don't conclude the note is gone; leave
        // pendingFocus alone so a later trigger can still retry.
        return
      }
      const existingIds = new Set(mustardState.notes.map((n) => n.id))
      const newNotes = dtos.map(DtoMustardNote.fromDto).filter((n) => !existingIds.has(n.id))

      if (newNotes.length === 0) {
        // Fetched directly by id (bypassing the follow graph) and still found
        // nothing — the note is gone (deleted) or the id is stale. Give up.
        if (pendingFocus === focus) pendingFocus = null
        return
      }

      mustardState.notes = [...mustardState.notes, ...newNotes]
      fetchProfilesForNotes(newNotes)
      fetchCommentsForNotes(newNotes)
      fetchUnreadForNotes(mustardState.notes)

      // Complete the focus for the repaired note(s) directly instead of
      // re-invoking maybeApplyPendingFocus(): the page-row case may have
      // already cleared pendingFocus after expanding a different,
      // already-visible note, and even when it's still set, unreadByNoteId
      // won't reflect these brand-new notes until the fetchUnreadForNotes
      // call above resolves — acknowledging them here unconditionally is the
      // only way they don't end up needing a second click.
      mustardState.areNotesVisible = true
      // A notification must always be able to surface its note, so a repaired note
      // gets a temporary render exception without revealing unrelated hidden notes.
      const newNoteIds = newNotes.map((n) => n.id).filter((id): id is string => !!id)
      revealHiddenNotes(newNoteIds)
      for (const id of newNoteIds) {
        mustardState.expandedCommentNoteIds[id] = true
        if (!mustardState.clientOutdated) {
          event.emit(createMarkNotificationsSeenForNoteMessage(id))
        }
      }
      if (newNoteIds[0]) {
        scrollToNote(newNoteIds[0])
        seekVideoToNoteStart(newNoteIds[0]).catch(() => {})
      }
      if (pendingFocus === focus) pendingFocus = null
    })

    function maybeApplyPendingFocus(): void {
      if (!pendingFocus || !isCurrentPageKey(pendingFocus.pageUrl)) return
      if (initialNotesQuerySettled.status() === 'pending') return // wait for the first query to resolve

      const focus = pendingFocus
      // repairPendingFocusVisibility is synchronize()'d, so calling this
      // more than once just queues rather than racing or duplicating work.
      const startRepair = () => {
        repairPendingFocusVisibility(focus).catch(() => {
          if (pendingFocus === focus) pendingFocus = null
        })
      }

      let targetIds: string[]
      // True once a hidden-thread repair has been kicked off alongside the
      // already-visible target below. In that case repairPendingFocusVisibility
      // itself owns clearing pendingFocus (it may still need to retry after a
      // transient failure) — the tail below must not race it by clearing
      // pendingFocus out from under a repair that hasn't resolved yet.
      let repairTriggered = false
      const targetNoteId = focus.noteId
      if (targetNoteId) {
        // Not visible via the normal query — try a targeted by-id repair
        // before giving up (see repairPendingFocusVisibility).
        if (!mustardState.notes.some((n) => n.id === targetNoteId)) {
          startRepair()
          return
        }
        targetIds = [targetNoteId]
      } else {
        // Page-row case: focus notes that currently have unread comments.
        targetIds = Object.keys(mustardState.unreadByNoteId).filter(
          (id) => (mustardState.unreadByNoteId[id] ?? 0) > 0,
        )
        if (targetIds.length === 0) {
          // Only attempt repair once the normal unread-counts cycle has
          // actually reported back and still found nothing — otherwise this
          // fires on every ordinary "counts haven't arrived yet" tick.
          if (unreadCountsSettledOnce.status() !== 'pending') startRepair()
          return
        }
        // A visible note already has unread comments, but a joined thread
        // outside the follow graph never surfaces in unreadByNoteId at all —
        // check for it too so it doesn't take a second click to discover.
        if (unreadCountsSettledOnce.status() !== 'pending') {
          repairTriggered = true
          startRepair()
        }
      }

      mustardState.areNotesVisible = true
      // A notification must always be able to surface its target, even when that
      // target is a hidden note already loaded via the normal query (so the repair
      // branch above was skipped). Reveal only those targets; unrelated hidden
      // notes stay filtered.
      revealHiddenNotes(targetIds)
      for (const id of targetIds) {
        mustardState.expandedCommentNoteIds[id] = true
        // Reading the thread acknowledges its unread comment notifications.
        // Routed through the same event the manual toggle uses, so the optimistic
        // clear + sendMessage stay in one canonical place.
        //
        // A specific-note focus (targetNoteId) always implies unread activity —
        // that's the only reason a PendingFocus was set for it — so acknowledge
        // it unconditionally rather than gating on unreadByNoteId: a note that
        // just got merged in by repairPendingFocusVisibility hasn't had its
        // fresh count land yet (fetchUnreadForNotes is still in flight), and
        // waiting for it would let this one-shot focus complete and clear
        // itself before the ack ever fires. The page-row case still gates on
        // the cache since its targetIds are only ever built FROM that cache.
        if ((targetNoteId || mustardState.unreadByNoteId[id]) && !mustardState.clientOutdated) {
          event.emit(createMarkNotificationsSeenForNoteMessage(id))
        }
      }
      scrollToNote(targetIds[0]!)
      seekVideoToNoteStart(targetIds[0]!).catch(() => {})
      if (!repairTriggered) pendingFocus = null
    }

    browser.storage.local
      .get(PENDING_FOCUS_KEY)
      .then((result) => {
        const focus = result[PENDING_FOCUS_KEY] as PendingFocus | undefined
        // Every tab's content script runs this same read (matches: <all_urls>),
        // so only the tab the focus actually targets may consume (and clear)
        // it — otherwise an unrelated tab that happens to boot around the same
        // time (e.g. the onInstalled onboarding tab) can read and delete this
        // one-shot key before the real target tab gets to it.
        if (focus && isCurrentPageKey(focus.pageUrl)) {
          browser.storage.local.remove(PENDING_FOCUS_KEY).catch(() => {})
          pendingFocus = focus
          maybeApplyPendingFocus()
        }
      })
      .catch(() => {})

    function handleUrlChange() {
      const newPageKeys = siteStrategyFor(window.location.href).getPageKeys()
      if (newPageKeys[0] === getCurrentPageUrl()) return

      console.debug(
        'mustard [content-script] URL changed:',
        getCurrentPageUrl(),
        '->',
        newPageKeys[0],
      )
      currentPageKeys = newPageKeys

      mustardState.notes = []
      mustardState.comments = {}
      mustardState.commentsLoadState = {}
      mustardState.expandedCommentNoteIds = {}
      mustardState.unreadByNoteId = {}
      // Temporary notification / "show all" exceptions are page-scoped.
      mustardState.revealedHiddenNoteIds = {}
      mustardState.revealedTimedNoteIds = {}
      queriedEmbeddedPostKeys = new Set()
      runNotesQuery(newPageKeys, { withComments: true }).catch(() => {})
      syncEmbeddedPostObserver()
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
      // The site strategy may re-aim the click (e.g. a video hidden under
      // player chrome) and know stabler selectors than the generic DOM path.
      const siteStrategy = siteStrategyFor(window.location.href)
      // Synthetic events (e.g. dispatched in tests) may lack coordinates, and
      // elementsFromPoint throws on non-finite values — skip the stack then.
      const clickStack =
        Number.isFinite(event.clientX) && Number.isFinite(event.clientY)
          ? document.elementsFromPoint(event.clientX, event.clientY)
          : []
      const target = siteStrategy.resolveTargetElement(
        event.target as HTMLElement,
        clickStack,
      ) as HTMLElement
      // A click inside an embedded post (feed item) keys the note to the POST,
      // not the page, with a selector that resolves on the post's own page and
      // the note's position measured against the post's element.
      const embeddedPost = siteStrategy.resolveEmbeddedPostAnchor(target, clickStack)
      const rect = (embeddedPost?.anchorElement ?? target).getBoundingClientRect()
      removeHighlight()
      lastContextMenuTarget = target
      return {
        pageUrl: embeddedPost?.pageKey ?? getCurrentPageUrl(),
        elementSelector:
          embeddedPost?.selector ?? siteStrategy.createSelector(target) ?? generateSelector(target),
        relativePosition: {
          xP: ((event.clientX - rect.left) / rect.width) * 100,
          yP: ((event.clientY - rect.top) / rect.height) * 100,
        },
        // A note created on a post embedded in a feed can't derive a
        // meaningful absolute fallback from the feed's layout (the post could
        // be anywhere). Store a neutral default instead: roughly where the
        // focused post sits on its own page (top of the content column).
        clickPosition: embeddedPost
          ? { xVw: 50, yPx: 300 }
          : {
              xVw: (event.clientX / window.innerWidth) * 100,
              yPx: event.clientY + window.scrollY,
            },
      }
    }

    function openNoteEditor(anchor: MustardNoteAnchorData | null) {
      if (!mustardState.areNotesVisible) {
        mustardState.areNotesVisible = true
      }
      const videoElementAnchorData = getVideoElementAnchorData(
        window.location.href,
        lastContextMenuTarget,
      )
      mustardState.editor.anchor =
        anchor && videoElementAnchorData
          ? { ...anchor, elementAnchorData: videoElementAnchorData }
          : anchor
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
      if (message.type === 'NOTE_DELETED') {
        if (isCurrentPageKey(message.pageUrl)) dropDeletedNote(message.noteId)
        return
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
            const count = await runNotesQuery(getCurrentPageKeys(), {
              includeAllAuthors: true,
              withComments: true,
            })
            // "Show all" is the intentional bulk escape hatch: reveal every
            // currently loaded hidden note, while later hides still filter
            // normally because they are not added to this exception set.
            revealHiddenNotes(
              mustardState.notes
                .filter((note) => note.id && mustardState.hiddenNoteIds[note.id])
                .map((note) => note.id!),
            )
            // "Show all" also means all TIMED notes — otherwise the reported
            // count wouldn't match what's on screen.
            revealTimedNotes(
              mustardState.notes
                .filter((note) => note.id && note.anchorData.elementAnchorData?.type === 'video')
                .map((note) => note.id!),
            )
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
        setMustardLandingPageState(message.userId)
        if (message.userId) {
          document.getElementById('mustard-session-expired-banner')?.remove()
          fetchProfiles({ userIds: [message.userId] })
        }
        // Session change can change which notes are visible (follows differ),
        // so clear per-note client state to avoid stale dots / comments.
        mustardState.unreadByNoteId = {}
        syncEmbeddedPostObserver()
        runNotesQuery(getCurrentPageKeys(), { withComments: true }).catch(() => {})
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
        setMustardLandingPageState(response?.userId ?? null)
        // Eagerly resolve the current user's profile so the comment editor can
        // render their avatar next to the input (and any other UI that wants it).
        if (response?.userId) fetchProfiles({ userIds: [response.userId] })
        fetchUnreadForNotes(mustardState.notes)
      })
      .catch(() => {
        setMustardLandingPageState(null)
      })

    // Load preferences from storage
    browser.storage.local
      .get([NOTES_MINIMIZED_KEY, SHOW_ANCHOR_IN_EDITOR_KEY, ALT_CLICK_ENABLED_KEY])
      .then((result) => {
        mustardState.areNotesMinimized = !!result[NOTES_MINIMIZED_KEY]
        mustardState.showAnchorInEditor = !!result[SHOW_ANCHOR_IN_EDITOR_KEY]
        altClickEnabled = !!result[ALT_CLICK_ENABLED_KEY]
      })
      .catch(() => {})

    // Which notes the user has hidden for good. Read separately from the prefs
    // above because it needs shaping (refs -> id map), not just a boolean cast.
    readHiddenNoteIds()
      .then((ids) => {
        applyHiddenNoteIds(ids)
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
      if (HIDDEN_NOTES_KEY in changes) {
        // Fans hide/un-hide out to every other tab, and back to this one after its
        // own optimistic update. Un-hiding from the options page re-renders the
        // note live in any tab already showing its page.
        applyHiddenNoteIds(
          toHiddenNoteIds((changes[HIDDEN_NOTES_KEY].newValue ?? {}) as HiddenNotesStore),
        )
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

    // Query notes for the current page. Settle on failure too — otherwise a
    // rejected boot query (e.g. a transient service-worker or storage
    // failure) leaves maybeApplyPendingFocus's loading guard blocked forever.
    runNotesQuery(getCurrentPageKeys(), { withComments: true })
      .catch(() => {})
      .finally(() => {
        initialNotesQuerySettled.resolve()
        maybeApplyPendingFocus()
      })

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
        if (optimisticId) revealTimedNotesTemporarily([optimisticId])
        sendMessage(message)
          .then((response) => {
            if (!response.ok) {
              if (optimisticId) removeOptimisticNote(optimisticId)
              clearPendingNoteIds()
              if (response.errorCode === RATE_LIMIT_ERROR_CODE) {
                showMustardToast({
                  id: 'mustard-rate-limit',
                  text: "You've published a lot recently — please wait a moment and try again.",
                  autoDismissMs: 6000,
                })
              }
              return
            }

            const dtos = response.data
            console.debug('mustard [content-script] received notes after upsert:', dtos)
            // Local saves swap only local notes. A remote publish returns just
            // the newly-created note (no index re-query) — merge it in place,
            // retiring the optimistic placeholder and/or converted local note.
            const idsBeforeMerge = new Set(mustardState.notes.map((n) => n.id))
            if (isLocalOperation) applyLocalNotesResponse(dtos, message.data.anchorData.pageUrl)
            else mergeRemoteUpsertResponse(dtos, [optimisticId, message.localNoteIdToDelete])
            // The author must see their fresh timed note even when the video
            // played past its window while they wrote it.
            revealTimedNotesTemporarily(
              mustardState.notes.filter((n) => n.id && !idsBeforeMerge.has(n.id)).map((n) => n.id!),
            )
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
        sendMessage(message)
          .then((dtos) => {
            console.debug('mustard [content-script] received notes after delete:', dtos)
            if (isLocalDelete) applyLocalNotesResponse(dtos, message.pageUrl)
            else applyNotesResponse(dtos)
            // The deletion is now confirmed, so discard the removed note's
            // per-note UI state and unlock only this note.
            dropDeletedNote(message.noteId)
          })
          .catch((err) => {
            console.error('mustard [content-script] DELETE_NOTE failed:', err)
            // Keep the note and its thread visible: the server did not delete it.
            // Unlock only this note so the user can retry without affecting an
            // unrelated operation that may still be pending.
            delete mustardState.pendingNoteIds[message.noteId]
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
          .then((response) => {
            if (!response.ok) {
              if (response.errorCode === RATE_LIMIT_ERROR_CODE) {
                showMustardToast({
                  id: 'mustard-rate-limit',
                  text: "You've posted a lot of comments recently — please wait a moment and try again.",
                  autoDismissMs: 6000,
                })
              }
              return
            }

            const dtos = response.data
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
