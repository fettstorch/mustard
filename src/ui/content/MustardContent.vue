<script setup lang="ts">
import { inject, computed, onMounted, onUnmounted } from 'vue'
import type { MustardState } from './mustard-state'
import { calculateAnchorPosition } from './anchor-utils'
import MustardNoteEditor from './note-editor/MustardNoteEditor.vue'
import type { Observable } from '@fettstorch/jule'
import { createUpsertNoteMessage, type Message } from '@/shared/messaging'

const mustardState = inject<MustardState>('mustardState')!
const event = inject<Observable<Message>>('event')!

const editorPosition = computed(() => {
  if (!mustardState.editor.isOpen || !mustardState.editor.anchor) return { x: 0, y: 0 }
  return calculateAnchorPosition(mustardState.editor.anchor)
})

onMounted(() => {
  document.addEventListener('keydown', handleKeyDown)
})

onUnmounted(() => {
  document.removeEventListener('keydown', handleKeyDown)
})

function handleKeyDown(event: KeyboardEvent) {
  if (event.key === 'Escape') {
    if (mustardState.editor.isOpen) {
      mustardState.editor.isOpen = false
    }
  }
}

function handlePressedSave(data: { content: string }) {
  if (!mustardState.editor.anchor) {
    console.warn('No anchor data found when trying to save note')
    return
  }
  event.emit(
    createUpsertNoteMessage('local', {
      content: data.content,
      anchorData: mustardState.editor.anchor,
      updatedAt: new Date(),
    }),
  )
}
</script>

<template>
  <div class="mustard-root">
    <Transition name="mustard-editor">
      <MustardNoteEditor
        v-if="mustardState.editor.isOpen"
        class="mustard-positioned"
        :style="{ left: `${editorPosition.x}px`, top: `${editorPosition.y}px` }"
        @pressed-x="mustardState.editor.isOpen = false"
        @pressed-save="handlePressedSave"
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
  font-family: 'Azeret Mono', monospace;
}

.mustard-root > * {
  pointer-events: auto;
}

.mustard-positioned {
  position: absolute;
}

.mustard-editor-enter-active,
.mustard-editor-leave-active {
  transition: all 0.3s cubic-bezier(0.38, -0.9, 0.5, 1.95);
}

.mustard-editor-enter-from,
.mustard-editor-leave-to {
  opacity: 0;
  transform: scale(0.95);
}
</style>
