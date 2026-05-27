<script setup lang="ts">
import { computed, inject, nextTick, onMounted, reactive, ref, watch } from 'vue'
import type { Observable } from '@fettstorch/jule'
import type { MustardComment } from '@/shared/model/MustardComment'
import type { MustardNote } from '@/shared/model/MustardNote'
import type { MustardState } from '../mustard-state'
import {
  createUpsertCommentMessage,
  createDeleteCommentMessage,
  type Message,
} from '@/shared/messaging'
import { LIMITS } from '@/shared/constants'
import MustardCommentItem from './MustardCommentItem.vue'
import AuthorAvatar from './AuthorAvatar.vue'
import GiphyPicker from '../note-editor/GiphyPicker.vue'

// Matches `/<search-term>` at end of text up to caret. Requires either start-of-input
// or whitespace before the slash so it doesn't fire inside e.g. a URL (`http://...`).
const GIPHY_TEXTAREA_REGEX = /(?:^|\s)\/([^\n/]*)$/

const props = defineProps<{
  note: MustardNote
}>()

const emit = defineEmits<{
  (e: 'request-login'): void
}>()

const mustardState = inject<MustardState>('mustardState')!
const event = inject<Observable<Message>>('event')!

const draft = ref('')
const scrollEl = ref<HTMLElement | null>(null)
const textareaEl = ref<HTMLTextAreaElement | null>(null)
const pickerRef = ref<InstanceType<typeof GiphyPicker> | null>(null)

const giphy = reactive({
  active: false,
  query: '',
  start: 0,
  end: 0,
})

/**
 * Inspects the text up to the caret and toggles the picker state. When active,
 * `start`..`end` is the `/<query>` range to be replaced on GIF selection.
 */
function detectGiphyTrigger() {
  const textarea = textareaEl.value
  if (!textarea) {
    giphy.active = false
    return
  }
  const caret = textarea.selectionStart ?? draft.value.length
  const match = draft.value.slice(0, caret).match(GIPHY_TEXTAREA_REGEX)
  if (!match) {
    giphy.active = false
    return
  }
  // [^\n/]* always matches (zero-or-more), so match[1] is guaranteed.
  const query = match[1]!
  giphy.active = true
  giphy.query = query.trim()
  giphy.end = caret
  giphy.start = caret - query.length - 1 // -1 for the leading `/`
}

const giphyClientRect = () => textareaEl.value?.getBoundingClientRect() ?? null

function onGiphySelect(gif: { src: string }) {
  if (!giphy.active) return
  const before = draft.value.slice(0, giphy.start)
  const after = draft.value.slice(giphy.end)
  const sep = after.startsWith(' ') || after.startsWith('\n') || after.length === 0 ? '' : ' '
  draft.value = `${before}${gif.src}${sep}${after}`
  const newCaret = giphy.start + gif.src.length + sep.length
  giphy.active = false
  nextTick(() => {
    const el = textareaEl.value
    if (!el) return
    el.focus()
    el.setSelectionRange(newCaret, newCaret)
  })
}

const comments = computed<MustardComment[]>(() => {
  return props.note.id ? (mustardState.comments[props.note.id] ?? []) : []
})

const isLoggedIn = computed(() => mustardState.currentUserDid !== null)

const myProfile = computed(() => {
  const me = mustardState.currentUserDid
  return me ? (mustardState.profiles[me] ?? null) : null
})

const isOverLimit = computed(() => draft.value.length > LIMITS.COMMENT_CONTENT_MAX_LENGTH)
const trimmedDraft = computed(() => draft.value.trim())
const isPending = computed(() => {
  if (!props.note.id) return false
  return !!mustardState.pendingCommentForNoteIds[props.note.id]
})

const canSubmit = computed(() => {
  return isLoggedIn.value && !isPending.value && trimmedDraft.value.length > 0 && !isOverLimit.value
})

const characterCountText = computed(() => {
  return `${draft.value.length}/${LIMITS.COMMENT_CONTENT_MAX_LENGTH}`
})

function submit() {
  if (!canSubmit.value) return
  if (!props.note.id) return
  const content = trimmedDraft.value
  event.emit(createUpsertCommentMessage(props.note.id, content))
  draft.value = ''
  giphy.active = false
}

function onDelete(comment: MustardComment) {
  if (!props.note.id) return
  event.emit(createDeleteCommentMessage(comment.id, props.note.id))
}

