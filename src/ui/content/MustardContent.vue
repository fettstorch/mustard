<script setup lang="ts">
import { inject, computed } from 'vue'
import type { MustardState } from './mustard-state'
import { calculateAnchorPosition } from './anchor-utils'
import MustardNoteEditor from './note-editor/MustardNoteEditor.vue'

const mustardState = inject<MustardState>('mustardState')!

const editorPosition = computed(() => {
  if (!mustardState.editor.isOpen || !mustardState.editor.anchor) return { x: 0, y: 0 }
  return calculateAnchorPosition(mustardState.editor.anchor)
})
</script>

<template>
  <div class="mustard-root">
    <MustardNoteEditor
      v-if="mustardState.editor.isOpen"
      class="mustard-positioned"
      :style="{ left: `${editorPosition.x}px`, top: `${editorPosition.y}px` }"
    />
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
</style>
