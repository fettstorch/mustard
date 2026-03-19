<script setup lang="ts">
import { computed, inject, ref, onUnmounted } from 'vue'
import type { MustardNote } from '@/shared/model/MustardNote'
import type { MustardState } from '../mustard-state'
import IconButton from '../IconButton.vue'
import MustardNoteHeader from '../MustardNoteHeader.vue'
import AuthorAvatar from './AuthorAvatar.vue'
import { renderContent } from './render-content'
import { LIMITS } from '@/shared/constants'

const props = defineProps<{
  note: MustardNote
  dragOffset: { x: number; y: number }
}>()

const emit = defineEmits<{
  (e: 'pressed-publish', note: MustardNote): void
  (e: 'pressed-delete', note: MustardNote): void
  (e: 'drag', offset: { x: number; y: number }): void
}>()

// Drag state
const isDragging = ref(false)
const dragStart = ref({ x: 0, y: 0 })
const offsetAtDragStart = ref({ x: 0, y: 0 })

/** Only stop propagation for links — let other content clicks start a drag */
function onContentMousedown(e: MouseEvent) {
  if ((e.target as HTMLElement).closest('a')) {
    e.stopPropagation()
  }
}

function onDragStart(e: MouseEvent) {
  if (isMinimized.value && !isHovered.value) return
  e.preventDefault()
  isDragging.value = true
  dragStart.value = { x: e.clientX, y: e.clientY }
  offsetAtDragStart.value = { x: props.dragOffset.x, y: props.dragOffset.y }
  document.addEventListener('mousemove', onDragMove)
  document.addEventListener('mouseup', onDragEnd)
}

function onDragMove(e: MouseEvent) {
  if (!isDragging.value) return
  const deltaX = e.clientX - dragStart.value.x
  const deltaY = e.clientY - dragStart.value.y
  emit('drag', {
    x: offsetAtDragStart.value.x + deltaX,
    y: offsetAtDragStart.value.y + deltaY,
  })
}

function onDragEnd() {
  if (!isDragging.value) return
  isDragging.value = false
  document.removeEventListener('mousemove', onDragMove)
  document.removeEventListener('mouseup', onDragEnd)
}

onUnmounted(() => {
  document.removeEventListener('mousemove', onDragMove)
  document.removeEventListener('mouseup', onDragEnd)
})

const mustardState = inject<MustardState>('mustardState')!

const isMyOwnNote = computed(() => {
  const authorId = props.note.authorId
  const currentUserDid = mustardState.currentUserDid
  // Note is mine if: it's a local note OR it was created by my logged-in account
  return authorId === 'local' || (currentUserDid !== null && authorId === currentUserDid)
})

const isLocalNote = computed(() => {
  return props.note.authorId === 'local'
})

const isRemoteNote = computed(() => {
  return props.note.authorId !== 'local'
})

const isPending = computed(() => {
  return props.note.id ? !!mustardState.pendingNoteIds[props.note.id] : false
})

const formattedDate = computed(() => {
  return props.note.updatedAt.toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  })
})

const authorProfile = computed(() => {
  if (!isRemoteNote.value) return null
  return mustardState.profiles[props.note.authorId] ?? null
})

const renderedContent = computed(() => {
  return renderContent(props.note.content)
})

const isOverLimit = computed(() => {
  return props.note.content.length > LIMITS.CONTENT_MAX_LENGTH
})

const isPublishDisabled = computed(() => {
  return isPending.value || isOverLimit.value
})

const characterCountText = computed(() => {
  return `${props.note.content.length}/${LIMITS.CONTENT_MAX_LENGTH}`
})

const shouldShowCharacterCount = computed(() => {
  return isLocalNote.value && isOverLimit.value
})

const isHovered = ref(false)

const isMinimized = computed(() => mustardState.areNotesMinimized)
</script>

