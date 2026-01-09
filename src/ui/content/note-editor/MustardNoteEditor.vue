<script setup lang="ts">
import { onMounted, useTemplateRef } from 'vue'
import IconButton from '../IconButton.vue'
import MustardNoteHeader from '../MustardNoteHeader.vue'

const emit = defineEmits(['pressed-x'])

const editorContainerRef = useTemplateRef<HTMLDivElement>('editorContainer')

onMounted(() => {
  const editorEl = document.getElementById('mustard-editor-el')
  if (!editorEl) return
  editorEl.innerHTML = ''
  editorEl.focus()
})

function handleFocusOut(event: FocusEvent) {
  const container = editorContainerRef.value
  if (!container) return

  // If focus is moving to another element within the editor, don't close
  if (event.relatedTarget instanceof Node && container.contains(event.relatedTarget)) {
    return
  }

  emit('pressed-x')
}
</script>

<template>
  <div
    ref="editorContainer"
    tabindex="-1"
    class="mustard-note-editor mustard-plastic mustard-rounded mustard-text-content mustard-padding"
    style="width: fit-content; padding-top: 8px"
    @focusout="handleFocusOut"
  >
    <!-- Header -->
    <MustardNoteHeader style="translate: 5px; margin-bottom: 8px">
      <IconButton icon="eye-open" />
      <IconButton icon="x" @click="emit('pressed-x')" />
    </MustardNoteHeader>
    <!-- User-Writable Textarea -->
    <div
      id="mustard-editor-el"
      contenteditable="true"
      style="width: 260px; caret-color: #5c3a1e"
    ></div>
  </div>
</template>

<style scoped>
#mustard-editor-el:empty::before {
  content: 'Write your note...';
  color: #5c3a1e50;
  pointer-events: none;
}

#mustard-editor-el:focus {
  outline: none;
}
</style>
