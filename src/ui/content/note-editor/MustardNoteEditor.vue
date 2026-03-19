<script setup lang="ts">
import { onMounted, onUnmounted, useTemplateRef, computed, ref, inject } from 'vue'
import { useEditor, EditorContent } from '@tiptap/vue-3'
import StarterKit from '@tiptap/starter-kit'
import { Image } from '@tiptap/extension-image'
import { Placeholder } from '@tiptap/extensions'
import { Markdown } from '@tiptap/markdown'
import IconButton from '../IconButton.vue'
import MustardNoteHeader from '../MustardNoteHeader.vue'
import { ImageUrlAutoConvert } from './image-url-auto-convert'
import type { MustardNoteAnchorData } from '@/shared/messaging'
import type { MustardState } from '../mustard-state'
import { LIMITS } from '@/shared/constants'

const props = defineProps<{
  anchor: MustardNoteAnchorData | null
}>()

const emit = defineEmits<{
  (e: 'pressed-x'): void
  (e: 'pressed-save', data: { content: string }): void
  (e: 'pressed-publish', data: { content: string }): void
}>()

const mustardState = inject<MustardState>('mustardState')!
const editorContainerRef = useTemplateRef<HTMLDivElement>('editorContainer')

const editor = useEditor({
  extensions: [
    StarterKit.configure({}),
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
    Markdown,
    ImageUrlAutoConvert,
  ],
  autofocus: true,
  onBlur({ event }) {
    handleFocusOut(event as FocusEvent)
  },
})

const currentLength = computed(() => {
  if (!editor.value) return 0
  return editor.value.getMarkdown().trim().length
})

const isOverLimit = computed(() => currentLength.value > LIMITS.CONTENT_MAX_LENGTH)
const characterCountText = computed(() => `${currentLength.value}/${LIMITS.CONTENT_MAX_LENGTH}`)

const anchorDisplay = computed(() => {
  if (!props.anchor) return null
  const url = props.anchor.pageUrl
  const selector = props.anchor.elementSelector
  return { url, selector }
})

const selectorExpanded = ref(false)

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
  return editor.value.getMarkdown().trim()
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
      <IconButton icon="save" title="Save this note locally" @click="handleSave" />
      <IconButton
        icon="publish"
        title="Publish this note (do not publish sensitive data)"
        :disabled="isOverLimit"
        @click="handlePublish"
      />
      <IconButton icon="x" title="Close editor" @click="emit('pressed-x')" />
    </MustardNoteHeader>
    <!-- Rich Text Editor -->
    <EditorContent :editor="editor" />
    <!-- Character count -->
    <div class="character-count" :class="{ 'over-limit': isOverLimit }">
      {{ characterCountText }}
    </div>
    <!-- Anchor info -->
    <div v-if="anchorDisplay && mustardState.showAnchorInEditor" class="anchor-info">
      <div class="anchor-row">
        <span class="anchor-label">url</span>
        <span class="anchor-value">{{ anchorDisplay.url }}</span>
      </div>
      <div
        class="anchor-row"
        :class="{
          'anchor-row-expandable': anchorDisplay.selector,
          'anchor-row-expanded': selectorExpanded,
        }"
        @click="anchorDisplay.selector && (selectorExpanded = !selectorExpanded)"
      >
        <span class="anchor-label">{{ anchorDisplay.selector ? 'sel' : 'pos' }}</span>
        <span v-if="anchorDisplay.selector" class="anchor-value">{{ anchorDisplay.selector }}</span>
        <span v-else class="anchor-value anchor-fallback">click position</span>
      </div>
    </div>
    <slot />
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

.anchor-info {
  margin-top: 6px;
  padding-top: 6px;
  border-top: 1px solid var(--mustard-border-subtle);
  display: flex;
  flex-direction: column;
  gap: 2px;
  max-width: 260px;
}

.anchor-row {
  display: flex;
  gap: 6px;
  font-size: 0.65em;
  opacity: 0.45;
  line-height: 1.3;
}

.anchor-label {
  flex-shrink: 0;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.03em;
}

.anchor-row-expandable {
  cursor: pointer;
}

.anchor-row-expandable:hover {
  opacity: 0.7;
}

.anchor-row-expandable .anchor-label::before {
  content: '▸ ';
}

.anchor-row-expanded .anchor-label::before {
  content: '▾ ';
}

.anchor-value {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  min-width: 0;
}

.anchor-row-expanded .anchor-value {
  white-space: pre-wrap;
  word-break: break-all;
}

.anchor-fallback {
  font-style: italic;
}
</style>
