<script setup lang="ts">
import { onMounted, onUnmounted, useTemplateRef, computed } from 'vue'
import { useEditor, EditorContent } from '@tiptap/vue-3'
import StarterKit from '@tiptap/starter-kit'
import { Image } from '@tiptap/extension-image'
import { Placeholder, CharacterCount } from '@tiptap/extensions'
import { Markdown } from '@tiptap/markdown'
import IconButton from '../IconButton.vue'
import MustardNoteHeader from '../MustardNoteHeader.vue'
import { ImageUrlAutoConvert } from './image-url-auto-convert'
import { LIMITS } from '@/shared/constants'

const emit = defineEmits<{
  (e: 'pressed-x'): void
  (e: 'pressed-save', data: { content: string }): void
  (e: 'pressed-publish', data: { content: string }): void
}>()

const editorContainerRef = useTemplateRef<HTMLDivElement>('editorContainer')

const editor = useEditor({
  extensions: [
    StarterKit.configure({
      blockquote: false,
      codeBlock: false,
      heading: false,
      horizontalRule: false,
      bulletList: false,
      orderedList: false,
      listItem: false,
      code: false,
      strike: false,
    }),
    Image.configure({
      inline: false,
      HTMLAttributes: {
        class: 'mustard-note-image',
        draggable: 'false',
        referrerpolicy: 'no-referrer',
      },
    }),
    Placeholder.configure({
      placeholder: 'Write your note...',
    }),
    CharacterCount,
    Markdown,
    ImageUrlAutoConvert,
  ],
  autofocus: true,
  onBlur({ event }) {
    handleFocusOut(event as FocusEvent)
  },
})

const currentLength = computed(() => {
  return editor.value?.storage.characterCount.characters() ?? 0
})

const isOverLimit = computed(() => currentLength.value > LIMITS.CONTENT_MAX_LENGTH)
const characterCountText = computed(() => `${currentLength.value}/${LIMITS.CONTENT_MAX_LENGTH}`)

onMounted(() => {
  document.addEventListener('keydown', handleKeyDown)
})

onUnmounted(() => {
  document.removeEventListener('keydown', handleKeyDown)
})

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
  if (!editor.value) return ''
  return editor.value.getMarkdown()
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
  >
    <!-- Header -->
    <MustardNoteHeader style="translate: 5px; margin-bottom: 8px">
      <IconButton icon="save" @click="handleSave" />
      <IconButton icon="publish" :disabled="isOverLimit" @click="handlePublish" />
      <IconButton icon="x" @click="emit('pressed-x')" />
    </MustardNoteHeader>
    <!-- Rich Text Editor -->
    <EditorContent :editor="editor" />
    <!-- Character count -->
    <div class="character-count" :class="{ 'over-limit': isOverLimit }">
      {{ characterCountText }}
    </div>
  </div>
</template>

<style scoped>
:deep(.ProseMirror) {
  width: 260px;
  caret-color: var(--mustard-border);
  outline: none;
  white-space: pre-wrap;
  word-break: break-word;
}

:deep(.ProseMirror p) {
  margin: 0;
}

:deep(.ProseMirror p.is-editor-empty:first-child::before) {
  content: attr(data-placeholder);
  color: var(--mustard-border-faded);
  pointer-events: none;
  float: left;
  height: 0;
}

:deep(.mustard-note-image) {
  max-width: 100%;
  height: auto;
  border-radius: 4px;
  display: block;
  margin: 4px 0;
  pointer-events: none;
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
