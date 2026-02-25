<script setup lang="ts">
import { inject, computed, onMounted, onUnmounted, ref, reactive, defineAsyncComponent } from 'vue'
import type { MustardState } from './mustard-state'
import { calculateAnchorPosition } from './anchor-utils'
const MustardNoteEditor = defineAsyncComponent(
  () => import('./note-editor/MustardNoteEditor.vue'),
)
import MustardNote from './note/MustardNote.vue'
import type { MustardNote as MustardNoteType } from '@/shared/model/MustardNote'
import type { Observable } from '@fettstorch/jule'
import { createUpsertNoteMessage, createDeleteNoteMessage, type Message } from '@/shared/messaging'
import { LIMITS } from '@/shared/constants'

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

const editorPosition = computed(() => {
  // eslint-disable-next-line @typescript-eslint/no-unused-expressions
  resizeTick.value // dependency to trigger recalculation
  if (!mustardState.editor.isOpen || !mustardState.editor.anchor) return { x: 0, y: 0 }
  return calculateAnchorPosition(mustardState.editor.anchor)
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

/** Compute positions for all notes (including drag offset) */
const notesWithPositions = computed(() => {
  // eslint-disable-next-line @typescript-eslint/no-unused-expressions
  resizeTick.value // dependency to trigger recalculation
  if (!mustardState.areNotesVisible) return []
  return mustardState.notes.map((note) => {
    const anchorPos = calculateAnchorPosition(note.anchorData)
    const offset = getDragOffset(note.id)
    return {
      note,
      position: {
        x: anchorPos.x + offset.x,
        y: anchorPos.y + offset.y,
      },
      dragOffset: offset,
    }
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
})

onUnmounted(() => {
  document.removeEventListener('keydown', handleKeyDown)
  window.removeEventListener('resize', handleResize)
  window.removeEventListener('scroll', handleScroll, true)
})

function handleKeyDown(event: KeyboardEvent) {
  if (event.key === 'Escape') {
    if (mustardState.editor.isOpen) {
      mustardState.editor.isOpen = false
    }
  }
}

/** Editor: user clicked save button to create a local note */
function onEditorSave(data: { content: string }) {
  if (!mustardState.editor.anchor) {
    console.warn('No anchor data found when trying to save note')
    return
  }
  // Allow local saves regardless of length - user's local storage
  event.emit(
    createUpsertNoteMessage(
      {
        content: data.content,
        anchorData: mustardState.editor.anchor,
        updatedAt: Date.now(),
      },
      'local',
    ),
  )
  mustardState.editor.isOpen = false
}

/** Editor: user clicked publish button to create a new remote note */
function onEditorPublish(data: { content: string }) {
  if (!mustardState.editor.anchor) {
    console.warn('No anchor data found when trying to publish note')
    return
  }
  if (data.content.length > LIMITS.CONTENT_MAX_LENGTH) {
    console.warn(`Content exceeds ${LIMITS.CONTENT_MAX_LENGTH} character limit`)
    return
  }
  publishToRemote(data.content, mustardState.editor.anchor)
  mustardState.editor.isOpen = false
}

/** Note: user clicked publish icon on an existing local note to upload it */
function onNotePublish(note: MustardNoteType) {
  publishToRemote(note.content, note.anchorData, note.id ?? undefined)
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
) {
  if (!mustardState.currentUserDid) {
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
        anchorData,
        updatedAt: Date.now(),
      },
      'remote',
      localNoteIdToDelete,
    ),
  )
}

/** Note: user clicked delete icon on a note */
function onNoteDelete(note: MustardNoteType) {
  if (!note.id) return
  mustardState.pendingNoteIds[note.id] = true
  event.emit(createDeleteNoteMessage(note.id, note.anchorData.pageUrl, note.authorId))
}
</script>

<template>
  <div class="mustard-root">
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
        @drag="(offset) => setDragOffset(note.id, offset)"
      />
    </TransitionGroup>

    <!-- Note editor -->
    <Transition name="mustard-note">
      <MustardNoteEditor
        v-if="mustardState.editor.isOpen"
        class="mustard-positioned"
        :style="{ left: `${editorPosition.x}px`, top: `${editorPosition.y}px` }"
        @pressed-x="mustardState.editor.isOpen = false"
        @pressed-save="onEditorSave"
        @pressed-publish="onEditorPublish"
      />
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
