<script setup lang="ts">
import { inject, computed, onMounted, onUnmounted, ref, reactive, defineAsyncComponent } from 'vue'
import type { MustardState } from './mustard-state'
import { calculateAnchorPosition } from './anchor-utils'
const MustardNoteEditor = defineAsyncComponent(() => import('./note-editor/MustardNoteEditor.vue'))
import MustardNote from './note/MustardNote.vue'
import PublishConfirmBubble from './PublishConfirmBubble.vue'
import type { MustardNote as MustardNoteType } from '@/shared/model/MustardNote'
import type { Observable } from '@fettstorch/jule'
import {
  createUpsertNoteMessage,
  createDeleteNoteMessage,
  createSetRepostMessage,
  sendMessage,
  type Message,
} from '@/shared/messaging'
import { LIMITS } from '@/shared/constants'
import { filterVisibleNotes, hideNote, makeHiddenNoteRef, unhideNote } from '@/shared/hidden-notes'
import { showMustardToast } from './mustard-toast'
import { useVideoNoteVisibility } from './video-note-visibility'
import { siteStrategyFor } from '@/shared/site-strategies'

const PUBLISH_CONFIRM_DISMISSED_KEY = 'mustard-publish-confirm-dismissed'

type EditorNoteSubmission = {
  content: string
  linkPreview?: MustardNoteType['linkPreview']
  linkPreviewDismissed?: boolean
  anchor?: MustardNoteType['anchorData']
}

const mustardState = inject<MustardState>('mustardState')!
const event = inject<Observable<Message>>('event')!

// Reactive trigger for recalculating positions on resize/scroll
const resizeTick = ref(0)

/**
 * Temporary drag offsets per note. Allows users to reposition notes on screen
 * without persisting the change. Resets on page reload or navigation.
 *
 * Key: MustardNote.id (the note's unique identifier)
 * Value: { x, y } pixel offset from the calculated anchor position
 */
const dragOffsets = reactive<Record<string, { x: number; y: number }>>({})

// Publish confirmation state
const skipPublishConfirm = ref(false)
const pendingPublish = ref<{
  content: string
  anchorData: MustardNoteType['anchorData']
  linkPreview?: MustardNoteType['linkPreview']
  linkPreviewDismissed?: boolean
  localNoteIdToDelete?: string
  /** 'editor' or note ID — used to position the bubble */
  source: string
} | null>(null)

// Load "don't show again" preference
browser.storage.local
  .get(PUBLISH_CONFIRM_DISMISSED_KEY)
  .then((result) => {
    skipPublishConfirm.value = !!result[PUBLISH_CONFIRM_DISMISSED_KEY]
  })
  .catch(() => {})

// Keep in sync when changed from the options page
function onStorageChanged(changes: Record<string, Browser.storage.StorageChange>) {
  if (PUBLISH_CONFIRM_DISMISSED_KEY in changes) {
    skipPublishConfirm.value = !!changes[PUBLISH_CONFIRM_DISMISSED_KEY].newValue
  }
}

const editorPosition = computed(() => {
  // eslint-disable-next-line @typescript-eslint/no-unused-expressions
  resizeTick.value + mustardState.domTick // dependencies to trigger recalculation
  if (!mustardState.editor.isOpen || !mustardState.editor.anchor) return { x: 0, y: 0 }
  return calculateAnchorPosition(mustardState.editor.anchor) ?? { x: 0, y: 0 }
})

/** Get drag offset for a note, defaulting to {0,0} */
function getDragOffset(noteId: string | null): { x: number; y: number } {
  if (!noteId) return { x: 0, y: 0 }
  return dragOffsets[noteId] ?? { x: 0, y: 0 }
}

/** Set drag offset for a note */
function setDragOffset(noteId: string | null, offset: { x: number; y: number }) {
  if (!noteId) return
  dragOffsets[noteId] = offset
}

const { isNoteTimeframeActive } = useVideoNoteVisibility({
  getNotes: () => mustardState.notes,
  getRetriggerTick: () => resizeTick.value + mustardState.domTick,
})

/**
 * The playback-window gate only governs ambient display. Explicit intent
 * ("show all", a fresh save — via revealedTimedNoteIds) and active engagement
 * (an expanded thread, a pending publish confirmation) always keep the note
 * on screen. Notification focus needs no exemption: it seeks the video to the
 * note's startAt, so the timeframe itself takes over.
 */
function isNoteDisplayable(note: MustardNoteType): boolean {
  if (isNoteTimeframeActive(note)) return true
  if (!note.id) return false
  return (
    !!mustardState.revealedTimedNoteIds[note.id] ||
    !!mustardState.expandedCommentNoteIds[note.id] ||
    pendingPublish.value?.source === note.id
  )
}