function onTextareaKeydown(e: KeyboardEvent) {
  // Cmd/Ctrl+Enter submits — regardless of picker state.
  if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
    e.preventDefault()
    submit()
    return
  }

  if (giphy.active) {
    const handled = pickerRef.value?.onKeyDown?.(e)
    if (handled) {
      e.preventDefault()
    }
  }
}

function onTextareaInputOrClick() {
  // Caret may have moved without text changing (arrow keys, click); re-evaluate.
  detectGiphyTrigger()
}

watch(draft, detectGiphyTrigger)

async function scrollToBottom() {
  await nextTick()
  // Wait one more frame so the parent's grid-template-rows transition can
  // realise the wrapper's height; without this scrollHeight may be 0 on
  // first mount while the row is still mid-animation.
  await new Promise((resolve) => requestAnimationFrame(() => resolve(undefined)))
  const el = scrollEl.value
  if (!el) return
  // Smooth scroll where supported; falls back to instant if not.
  try {
    el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' })
  } catch {
    el.scrollTop = el.scrollHeight
  }
}

// Keep scroll glued to bottom (chat-like) whenever new comments arrive.
watch(() => comments.value.length, scrollToBottom)

// And once on mount — i.e. when the thread is opened — so the user always
// lands at the newest comment regardless of prior state.
onMounted(() => {
  scrollToBottom()
})

defineExpose({
  focusInput() {
    textareaEl.value?.focus()
  },
})
</script>

<template>
  <div class="mustard-comment-thread" @mousedown.stop>
    <div ref="scrollEl" class="mustard-comment-list">
      <p v-if="comments.length === 0" class="mustard-comment-empty">No comments yet.</p>
      <MustardCommentItem
        v-for="c in comments"
        :key="c.id"
        :comment="c"
        @pressed-delete="onDelete"
      />
    </div>

    <div v-if="isLoggedIn" class="mustard-comment-input">
      <AuthorAvatar :profile="myProfile" class="mustard-comment-input-avatar" />
      <textarea
        ref="textareaEl"
        v-model="draft"
        class="mustard-notes-input mustard-comment-textarea"
        rows="2"
        placeholder="Add a comment... Or a gif via e.g. /wow"
        :maxlength="LIMITS.COMMENT_CONTENT_MAX_LENGTH * 2"
        :disabled="isPending"
        @keydown="onTextareaKeydown"
        @keyup="onTextareaInputOrClick"
        @click="onTextareaInputOrClick"
        @blur="giphy.active = false"
        @mousedown.stop
      />
      <button
        type="button"
        class="mustard-notes-btn-primary mustard-comment-send"
        :disabled="!canSubmit"
        @click="submit"
        @mousedown.stop
      >
        Send
      </button>
    </div>
    <div v-else class="mustard-comment-login">
      <a href="#" @click.prevent="emit('request-login')" @mousedown.stop>Log in to comment</a>
    </div>

    <div
      v-if="isLoggedIn && draft.length > 0"
      class="mustard-comment-charcount"
      :class="{ 'over-limit': isOverLimit }"
    >
      {{ characterCountText }}
    </div>

    <Teleport to="body">
      <GiphyPicker
        v-if="giphy.active"
        ref="pickerRef"
        :query="giphy.query"
        :client-rect="giphyClientRect"
        :on-select="onGiphySelect"
      />
    </Teleport>
  </div>
</template>

<style scoped>
.mustard-comment-thread {
  border-top: 1px solid var(--mustard-border-subtle);
  margin-top: 8px;
  padding-top: 8px;
  user-select: text;
  cursor: auto;
}

.mustard-comment-list {
  max-height: 240px;
  overflow-y: auto;
  padding-right: 4px;
}

.mustard-comment-empty {
  margin: 0;
  padding: 8px 0;
  font-size: 0.8em;
  opacity: 0.6;
  text-align: center;
}

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

.mustard-comment-textarea {
  flex: 1;
  min-width: 0;
  font-size: 0.85em;
  padding: 6px 8px;
  resize: none;
}

.mustard-comment-send {
  padding: 4px 12px;
  font-size: 0.8em;
}

.mustard-comment-login {
  margin-top: 8px;
  text-align: center;
  font-size: 0.8em;
}

.mustard-comment-login a {
  color: var(--mustard-text);
  text-decoration: underline;
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
