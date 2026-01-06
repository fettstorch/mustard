<script setup lang="ts">
import { inject, computed } from 'vue'
import type { MustardState } from './mustard-state'
import { calculateAnchorPosition } from './anchor-utils'
import MustardNoteEditor from '@/ui/note-editor/MustardNoteEditor.vue'

const mustardState = inject<MustardState>('mustardState')!

const editorPosition = computed(() => {
  if (!mustardState.editor.isOpen || !mustardState.editor.anchor) return { x: 0, y: 0 }
  return calculateAnchorPosition(mustardState.editor.anchor)
})
</script>

<template>
  <div
    class="absolute top-0 left-0 w-0 h-0 z-[2147483647] pointer-events-none [&>*]:pointer-events-auto"
  >
    <MustardNoteEditor
      v-if="mustardState.editor.isOpen"
      class="absolute"
      :style="{ left: `${editorPosition.x}px`, top: `${editorPosition.y}px` }"
    />
  </div>
</template>