/** Compute positions for all notes (including drag offset) */
const notesWithPositions = computed(() => {
  // eslint-disable-next-line @typescript-eslint/no-unused-expressions
  resizeTick.value + mustardState.domTick // dependencies to trigger recalculation
  if (!mustardState.areNotesVisible) return []
  // Hidden notes are dropped here rather than at query time: they still load, so
  // un-hiding brings one straight back without a re-query. Explicit reveal paths
  // add only their intended note IDs as temporary exceptions.
  return filterVisibleNotes(
    mustardState.notes,
    mustardState.hiddenNoteIds,
    mustardState.revealedHiddenNoteIds,
  )
    .filter(isNoteDisplayable)
    .flatMap((note) => {
      // Null = unplaceable on this page (a post-keyed note whose post isn't
      // rendered here) — hide rather than misplace.
      const anchorPos = calculateAnchorPosition(note.anchorData)
      if (!anchorPos) return []
      const offset = getDragOffset(note.id)
      return [
        {
          note,
          position: {
            x: anchorPos.x + offset.x,
            y: anchorPos.y + offset.y,
          },
          dragOffset: offset,
        },
      ]
    })
})

function handleResize() {
  resizeTick.value++
}

function handleScroll() {
  resizeTick.value++
}

onMounted(() => {
  document.addEventListener('keydown', handleKeyDown)
  window.addEventListener('resize', handleResize)
  window.addEventListener('scroll', handleScroll, true) // useCapture=true to catch all scroll events
  browser.storage.onChanged.addListener(onStorageChanged)
})

onUnmounted(() => {
  document.removeEventListener('keydown', handleKeyDown)
  window.removeEventListener('resize', handleResize)
  window.removeEventListener('scroll', handleScroll, true)
  browser.storage.onChanged.removeListener(onStorageChanged)
})

function handleKeyDown(event: KeyboardEvent) {
  if (event.key !== 'Escape') return

  if (pendingPublish.value) {
    pendingPublish.value = null
    return
  }
  if (mustardState.editor.isOpen) {
    mustardState.editor.isOpen = false
    return
  }

  // Comment-thread close on Esc: be a polite citizen on the host page.
  // - Bubble phase + no stopPropagation/preventDefault → page handlers always run.
  // - Skip if the page already handled it (defaultPrevented) or an IME is composing.
  if (event.defaultPrevented || event.isComposing) return
  const expandedIds = Object.keys(mustardState.expandedCommentNoteIds).filter(
    (id) => mustardState.expandedCommentNoteIds[id],
  )
  if (expandedIds.length === 0) return
  for (const id of expandedIds) {
    mustardState.expandedCommentNoteIds[id] = false
  }
}

/**
 * Keystrokes typed inside the Mustard UI must not reach the host page: sites
 * like YouTube bind single-key hotkeys on `document` and don't recognize our
 * overlay's contenteditable, so e.g. typing "k" would toggle playback. Handle
 * our own shortcuts first (containment keeps the event from ever reaching the
 * document-level listeners), then stop the bubble. No preventDefault — typing
 * itself must proceed untouched.
 */
function onRootKeyDown(event: KeyboardEvent) {
  handleKeyDown(event)
  event.stopPropagation()
}

function onEditorClose() {
  pendingPublish.value = null
  mustardState.editor.isOpen = false
}

/** Editor: user clicked save button to create a local note */
function onEditorSave(data: EditorNoteSubmission) {
  const anchor = data.anchor ?? mustardState.editor.anchor
  if (!anchor) {
    console.warn('No anchor data found when trying to save note')
    return
  }
  // Allow local saves regardless of length - user's local storage
  event.emit(
    createUpsertNoteMessage(
      {
        content: data.content,
        linkPreview: data.linkPreview,
        linkPreviewDismissed: data.linkPreviewDismissed,
        anchorData: anchor,
        updatedAt: Date.now(),
      },
      'local',
    ),
  )
  mustardState.editor.isOpen = false
}

/** Editor: user clicked publish button to create a new remote note */
function onEditorPublish(data: EditorNoteSubmission) {
  const anchor = data.anchor ?? mustardState.editor.anchor
  if (!anchor) {
    console.warn('No anchor data found when trying to publish note')
    return
  }
  if (data.content.length > LIMITS.CONTENT_MAX_LENGTH) {
    console.warn(`Content exceeds ${LIMITS.CONTENT_MAX_LENGTH} character limit`)
    return
  }
  requestPublish(
    data.content,
    anchor,
    undefined,
    'editor',
    data.linkPreview,
    data.linkPreviewDismissed,
  )
}

