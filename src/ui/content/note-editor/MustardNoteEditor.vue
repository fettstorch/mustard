<script setup lang="ts">
import { onMounted, onUnmounted, useTemplateRef, ref, computed } from 'vue'
import IconButton from '../IconButton.vue'
import MustardNoteHeader from '../MustardNoteHeader.vue'
import { LIMITS } from '@/shared/constants'

const emit = defineEmits<{
  (e: 'pressed-x'): void
  (e: 'pressed-save', data: { content: string }): void
  (e: 'pressed-publish', data: { content: string }): void
}>()

const editorContainerRef = useTemplateRef<HTMLDivElement>('editorContainer')
const currentLength = ref(0)

const isOverLimit = computed(() => currentLength.value > LIMITS.CONTENT_MAX_LENGTH)
const characterCountText = computed(() => `${currentLength.value}/${LIMITS.CONTENT_MAX_LENGTH}`)

onMounted(() => {
  const editorEl = document.getElementById('mustard-editor-el')
  if (!editorEl) return
  editorEl.innerHTML = ''
  editorEl.focus()
  editorEl.addEventListener('input', updateCharacterCount)
  document.addEventListener('keydown', handleKeyDown)
})

onUnmounted(() => {
  const editorEl = document.getElementById('mustard-editor-el')
  if (editorEl) {
    editorEl.removeEventListener('input', updateCharacterCount)
  }
  document.removeEventListener('keydown', handleKeyDown)
})

function updateCharacterCount() {
  currentLength.value = getEditorContent().length
}

function handleKeyDown(event: KeyboardEvent) {
  if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
    handleSave()
  }
}

function handleFocusOut(event: FocusEvent) {
  const container = editorContainerRef.value
  if (!container) return

  // If focus is moving to another element within the editor, don't close
  if (event.relatedTarget instanceof Node && container.contains(event.relatedTarget)) {
    return
  }

  emit('pressed-x')
}

function getEditorContent(): string {
  const editorEl = document.getElementById('mustard-editor-el')
  if (!editorEl) return ''
  return editorEl.textContent || ''
}

function handleSave() {
  // Allow local saves even if over limit - user's local storage
  const content = getEditorContent()
  emit('pressed-save', { content })
}

function handlePublish() {
  if (isOverLimit.value) return
  const content = getEditorContent()
  emit('pressed-publish', { content })
}
</script>

<template>
  <div
    ref="editorContainer"
    tabindex="-1"
    class="mustard-note-editor mustard-notes-bg mustard-notes-border mustard-notes-txt mustard-notes-padding"
    style="width: fit-content; padding-top: 8px"
    @focusout="handleFocusOut"
  >
    <!-- Header -->
    <MustardNoteHeader style="translate: 5px; margin-bottom: 8px">
      <IconButton icon="save" @click="handleSave" />
      <IconButton icon="publish" :disabled="isOverLimit" @click="handlePublish" />
      <IconButton icon="x" @click="emit('pressed-x')" />
    </MustardNoteHeader>
    <!-- User-Writable Textarea -->
    <div
      id="mustard-editor-el"
      contenteditable="true"
      style="width: 260px; caret-color: var(--mustard-border)"
    ></div>
    <!-- Character count -->
    <div class="character-count" :class="{ 'over-limit': isOverLimit }">
      {{ characterCountText }}
    </div>
  </div>
</template>

<style scoped>
#mustard-editor-el:empty::before {
  content: 'Write your note...';
  color: var(--mustard-border-faded);
  pointer-events: none;
}

#mustard-editor-el:focus {
  outline: none;
}

.character-count {
  text-align: right;
  font-size: 0.75em;
  opacity: 0.5;
  margin-top: 8px;
}

.character-count.over-limit {
  opacity: 1;
  color: #d32f2f;
  font-weight: bold;
}
</style>
