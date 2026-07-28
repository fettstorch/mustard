import { computed, onMounted, onUnmounted, ref, watchEffect, type ComputedRef, type Ref } from 'vue'
import { Observable, synchronize } from '@fettstorch/jule'
import {
  createDeleteNoteMessage,
  createGetAppStatusMessage,
  createGetProfilesMessage,
  createQueryCommentsMessage,
  createQueryNotesByIdsMessage,
  sendMessage,
  type Message,
} from '@/shared/messaging'
import { DtoMustardComment } from '@/shared/dto/DtoMustardComment'
import { DtoMustardNote } from '@/shared/dto/DtoMustardNote'
import { createMustardState, type MustardState } from '@/ui/content/mustard-state'
import { extractMentions, type MentionTarget } from '@/shared/mentions'
import { isRemoteMutationMessage } from '@/shared/remote-mutation'
import {
  groupRefsByPage,
  readHiddenNoteRefs,
  unhideAll,
  unhideNote,
  HIDDEN_NOTES_KEY,
  type HiddenNoteRef,
} from '@/shared/hidden-notes'
import type { MustardComment } from '@/shared/model/MustardComment'
import type { MustardNote } from '@/shared/model/MustardNote'

/** A hidden note ref paired with whatever could be resolved for it. */
type HiddenNoteEntry = {
  ref: HiddenNoteRef
  /** null when the note is gone — its author deleted it after it was hidden. */
  note: MustardNote | null
}

type HiddenNotesGallery = {
  /** Provided to the note components as `mustardState`. */
  state: MustardState
  /** Provided to the note components as `event`; bridged to the background below. */
  event: Observable<Message>
  refs: Ref<HiddenNoteRef[]>
  entries: Ref<HiddenNoteEntry[]>
  loadState: Ref<'idle' | 'loading' | 'loaded'>
  count: ComputedRef<number>
  resolved: ComputedRef<HiddenNoteEntry[]>
  unavailable: ComputedRef<HiddenNoteEntry[]>
  readRefs: () => Promise<void>
  load: () => Promise<void>
  unhide: (noteId: string) => Promise<void>
  unhideEvery: () => Promise<void>
  remove: (note: MustardNote) => Promise<void>
}

/**
 * Backing store for the options page's hidden-notes gallery.
 *
 * The gallery renders the real `MustardNote` component rather than a lookalike, so
 * hidden notes carry every feature they have on a page (avatars, repost stacks,
 * link previews, code highlighting, comment threads). That component needs exactly
 * two injections — `mustardState` and `event` — so this builds a state instance
 * scoped to the gallery plus a bridge that relays note messages to the background,
 * mirroring the content script's relay for the message types the gallery can emit.
 *
 * Notes are re-fetched on open rather than snapshotted at hide time, so previews
 * always show current content.
 */