/** Note: user clicked publish icon on an existing local note to upload it */
function onNotePublish(note: MustardNoteType) {
  requestPublish(
    note.content,
    note.anchorData,
    note.id ?? undefined,
    note.id ?? 'note',
    note.linkPreview,
    note.linkPreviewDismissed,
  )
}

/** Gate publish behind a confirmation bubble (unless user dismissed it) */
function requestPublish(
  content: string,
  anchorData: MustardNoteType['anchorData'],
  localNoteIdToDelete?: string,
  source?: string,
  linkPreview?: MustardNoteType['linkPreview'],
  linkPreviewDismissed?: boolean,
) {
  if (skipPublishConfirm.value) {
    publishToRemote(content, anchorData, localNoteIdToDelete, linkPreview, linkPreviewDismissed)
    if (source === 'editor') mustardState.editor.isOpen = false
    return
  }
  pendingPublish.value = {
    content,
    anchorData,
    linkPreview,
    linkPreviewDismissed,
    localNoteIdToDelete,
    source: source ?? 'editor',
  }
}

function onPublishConfirm(dontShowAgain: boolean) {
  if (!pendingPublish.value) return
  if (dontShowAgain) {
    skipPublishConfirm.value = true
    browser.storage.local.set({ [PUBLISH_CONFIRM_DISMISSED_KEY]: true })
  }
  const { content, anchorData, linkPreview, linkPreviewDismissed, localNoteIdToDelete, source } =
    pendingPublish.value
  pendingPublish.value = null
  publishToRemote(content, anchorData, localNoteIdToDelete, linkPreview, linkPreviewDismissed)
  if (source === 'editor') mustardState.editor.isOpen = false
}

function onPublishCancel() {
  pendingPublish.value = null
}

/**
 * Core publish logic: creates a remote note.
 * @param localNoteIdToDelete - If provided, the service worker will delete this local note
 *                              after the remote publish succeeds (used when converting local to remote)
 */
function publishToRemote(
  content: string,
  anchorData: MustardNoteType['anchorData'],
  localNoteIdToDelete?: string,
  linkPreview?: MustardNoteType['linkPreview'],
  linkPreviewDismissed?: boolean,
) {
  // Publishing is the moment a pre-upgrade draft's legacy page key becomes
  // canonical (e.g. appview URL → AT-URI); canonical keys pass through. The
  // draft itself still lives under its original key — deletion needs it.
  const localNotePageUrl = anchorData.pageUrl
  const canonicalPageUrl = anchorData.pageUrl.startsWith('at://')
    ? anchorData.pageUrl
    : siteStrategyFor(anchorData.pageUrl).getPageKey()
  if (canonicalPageUrl !== anchorData.pageUrl) {
    anchorData = { ...anchorData, pageUrl: canonicalPageUrl }
  }
  if (!mustardState.currentUserId) {
    // User not logged in - prompt them to login
    alert('Please log in via the extension popup to publish notes')
    return
  }

  // Mark the note as pending (if converting from local)
  if (localNoteIdToDelete) {
    mustardState.pendingNoteIds[localNoteIdToDelete] = true
  }

  event.emit(
    createUpsertNoteMessage(
      {
        content,
        linkPreview,
        linkPreviewDismissed,
        anchorData,
        updatedAt: Date.now(),
      },
      'remote',
      localNoteIdToDelete,
      localNoteIdToDelete ? localNotePageUrl : undefined,
    ),
  )
}

/** Note: user clicked delete icon on a note */
function onNoteDelete(note: MustardNoteType) {
  if (!note.id) return
  mustardState.pendingNoteIds[note.id] = true
  event.emit(createDeleteNoteMessage(note.id, note.anchorData.pageUrl, note.authorId))
}

/** Note: user toggled the repost button on a note */
function onNoteRepost(note: MustardNoteType, reposted: boolean) {
  if (!note.id) return
  event.emit(createSetRepostMessage(note.id, note.anchorData.pageUrl, reposted))
}

/**
 * Note: user pressed hide. The note isn't removed from `mustardState.notes` — the
 * render gate drops it (animating out via the TransitionGroup) while it stays in
 * the list, which is what lets an un-hide re-render it with no re-query.
 *
 * `hiddenNoteIds` is set optimistically so the note leaves the screen on this
 * frame; the storage write then fans the same update out to every other tab via
 * the `storage.onChanged` listener in the content script.
 */
