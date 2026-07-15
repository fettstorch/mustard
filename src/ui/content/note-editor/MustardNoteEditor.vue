<script setup lang="ts">
import { onMounted, onUnmounted, useTemplateRef, computed, ref, inject, nextTick } from 'vue'
import { useEditor, EditorContent } from '@tiptap/vue-3'
import IconButton from '../IconButton.vue'
import MustardNoteHeader from '../MustardNoteHeader.vue'
import { createEditorExtensions } from './editor-extensions'
import { useMentionCandidates } from './use-mention-candidates'
import type { MustardNoteAnchorData } from '@/shared/model/MustardNoteAnchorData'
import type { MustardState } from '../mustard-state'
import { LIMITS } from '@/shared/constants'
import LinkPreviewCard from '../note/LinkPreviewCard.vue'
import type { LinkPreview } from '@/shared/model/LinkPreview'
import { extractFirstLinkUrl } from '@/shared/link-preview'
import { createGetLinkPreviewMessage, sendMessage } from '@/shared/messaging'
import { getDebouncer } from '@fettstorch/jule'

const props = defineProps<{
  anchor: MustardNoteAnchorData | null
}>()

type EditorNoteSubmission = {
  content: string
  linkPreview?: LinkPreview
  linkPreviewDismissed?: boolean
}

const emit = defineEmits<{
  (e: 'pressed-x'): void
  (e: 'pressed-save', data: EditorNoteSubmission): void
  (e: 'pressed-publish', data: EditorNoteSubmission): void
}>()

const mustardState = inject<MustardState>('mustardState')!
const editorContainerRef = useTemplateRef<HTMLDivElement>('editorContainer')

// Candidates power the @-mention autocomplete; the getter is read lazily by the
// mention suggestion on each keystroke.
const { candidates } = useMentionCandidates()

const editor = useEditor({
  extensions: createEditorExtensions({
    placeholder: 'Write your note... Or add a gif via /wow, mention with @',
    getCandidates: () => candidates.value,
  }),
  autofocus: true,
  onBlur({ event }) {
    handleFocusOut(event as FocusEvent)
  },
  onUpdate({ editor }) {
    queueLinkPreview(editor.getMarkdown().trim())
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
const draftPreview = ref<LinkPreview>()
const previewDebouncer = getDebouncer()
let previewRequestId = 0
let queuedPreviewUrl: string | undefined
let dismissedPreviewUrl: string | undefined

onMounted(async () => {
  document.addEventListener('keydown', handleKeyDown)
  await nextTick()
  requestAnimationFrame(() => {
    editor.value?.commands.focus('end')
  })
})

onUnmounted(() => {
  document.removeEventListener('keydown', handleKeyDown)
  previewDebouncer.clear()
  previewRequestId++
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

  // The Giphy + mention pickers are appended to document.body. Treat focus
  // moves into either as "still in editor" so the editor doesn't close behind it.
  if (
    event.relatedTarget instanceof Element &&
    event.relatedTarget.closest('.mustard-giphy-picker, .mustard-mention-picker')
  ) {
    return
  }

  emit('pressed-x')
}

function getEditorContent(): string {
  if (!editor.value) return ''
  return editor.value.getMarkdown().trim()
}

/**
 * The editor is a content-script surface, so ask the background to unfurl the
 * first link. Debouncing prevents a request for every keystroke.
 */
function queueLinkPreview(content: string) {
  const url = extractFirstLinkUrl(content)
  if (url === queuedPreviewUrl) return
  queuedPreviewUrl = url
  const requestId = ++previewRequestId
  previewDebouncer.clear()
  draftPreview.value = undefined
  if (!url) {
    dismissedPreviewUrl = undefined
    return
  }
  if (url === dismissedPreviewUrl) {
    return
  }
  dismissedPreviewUrl = undefined
  previewDebouncer.debounce(() => {
    sendMessage(createGetLinkPreviewMessage(url))
      .then((preview) => {
        if (requestId === previewRequestId) draftPreview.value = preview
      })
      .catch((error) => console.debug('mustard [editor] link preview failed:', error))
  }, 600)
}

function dismissLinkPreview() {
  const url = extractFirstLinkUrl(getEditorContent())
  if (!url || draftPreview.value?.url !== url) return
  dismissedPreviewUrl = url
  draftPreview.value = undefined
  previewDebouncer.clear()
  previewRequestId++
}

function currentLinkPreview(content: string): LinkPreview | undefined {
  const url = extractFirstLinkUrl(content)
  return url && draftPreview.value?.url === url ? draftPreview.value : undefined
}

function handleSave() {
  // Allow local saves even if over limit - user's local storage
  const content = getEditorContent()
  emit('pressed-save', {
    content,
    linkPreview: currentLinkPreview(content),
    ...(extractFirstLinkUrl(content) === dismissedPreviewUrl ? { linkPreviewDismissed: true } : {}),
  })
}

function handlePublish() {
  // Outdated clients can't write to the remote DB. Block here so the editor
  // isn't optimistically closed (which would discard the user's draft).
  if (isOverLimit.value || mustardState.clientOutdated) return
  const content = getEditorContent()
  emit('pressed-publish', {
    content,
    linkPreview: currentLinkPreview(content),
    ...(extractFirstLinkUrl(content) === dismissedPreviewUrl ? { linkPreviewDismissed: true } : {}),
  })
}
</script>

<template>
  <div
    ref="editorContainer"
    tabindex="-1"
    class="mustard-note-editor mustard-notes-bg mustard-notes-border mustard-notes-txt mustard-notes-padding"
    style="
      width: fit-content;
      max-width: calc(var(--mustard-note-content-max-width) + 1em);
      padding-top: 8px;
    "
  >
    <!-- Header -->
    <MustardNoteHeader style="translate: 5px; margin-bottom: 8px">
      <IconButton icon="save" title="Save this note locally" @click="handleSave" />
      <IconButton
        icon="publish"
        :title="
          mustardState.clientOutdated
            ? 'Update Mustard to publish (this version is no longer supported)'
            : 'Publish this note (do not publish sensitive data)'
        "
        :disabled="isOverLimit || mustardState.clientOutdated"
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
    <LinkPreviewCard
      v-if="draftPreview"
      :preview="draftPreview"
      dismissible
      @dismiss="dismissLinkPreview"
    />
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
  min-width: min(var(--mustard-note-content-width), var(--mustard-note-content-max-width));
  max-width: var(--mustard-note-content-max-width);
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
  max-width: var(--mustard-note-content-max-width);
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