<template>
  <div
    class="mustard-note mustard-notes-bg mustard-notes-border mustard-notes-txt mustard-notes-padding"
    :class="{ 'is-dragging': isDragging, 'is-minimized': isMinimized }"
    style="width: fit-content; padding-top: 8px; padding-bottom: 4px"
    @mousedown="onDragStart"
    @mouseenter="isHovered = true"
    @mouseleave="isHovered = false"
  >
    <!-- Header -->
    <div class="mustard-note-header">
      <AuthorAvatar v-if="isRemoteNote" :profile="authorProfile" />
      <MustardNoteHeader class="mustard-note-actions" style="translate: 5px; flex: 1">
        <template v-if="isMyOwnNote">
          <IconButton
            v-if="isLocalNote"
            icon="publish"
            title="Publish this note (do not publish sensitive data)"
            :disabled="isPublishDisabled"
            @click="emit('pressed-publish', note)"
            @mousedown.stop
          />
          <IconButton
            icon="trash"
            title="Delete this note"
            :disabled="isPending"
            @click="emit('pressed-delete', note)"
            @mousedown.stop
          />
        </template>
      </MustardNoteHeader>
    </div>
    <!-- Collapsible body (content + date + slot) -->
    <div class="mustard-note-body">
      <div class="mustard-note-body-inner">
        <!-- eslint-disable-next-line vue/no-v-html -->
        <div
          class="mustard-note-content"
          style="width: 260px"
          v-html="renderedContent"
          @mousedown="onContentMousedown"
        />
        <div v-if="shouldShowCharacterCount" class="character-count over-limit">
          {{ characterCountText }}
        </div>
        <div class="mustard-note-date">
          {{ formattedDate }}
          <IconButton
            v-if="isRemoteNote && isMyOwnNote"
            icon="published"
            :static="true"
            title="This note is published"
          />
        </div>
        <slot />
      </div>
    </div>
  </div>
</template>

<style scoped>
.mustard-note {
  cursor: grab;
  user-select: none;
  overflow: hidden;
}

.mustard-note.is-dragging {
  cursor: grabbing;
}

/* --- Minimized state ---
 * The note itself becomes the minimized indicator: clipped to a small pill
 * via max-width + overflow:hidden. On hover it expands back to full size.
 *
 * Expand (hover enter): width first (no delay), then height (delayed).
 * Collapse (hover leave): height first (no delay), then width (delayed).
 */

.mustard-note.is-minimized {
  max-width: 38px;
  padding: 4px !important;
  cursor: pointer;
  /* Collapse: height shrinks first, width shrinks after */
  transition:
    max-width 0.2s ease 0.12s,
    padding 0.2s ease;
}

.mustard-note.is-minimized:hover {
  max-width: 300px;
  padding: 8px 0.5em 4px !important;
  cursor: grab;
  /* Expand: width grows first, height grows after */
  transition:
    max-width 0.2s ease,
    padding 0.2s ease;
}

/* Header margin collapses when minimized */

.mustard-note-header {
  display: flex;
  flex-direction: row;
  align-items: center;
  gap: 8px;
  margin-bottom: 8px;
  transition: margin-bottom 0.2s ease;
}

.mustard-note.is-minimized .mustard-note-header {
  margin-bottom: 0;
}

.mustard-note.is-minimized:hover .mustard-note-header {
  margin-bottom: 8px;
}

/* Header actions: hidden when minimized, fade in on hover */

.mustard-note.is-minimized .mustard-note-actions {
  opacity: 0;
  pointer-events: none;
}

.mustard-note.is-minimized:hover .mustard-note-actions {
  opacity: 1;
  pointer-events: auto;
  transition: opacity 0.15s ease 0.15s;
}

/* Body: CSS grid for smooth height animation */

.mustard-note-body {
  display: grid;
  grid-template-rows: 1fr;
  opacity: 1;
}

.mustard-note-body-inner {
  overflow: hidden;
}

.mustard-note.is-minimized .mustard-note-body {
  grid-template-rows: 0fr;
  opacity: 0;
  /* Collapse: height shrinks immediately (before width) */
  transition:
    grid-template-rows 0.2s ease,
    opacity 0.15s ease;
}

.mustard-note.is-minimized:hover .mustard-note-body {
  grid-template-rows: 1fr;
  opacity: 1;
  /* Expand: height grows after width (delayed) */
  transition:
    grid-template-rows 0.2s ease 0.1s,
    opacity 0.2s ease 0.1s;
}

/* --- Content styles --- */

.mustard-note-content {
  word-break: break-word;
}

:deep(.mustard-note-content p) {
  margin: 0 !important;
}

:deep(.mustard-note-content p:empty) {
  display: none;
}

:deep(.mustard-note-image) {
  max-width: 100%;
  height: auto;
  border-radius: 4px;
  display: block;
  margin: 4px 0;
  pointer-events: none;
  user-select: none;
}

:deep(.mustard-note-link) {
  word-break: break-all;
}

.character-count {
  text-align: right;
  font-size: 0.75em;
  margin-top: 8px;
}

.character-count.over-limit {
  opacity: 1;
  color: #d32f2f;
  font-weight: bold;
}

.mustard-note-date {
  display: flex;
  justify-content: flex-end;
  align-items: center;
  gap: 2px;
  font-size: 0.75em;
  opacity: 0.5;
  margin-top: 8px;
}

.mustard-note-date :deep(.icon-static) {
  padding: 0;
}
</style>