function onNoteHide(note: MustardNoteType) {
  const ref = makeHiddenNoteRef(note, Date.now())
  if (!ref) return
  const wasTemporarilyRevealed = !!mustardState.revealedHiddenNoteIds[ref.noteId]
  delete mustardState.revealedHiddenNoteIds[ref.noteId]
  mustardState.hiddenNoteIds[ref.noteId] = true
  hideNote(ref).catch((err) => {
    // The write failed, so the note isn't actually hidden — put it back rather
    // than leave the user believing a hide stuck that won't survive a reload.
    console.error('mustard: could not hide note:', err)
    delete mustardState.hiddenNoteIds[ref.noteId]
    if (wasTemporarilyRevealed) mustardState.revealedHiddenNoteIds[ref.noteId] = true
  })
  showMustardToast({
    id: 'mustard-hidden-note-toast',
    text: 'Note hidden — un-hide it in Mustard options',
    autoDismissMs: 5000,
    onClick: (dismiss) => {
      sendMessage({ type: 'OPEN_OPTIONS_PAGE' }).catch(() => {})
      dismiss()
    },
  })
}

/**
 * Note: user pressed un-hide on a note revealed here ("show all notes on this
 * page" or notification deep-link repair). Mirror of `onNoteHide`: clear the id
 * optimistically so the note lifts back to full emphasis this frame, then persist
 * — which fans out to every other tab via the `storage.onChanged` listener.
 */
function onNoteUnhide(note: MustardNoteType) {
  if (!note.id) return
  const noteId = note.id
  delete mustardState.revealedHiddenNoteIds[noteId]
  delete mustardState.hiddenNoteIds[noteId]
  unhideNote(noteId).catch((err) => {
    // The write failed, so the note is still hidden — restore the flag rather
    // than leave the user believing an un-hide stuck that won't survive a reload.
    console.error('mustard: could not un-hide note:', err)
    mustardState.hiddenNoteIds[noteId] = true
  })
}
</script>

<template>
  <div class="mustard-root" @keydown="onRootKeyDown" @keyup.stop @keypress.stop>
    <!-- Existing notes (TransitionGroup animates notes in/out when visibility toggles) -->
    <TransitionGroup name="mustard-note">
      <MustardNote
        v-for="({ note, position, dragOffset }, index) in notesWithPositions"
        :key="note.id ?? `unsaved-${index}`"
        :note="note"
        :drag-offset="dragOffset"
        class="mustard-positioned"
        :style="{ left: `${position.x}px`, top: `${position.y}px` }"
        @pressed-publish="onNotePublish"
        @pressed-delete="onNoteDelete"
        @pressed-repost="onNoteRepost"
        @pressed-hide="onNoteHide"
        @pressed-unhide="onNoteUnhide"
        @drag="(offset) => setDragOffset(note.id, offset)"
      >
        <PublishConfirmBubble
          v-if="pendingPublish?.source === note.id"
          variant="danger"
          title="Attention!"
          :providers="mustardState.connectedProviders"
          @confirm="onPublishConfirm"
          @cancel="onPublishCancel"
        />
      </MustardNote>
    </TransitionGroup>

    <!-- Note editor -->
    <Transition name="mustard-note">
      <MustardNoteEditor
        v-if="mustardState.editor.isOpen"
        :anchor="mustardState.editor.anchor"
        class="mustard-positioned"
        :style="{ left: `${editorPosition.x}px`, top: `${editorPosition.y}px` }"
        @pressed-x="onEditorClose"
        @pressed-save="onEditorSave"
        @pressed-publish="onEditorPublish"
      >
        <PublishConfirmBubble
          v-if="pendingPublish?.source === 'editor'"
          variant="danger"
          title="Attention!"
          :providers="mustardState.connectedProviders"
          @confirm="onPublishConfirm"
          @cancel="onPublishCancel"
        />
      </MustardNoteEditor>
    </Transition>
  </div>
</template>

<style>
@import './content-styles.css';
</style>

<style scoped>
.mustard-root {
  position: absolute;
  top: 0;
  left: 0;
  width: 0;
  height: 0;
  z-index: 2147483647;
  pointer-events: none;
  font-family: var(--mustard-font);
}

.mustard-root > * {
  pointer-events: auto;
}

.mustard-positioned {
  position: fixed;
}

.mustard-note-enter-active,
.mustard-note-leave-active {
  transition: all 0.3s cubic-bezier(0.38, -0.9, 0.5, 1.95);
}

.mustard-note-enter-from,
.mustard-note-leave-to {
  opacity: 0;
  transform: scale(0.95);
}
</style>