export function useHiddenNotes(currentUserId: () => string | null): HiddenNotesGallery {
  // A state of its own, deliberately not the content script's: `areNotesMinimized`
  // stays false here (the gallery must never render pills, whatever the user's
  // page preference is) and `hiddenNoteIds` holds every note on show, which is
  // what makes each one offer un-hide instead of hide.
  const state = createMustardState()
  const event = new Observable<Message>()

  // Tracked, not snapshotted at load time: the session resolves asynchronously on
  // mount, and a gallery that read `null` before it arrived would treat the viewer
  // as logged out — which silently disables expanding comment threads and the
  // comment editor on every note in it.
  watchEffect(() => {
    state.currentUserId = currentUserId()
  })

  const refs = ref<HiddenNoteRef[]>([])
  const entries = ref<HiddenNoteEntry[]>([])
  const loadState = ref<'idle' | 'loading' | 'loaded'>('idle')

  const count = computed(() => refs.value.length)
  const resolved = computed(() => entries.value.filter((e) => e.note !== null))
  const unavailable = computed(() => entries.value.filter((e) => e.note === null))

  async function readRefs(): Promise<void> {
    const store = await readHiddenNoteRefs()
    // Most recently hidden first.
    refs.value = Object.values(store).sort((a, b) => b.hiddenAt - a.hiddenAt)
  }

  /** Order-independent identity of the hidden set, to tell a real change from a no-op. */
  function refIdKey(list: HiddenNoteRef[]): string {
    return list
      .map((r) => r.noteId)
      .sort()
      .join(',')
  }

  /**
   * React to the hidden set changing underneath us — a note hidden or un-hidden
   * from a page tab (or another options tab) while this gallery is open.
   *
   * The gallery's own un-hide/delete already update `refs` optimistically before
   * they write, so those writes come back here as a no-op set and are skipped —
   * only a genuinely external change reloads. Once the section has been opened,
   * `load` is also queued while an earlier load is in flight; before first open,
   * refreshing `refs` is enough and the notes load when expanded.
   */
  async function syncFromStorage(): Promise<void> {
    const before = refIdKey(refs.value)
    await readRefs()
    if (refIdKey(refs.value) === before) return
    if (loadState.value !== 'idle') await load()
  }

  const onStorageChanged = (changes: Record<string, unknown>) => {
    if (HIDDEN_NOTES_KEY in changes) syncFromStorage().catch(() => {})
  }
  onMounted(() => {
    browser.storage.onChanged.addListener(onStorageChanged)
    // The option page's hidden notes gallery reuses the real note/comment controls, so it needs the same
    // background-owned version guard as the content script. Fail open: a status
    // lookup error leaves controls usable, while the background remains the
    // authoritative write guard.
    sendMessage(createGetAppStatusMessage())
      .then((status) => {
        state.clientOutdated = !!status?.outdated
      })
      .catch(() => {})
  })
  onUnmounted(() => browser.storage.onChanged.removeListener(onStorageChanged))

  const runLoad = synchronize(async (): Promise<void> => {
    loadState.value = 'loading'
    try {
      const wanted = [...refs.value]

      // One query per distinct page, since notes are addressed per page.
      // allSettled rather than all: queryNotesByIds rejects on a transient failure
      // (deep-link repair depends on that, so those semantics stay put), and one
      // unreachable page must not take down the whole gallery — its notes show as
      // unavailable instead.
      const results = await Promise.allSettled(
        groupRefsByPage(wanted).map(({ pageUrl, noteIds }) =>
          sendMessage(createQueryNotesByIdsMessage(pageUrl, noteIds)),
        ),
      )

      const notesById = new Map<string, MustardNote>()
      for (const result of results) {
        if (result.status !== 'fulfilled') continue
        for (const dto of result.value ?? []) {
          const note = DtoMustardNote.fromDto(dto)
          if (note.id) notesById.set(note.id, note)
        }
      }

      entries.value = wanted.map((ref) => ({ ref, note: notesById.get(ref.noteId) ?? null }))

      const notes = [...notesById.values()]
      state.notes = notes
      state.hiddenNoteIds = Object.fromEntries(wanted.map((r) => [r.noteId, true]))

      await Promise.all([loadProfiles(notes), loadComments(notes)])
    } finally {
      loadState.value = 'loaded'
    }
  })

  // jule's type preserves the async action's nested Promise even though runtime
  // Promise resolution flattens it; the explicit await exposes the real API type.
  async function load(): Promise<void> {
    await runLoad()
  }

  /**
   * Resolve the given users/mentions and merge them into gallery state. The single
   * way profiles reach the gallery — the initial load, comment loading and the live
   * comment relay all funnel through here rather than re-implementing the fetch.
   */
  async function mergeProfiles(userIds: string[], mentions: MentionTarget[]): Promise<void> {
    if (userIds.length === 0 && mentions.length === 0) return
    const profiles = await sendMessage(createGetProfilesMessage(userIds, mentions))
    state.profiles = { ...state.profiles, ...profiles }
  }

  async function loadProfiles(notes: MustardNote[]): Promise<void> {
    const userIds = [
      ...new Set(
        notes.flatMap((n) => [n.authorId, ...n.reposterIds]).filter((id) => id !== 'local'),
      ),
    ]
    const mentions = notes.flatMap((n) => extractMentions(n.content))
    try {
      await mergeProfiles(userIds, mentions)
    } catch {
      // Unresolved profiles render as placeholders — not worth failing the gallery.
    }
  }

  /**
   * Comment counts, so the toggle shows a real number instead of sitting in its
   * loading state forever. Local notes can't have remote comments.
   */
  async function loadComments(notes: MustardNote[]): Promise<void> {
    const remoteNoteIds = notes
      .filter((n) => n.authorId !== 'local')
      .map((n) => n.id)
      .filter((id): id is string => !!id)
    if (remoteNoteIds.length === 0) return

    try {
      const response = await sendMessage(createQueryCommentsMessage(remoteNoteIds))
      const authorIds: string[] = []
      const mentions = []
      for (const noteId of remoteNoteIds) {
        const comments = ((response ?? {})[noteId] ?? []).map(DtoMustardComment.fromDto)
        state.comments[noteId] = comments
        state.commentsLoadState[noteId] = 'loaded'
        for (const c of comments) {
          authorIds.push(c.authorId)
          mentions.push(...extractMentions(c.content))
        }
      }
      await mergeProfiles([...new Set(authorIds)], mentions)
    } catch {
      // Leave the threads in their loading state rather than claiming zero comments.
    }
  }

  /**
   * Drop a note from every in-memory gallery structure. The matching storage write
   * (un-hide or delete) is left to the caller, since that part differs per action.
   */
  function dropHiddenNote(noteId: string): void {
    entries.value = entries.value.filter((e) => e.ref.noteId !== noteId)
    refs.value = refs.value.filter((r) => r.noteId !== noteId)
    state.notes = state.notes.filter((n) => n.id !== noteId)
    delete state.hiddenNoteIds[noteId]
  }

  async function unhide(noteId: string): Promise<void> {
    await unhideNote(noteId)
    dropHiddenNote(noteId)
  }

  async function unhideEvery(): Promise<void> {
    await unhideAll()
    entries.value = []
    refs.value = []
    state.notes = []
    state.hiddenNoteIds = {}
  }

  /**
   * Delete one of the viewer's own notes from the gallery. No confirmation, same
   * as on a page.
   *
   * The hidden ref is dropped too, on success: once the note is gone the ref would
   * only ever resolve to a "Note no longer available" row. Kept on failure so the
   * tile stays put rather than vanishing as if the delete had worked.
   */
  async function remove(note: MustardNote): Promise<void> {
    const noteId = note.id
    if (!noteId) return
    if (note.authorId !== 'local' && state.clientOutdated) return
    state.pendingNoteIds[noteId] = true
    try {
      await sendMessage(createDeleteNoteMessage(noteId, note.anchorData.pageUrl, note.authorId))
      dropHiddenNote(noteId)
    } catch (err) {
      console.error('mustard [options] DELETE_NOTE failed:', err)
    } finally {
      delete state.pendingNoteIds[noteId]
    }
  }

  // Relay for the messages the gallery's notes can emit. Publishing and reposting
  // are suppressed there via `enabledFeatures`, and deleting goes through
  // `remove` above, so only the comment paths and the notification
  // acknowledgement need handling here.
  event.subscribe((message) => {
    if (state.clientOutdated && isRemoteMutationMessage(message)) return

    if (message.type === 'UPSERT_COMMENT') {
      state.pendingCommentForNoteIds[message.noteId] = true
      sendMessage(message)
        .then((response) => {
          if (!response.ok) return
          applyComments(message.noteId, (response.data ?? []).map(DtoMustardComment.fromDto))
        })
        .catch((err) => console.error('mustard [options] UPSERT_COMMENT failed:', err))
        .finally(() => {
          delete state.pendingCommentForNoteIds[message.noteId]
        })
      return
    }

    if (message.type === 'DELETE_COMMENT') {
      state.pendingCommentIds[message.commentId] = true
      sendMessage(message)
        .then((dtos) => applyComments(message.noteId, (dtos ?? []).map(DtoMustardComment.fromDto)))
        .catch((err) => console.error('mustard [options] DELETE_COMMENT failed:', err))
        .finally(() => {
          delete state.pendingCommentIds[message.commentId]
        })
      return
    }

    if (message.type === 'MARK_NOTIFICATIONS_SEEN_FOR_NOTE') {
      delete state.unreadByNoteId[message.noteId]
      sendMessage(message).catch((err) =>
        console.error('mustard [options] MARK_NOTIFICATIONS_SEEN_FOR_NOTE failed:', err),
      )
    }
  })

  function applyComments(noteId: string, comments: MustardComment[]): void {
    state.comments[noteId] = comments
    state.commentsLoadState[noteId] = 'loaded'
    const authorIds = [...new Set(comments.map((c) => c.authorId))]
    const mentions = comments.flatMap((c) => extractMentions(c.content))
    mergeProfiles(authorIds, mentions).catch(() => {})
  }

  return {
    state,
    event,
    refs,
    entries,
    loadState,
    count,
    resolved,
    unavailable,
    readRefs,
    load,
    unhide,
    unhideEvery,
    remove,
  }
}
