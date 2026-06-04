<script setup lang="ts">
import { computed, inject, nextTick, onMounted, ref, watch } from 'vue'
import type { Observable } from '@fettstorch/jule'
import type { MustardComment } from '@/shared/model/MustardComment'
import type { MustardNote } from '@/shared/model/MustardNote'
import type { MustardState } from '../mustard-state'
import {
  createUpsertCommentMessage,
  createDeleteCommentMessage,
  type Message,
} from '@/shared/messaging'
import MustardCommentItem from './MustardCommentItem.vue'
import MustardCommentEditor from './MustardCommentEditor.vue'

const props = defineProps<{
  note: MustardNote
}>()

const emit = defineEmits<{
  (e: 'request-login'): void
}>()

const mustardState = inject<MustardState>('mustardState')!
const event = inject<Observable<Message>>('event')!

const scrollEl = ref<HTMLElement | null>(null)
const editorRef = ref<InstanceType<typeof MustardCommentEditor> | null>(null)

const comments = computed<MustardComment[]>(() => {
  return props.note.id ? (mustardState.comments[props.note.id] ?? []) : []
})

const isLoggedIn = computed(() => mustardState.currentUserDid !== null)

const myProfile = computed(() => {
  const me = mustardState.currentUserDid
  return me ? (mustardState.profiles[me] ?? null) : null
})

const isPending = computed(() => {
  if (!props.note.id) return false
  return !!mustardState.pendingCommentForNoteIds[props.note.id]
})

function onSubmit(data: { content: string }) {
  if (!props.note.id) return
  event.emit(createUpsertCommentMessage(props.note.id, data.content))
}

function onDelete(comment: MustardComment) {
  if (!props.note.id) return
  event.emit(createDeleteCommentMessage(comment.id, props.note.id))
}

function scrollListToBottom() {
  const el = scrollEl.value
  if (!el) return
  // Smooth scroll where supported; falls back to instant if not.
  try {
    el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' })
  } catch {
    el.scrollTop = el.scrollHeight
  }
}

async function scrollToBottom() {
  await nextTick()
  // Wait one more frame so the parent's grid-template-rows transition can
  // realise the wrapper's height; without this scrollHeight may be 0 on
  // first mount while the row is still mid-animation.
  await new Promise((resolve) => requestAnimationFrame(() => resolve(undefined)))
  scrollListToBottom()
  // GIFs/images in comments finish loading after the first scroll and grow the
  // list, leaving the last comment's bottom below the fold — re-pin once they've
  // had time to lay out.
  setTimeout(scrollListToBottom, 500)
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
    editorRef.value?.focusInput()
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

    <MustardCommentEditor
      v-if="isLoggedIn"
      ref="editorRef"
      :profile="myProfile"
      :pending="isPending"
      @submit="onSubmit"
    />
    <div v-else class="mustard-comment-login">
      <a href="#" @click.prevent="emit('request-login')" @mousedown.stop>Log in to comment</a>
    </div>
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

.mustard-comment-login {
  margin-top: 8px;
  text-align: center;
  font-size: 0.8em;
}

.mustard-comment-login a {
  color: var(--mustard-text);
  text-decoration: underline;
}
</style>
