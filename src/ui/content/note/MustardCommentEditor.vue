<script setup lang="ts">
import { computed, onMounted, ref, nextTick, inject } from 'vue'
import { useEditor, EditorContent } from '@tiptap/vue-3'
import AuthorAvatar from './AuthorAvatar.vue'
import { createEditorExtensions } from '../note-editor/editor-extensions'
import { useMentionCandidates } from '../note-editor/use-mention-candidates'
import type { MustardState } from '../mustard-state'
import type { UserProfile } from '@/shared/model/UserProfile'
import { LIMITS } from '@/shared/constants'

const props = defineProps<{
  profile: UserProfile | null
  pending: boolean
}>()

const emit = defineEmits<{
  (e: 'submit', data: { content: string }): void
}>()

const mustardState = inject<MustardState>('mustardState')!

const { candidates } = useMentionCandidates()

const editor = useEditor({
  extensions: createEditorExtensions({
    placeholder: 'Add a comment... gif via /wow, mention with @',
    getCandidates: () => candidates.value,
  }),
})

// Reactive length so the counter / submit-state update on every change.
const length = ref(0)
function refreshLength() {
  length.value = editor.value?.getMarkdown().trim().length ?? 0
}

const isOverLimit = computed(() => length.value > LIMITS.COMMENT_CONTENT_MAX_LENGTH)
const characterCountText = computed(() => `${length.value}/${LIMITS.COMMENT_CONTENT_MAX_LENGTH}`)
// Outdated clients can't write remotely; keep Send disabled so submit() never
// runs (it clears the editor) and the user's comment draft is preserved.
const canSubmit = computed(
  () => !props.pending && length.value > 0 && !isOverLimit.value && !mustardState.clientOutdated,
)

onMounted(() => {
  editor.value?.on('update', refreshLength)
})

function submit() {
  if (!canSubmit.value || !editor.value) return
  const content = editor.value.getMarkdown().trim()
  emit('submit', { content })
  editor.value.commands.clearContent()
  refreshLength()
}

function onKeydown(e: KeyboardEvent) {
  // Cmd/Ctrl+Enter submits (mirrors the note editor).
  if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
    e.preventDefault()
    submit()
  }
}

defineExpose({
  focusInput() {
    nextTick(() => editor.value?.commands.focus('end'))
  },
})
</script>

<template>
  <div class="mustard-comment-editor-wrapper">
    <div class="mustard-comment-input">
      <AuthorAvatar :profile="profile" class="mustard-comment-input-avatar" />
      <div
        class="mustard-notes-input mustard-comment-editor"
        :class="{ 'is-pending': pending }"
        @keydown="onKeydown"
        @mousedown.stop
      >
        <EditorContent :editor="editor" />
      </div>
      <button
        type="button"
        class="mustard-notes-btn-primary mustard-comment-send"
        :disabled="!canSubmit"
        :title="
          mustardState.clientOutdated
            ? 'Update Mustard to comment (this version is no longer supported)'
            : undefined
        "
        @click="submit"
        @mousedown.stop
      >
        Send
      </button>
    </div>
    <div v-if="length > 0" class="mustard-comment-charcount" :class="{ 'over-limit': isOverLimit }">
      {{ characterCountText }}
    </div>
  </div>
</template>

<style scoped>
.mustard-comment-input {
  display: flex;
  align-items: flex-start;
  gap: 6px;
  margin-top: 8px;
}

.mustard-comment-input-avatar {
  margin-top: 4px;
  flex-shrink: 0;
}

.mustard-comment-editor {
  flex: 1;
  min-width: 0;
  font-size: 0.85em;
  padding: 6px 8px;
  max-height: 160px;
  overflow-y: auto;
}

.mustard-comment-editor.is-pending {
  opacity: 0.6;
  pointer-events: none;
}

:deep(.ProseMirror) {
  outline: none;
  min-height: 2.4em;
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

:deep(.ProseMirror .mustard-note-image) {
  min-width: 0;
  max-width: 160px;
  max-height: 160px;
  width: auto;
  height: auto;
  object-fit: contain;
}

.mustard-comment-send {
  padding: 4px 12px;
  font-size: 0.8em;
}

.mustard-comment-charcount {
  text-align: right;
  font-size: 0.7em;
  margin-top: 4px;
  opacity: 0.6;
}

.mustard-comment-charcount.over-limit {
  opacity: 1;
  color: #d32f2f;
  font-weight: bold;
}
</style>
