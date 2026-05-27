<script setup lang="ts">
import { computed, inject } from 'vue'
import type { MustardComment } from '@/shared/model/MustardComment'
import type { MustardState } from '../mustard-state'
import AuthorAvatar from './AuthorAvatar.vue'
import IconButton from '../IconButton.vue'
import { renderContent } from './render-content'

const props = defineProps<{
  comment: MustardComment
}>()

const emit = defineEmits<{
  (e: 'pressed-delete', comment: MustardComment): void
}>()

const mustardState = inject<MustardState>('mustardState')!

const profile = computed(() => mustardState.profiles[props.comment.authorId] ?? null)

const isMine = computed(() => {
  const me = mustardState.currentUserDid
  return me !== null && props.comment.authorId === me
})

const isPending = computed(() => !!mustardState.pendingCommentIds[props.comment.id])

const renderedContent = computed(() => renderContent(props.comment.content))

const handle = computed(() => profile.value?.handle ?? null)

const formattedTime = computed(() => {
  const now = Date.now()
  const ts = props.comment.createdAt.getTime()
  const diffMs = now - ts
  const sec = Math.floor(diffMs / 1000)
  if (sec < 60) return 'just now'
  const min = Math.floor(sec / 60)
  if (min < 60) return `${min}m`
  const hr = Math.floor(min / 60)
  if (hr < 24) return `${hr}h`
  const day = Math.floor(hr / 24)
  if (day < 7) return `${day}d`
  return props.comment.createdAt.toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  })
})

/** Don't let content clicks start a note drag (except for links — let them work) */
function onContentMousedown(e: MouseEvent) {
  if ((e.target as HTMLElement).closest('a')) {
    e.stopPropagation()
    return
  }
  e.stopPropagation()
}
</script>

<template>
  <div class="mustard-comment-item" :class="{ 'is-pending': isPending }">
    <AuthorAvatar :profile="profile" />
    <div class="mustard-comment-body">
      <div class="mustard-comment-meta">
        <span class="mustard-comment-handle">{{ handle ? '@' + handle : 'Loading…' }}</span>
        <span class="mustard-comment-time">{{ formattedTime }}</span>
        <IconButton
          v-if="isMine"
          icon="trash"
          title="Delete this comment"
          :disabled="isPending"
          class="mustard-comment-delete"
          @click="emit('pressed-delete', comment)"
          @mousedown.stop
        />
      </div>
      <!-- eslint-disable-next-line vue/no-v-html -->
      <div
        class="mustard-comment-content"
        v-html="renderedContent"
        @mousedown="onContentMousedown"
      />
    </div>
  </div>
</template>

<style scoped>
.mustard-comment-item {
  display: flex;
  gap: 8px;
  padding: 6px 0;
  align-items: flex-start;
}

.mustard-comment-item.is-pending {
  opacity: 0.5;
}

.mustard-comment-body {
  flex: 1;
  min-width: 0;
  /* Constrain so images / long URLs honour the column rather than spilling. */
  max-width: 100%;
  overflow: hidden;
}

.mustard-comment-meta {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 0.7em;
  margin-bottom: 2px;
}

.mustard-comment-handle {
  font-weight: 600;
  color: var(--mustard-text);
}

.mustard-comment-time {
  opacity: 0.6;
}

.mustard-comment-delete {
  margin-left: auto;
}

.mustard-comment-content {
  font-size: 0.85em;
  line-height: 1.35;
  word-break: break-word;
  /* Hard-cap content so images / wide URLs can't push the note out. */
  min-width: 0;
  max-width: 100%;
  overflow-wrap: break-word;
}

:deep(.mustard-comment-content p) {
  margin: 0 !important;
}

:deep(.mustard-comment-content p:empty) {
  display: none;
}

:deep(.mustard-comment-content .mustard-note-image) {
  pointer-events: none;
  user-select: none;
  /* Override the global .mustard-note-image `min-width: 100%` so GIFs render
   * at a comment-appropriate size instead of stretching to fill the column. */
  min-width: 0;
  max-width: 200px;
  max-height: 200px;
  width: auto;
  height: auto;
  object-fit: contain;
}

:deep(.mustard-comment-content .mustard-note-link) {
  word-break: break-all;
}
</style>
