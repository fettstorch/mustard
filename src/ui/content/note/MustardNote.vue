<script setup lang="ts">
import { computed, inject, ref, onUnmounted } from 'vue'
import type { MustardNote } from '@/shared/model/MustardNote'
import type { MustardState } from '../mustard-state'
import IconButton from '../IconButton.vue'
import MustardNoteHeader from '../MustardNoteHeader.vue'
import AuthorAvatar from './AuthorAvatar.vue'
import { parseContent } from './parse-content'

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

function onDragStart(e: MouseEvent) {
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

const parsedContent = computed(() => {
  return parseContent(props.note.content)
})
</script>

<template>
  <div
    class="mustard-note mustard-plastic mustard-rounded mustard-text-content mustard-padding"
    :class="{ 'is-dragging': isDragging }"
    style="width: fit-content; padding-top: 8px; padding-bottom: 4px"
    @mousedown="onDragStart"
  >
    <!-- Header -->
    <div class="mustard-note-header">
      <!-- Author avatar (remote notes only) -->
      <AuthorAvatar v-if="isRemoteNote" :profile="authorProfile" />
      <MustardNoteHeader style="translate: 5px; flex: 1">
        <template v-if="isMyOwnNote">
          <!-- Local note: show publish action -->
          <IconButton
            v-if="isLocalNote"
            icon="publish"
            :disabled="isPending"
            @click="emit('pressed-publish', note)"
            @mousedown.stop
          />
          <!-- Remote note: show published indicator (non-interactive) -->
          <IconButton v-if="isRemoteNote" icon="published" :static="true" />
          <IconButton
            icon="trash"
            :disabled="isPending"
            @click="emit('pressed-delete', note)"
            @mousedown.stop
          />
        </template>
      </MustardNoteHeader>
    </div>
    <!-- Note Content (read-only) -->
    <div class="mustard-note-content" style="width: 260px">
      <template v-for="(segment, i) in parsedContent" :key="i">
        <span v-if="segment.type === 'text'">{{ segment.value }}</span>
        <img
          v-else-if="segment.type === 'image'"
          :src="segment.value"
          :alt="segment.value"
          draggable="false"
          referrerpolicy="no-referrer"
          class="mustard-note-image"
          @mousedown.stop
        />
        <a
          v-else
          :href="segment.value"
          target="_blank"
          rel="noopener noreferrer"
          class="mustard-note-link"
          @mousedown.stop
        >
          {{ segment.value }}
        </a>
      </template>
    </div>
    <!-- Date footer -->
    <div class="mustard-note-date">
      {{ formattedDate }}
    </div>
  </div>
</template>

<style scoped>
.mustard-note {
  cursor: grab;
  user-select: none;
}

.mustard-note.is-dragging {
  cursor: grabbing;
}

.mustard-note-header {
  display: flex;
  flex-direction: row;
  align-items: center;
  gap: 8px;
  margin-bottom: 8px;
}

.mustard-note-content {
  white-space: pre-wrap;
  word-break: break-word;
}

.mustard-note-image {
  max-width: 100%;
  height: auto;
  border-radius: 4px;
  display: block;
  margin: 4px 0;
  pointer-events: none;
  user-select: none;
}

.mustard-note-link {
  word-break: break-all;
}

.mustard-note-date {
  text-align: right;
  font-size: 0.75em;
  opacity: 0.5;
  margin-top: 8px;
}
</style>
