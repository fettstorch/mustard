<script setup lang="ts">
import { computed, inject, ref, onUnmounted, watch, nextTick } from 'vue'
import type { Observable } from '@fettstorch/jule'
import type { MustardNote } from '@/shared/model/MustardNote'
import type { MustardState } from '../mustard-state'
import IconButton from '../IconButton.vue'
import MustardNoteHeader from '../MustardNoteHeader.vue'
import AuthorAvatar from './AuthorAvatar.vue'
import RepostAvatarStack from './RepostAvatarStack.vue'
import CommentToggle from './CommentToggle.vue'
import MustardCommentThread from './MustardCommentThread.vue'
import { renderContent } from './render-content'
import { LIMITS } from '@/shared/constants'
import {
  createMarkNotificationsSeenForNoteMessage,
  sendMessage,
  type Message,
} from '@/shared/messaging'

const props = defineProps<{
  note: MustardNote
  dragOffset: { x: number; y: number }
}>()

const emit = defineEmits<{
  (e: 'pressed-publish', note: MustardNote): void
  (e: 'pressed-delete', note: MustardNote): void
  (e: 'pressed-repost', note: MustardNote, reposted: boolean): void
  (e: 'drag', offset: { x: number; y: number }): void
}>()

// Drag state
const isDragging = ref(false)
const dragStart = ref({ x: 0, y: 0 })
const offsetAtDragStart = ref({ x: 0, y: 0 })

/** Only stop propagation for links — let other content clicks start a drag */
function onContentMousedown(e: MouseEvent) {
  if ((e.target as HTMLElement).closest('a')) {
    e.stopPropagation()
  }
}

function onDragStart(e: MouseEvent) {
  if (isMinimized.value && !isHovered.value) return
  e.preventDefault()
  isDragging.value = true
  dragStart.value = { x: e.clientX, y: e.clientY }
  offsetAtDragStart.value = { x: props.dragOffset.x, y: props.dragOffset.y }
  document.addEventListener('mousemove', onDragMove)
  document.addEventListener('mouseup', onDragEnd)
}

function onDragMove(e: MouseEvent) {
  if (!isDragging.value) return
  const deltaX = e.clientX - dragStart.value.x
  const deltaY = e.clientY - dragStart.value.y
  emit('drag', {
    x: offsetAtDragStart.value.x + deltaX,
    y: offsetAtDragStart.value.y + deltaY,
  })
}

function onDragEnd() {
  if (!isDragging.value) return
  isDragging.value = false
  document.removeEventListener('mousemove', onDragMove)
  document.removeEventListener('mouseup', onDragEnd)
}

onUnmounted(() => {
  document.removeEventListener('mousemove', onDragMove)
  document.removeEventListener('mouseup', onDragEnd)
})

const mustardState = inject<MustardState>('mustardState')!

const isMyOwnNote = computed(() => {
  const authorId = props.note.authorId
  const currentUserDid = mustardState.currentUserDid
  // Note is mine if: it's a local note OR it was created by my logged-in account
  return authorId === 'local' || (currentUserDid !== null && authorId === currentUserDid)
})

const isLocalNote = computed(() => {
  return props.note.authorId === 'local'
})

const isRemoteNote = computed(() => {
  return props.note.authorId !== 'local'
})

const isPending = computed(() => {
  return props.note.id ? !!mustardState.pendingNoteIds[props.note.id] : false
})

const formattedDate = computed(() => {
  return props.note.updatedAt.toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  })
})

const authorProfile = computed(() => {
  if (!isRemoteNote.value) return null
  return mustardState.profiles[props.note.authorId] ?? null
})

const reposterProfiles = computed(() =>
  props.note.reposterIds.map((id) => mustardState.profiles[id] ?? null),
)

const hasReposters = computed(() => props.note.reposterIds.length > 0)

/** True when the current user has reposted this note. */
const isRepostedByMe = computed(() => {
  const did = mustardState.currentUserDid
  return did !== null && props.note.reposterIds.includes(did)
})

/** Show the repost toggle on remote notes that aren't mine, when logged in. */
const showRepostButton = computed(
  () => isRemoteNote.value && !isMyOwnNote.value && isLoggedIn.value,
)

// Accumulating rotation: each press adds a full turn, which the CSS ease-out
// transition animates as a single 360° spin (and keeps spinning forward on
// repeated presses — no jump-back).
const repostRotation = ref(0)

function onRepostClick() {
  repostRotation.value += 360
  emit('pressed-repost', props.note, !isRepostedByMe.value)
}

const renderedContent = computed(() => {
  return renderContent(props.note.content)
})

const isOverLimit = computed(() => {
  return props.note.content.length > LIMITS.CONTENT_MAX_LENGTH
})

const isPublishDisabled = computed(() => {
  return isPending.value || isOverLimit.value
})

const characterCountText = computed(() => {
  return `${props.note.content.length}/${LIMITS.CONTENT_MAX_LENGTH}`
})

const shouldShowCharacterCount = computed(() => {
  return isLocalNote.value && isOverLimit.value
})

const isHovered = ref(false)

const isMinimized = computed(() => mustardState.areNotesMinimized)

// --- Comments / notifications ---

const event = inject<Observable<Message>>('event')!
const commentThreadRef = ref<InstanceType<typeof MustardCommentThread> | null>(null)

const noteId = computed(() => props.note.id)

const commentsForNote = computed(() =>
  noteId.value ? (mustardState.comments[noteId.value] ?? []) : [],
)

const commentCount = computed(() => commentsForNote.value.length)

const commentsLoading = computed(() => {
  if (!noteId.value) return false
  return mustardState.commentsLoadState[noteId.value] !== 'loaded'
})

const unreadCount = computed(() => {
  if (!noteId.value) return 0
  return mustardState.unreadByNoteId[noteId.value] ?? 0
})

const isExpanded = computed(() => {
  if (!noteId.value) return false
  return !!mustardState.expandedCommentNoteIds[noteId.value]
})

const isLoggedIn = computed(() => mustardState.currentUserDid !== null)

/** Show the toggle only on remote notes (local notes can't have remote comments). */
const showCommentToggle = computed(() => isRemoteNote.value && !!noteId.value)

function onToggleComments() {
  const id = noteId.value
  if (!id) return
  const newExpanded = !mustardState.expandedCommentNoteIds[id]
  mustardState.expandedCommentNoteIds[id] = newExpanded

  if (newExpanded) {
    // Mark notifications seen when the user actually sees the thread.
    if (mustardState.unreadByNoteId[id]) {
      event.emit(createMarkNotificationsSeenForNoteMessage(id))
    }

    // Always focus the textarea on open so logged-in users can type immediately.
    nextTick(() => {
      if (isLoggedIn.value) {
        commentThreadRef.value?.focusInput()
      }
    })
  }
}

function requestLogin() {
  // Open the extension popup so the user can log in.
  sendMessage({ type: 'OPEN_POPUP' }).catch(() => {})
}

// If the thread is expanded and an unread count comes in after the fact,
// auto-mark-seen (e.g. NOTIFICATIONS_CHANGED arrived while expanded).
watch(unreadCount, (count) => {
  if (count > 0 && isExpanded.value && noteId.value) {
    event.emit(createMarkNotificationsSeenForNoteMessage(noteId.value))
  }
})
</script>

<template>
  <!--
    Outer wrapper exists so the &lt;slot/&gt; (e.g. PublishConfirmBubble) can sit
    OUTSIDE the inner .mustard-note's `overflow: hidden` (which is required for
    the minimize-collapse animation). The wrapper inherits position: fixed from
    the parent's `.mustard-positioned` class, so it becomes the positioning
    context for any absolutely-positioned slot content — same effective
    placement as before, just not clipped.
  -->
  <div class="mustard-note-wrapper">
    <div
      class="mustard-note mustard-notes-bg mustard-notes-border mustard-notes-txt mustard-notes-padding"
      :class="{ 'is-dragging': isDragging, 'is-minimized': isMinimized }"
      style="width: fit-content; padding-top: 8px; padding-bottom: 4px"
      @mousedown="onDragStart"
      @mouseenter="isHovered = true"
      @mouseleave="isHovered = false"
    >
      <!-- Header -->
      <div class="mustard-note-header">
        <RepostAvatarStack
          v-if="isRemoteNote && hasReposters"
          :author="authorProfile"
          :reposters="reposterProfiles"
        />
        <AuthorAvatar v-else-if="isRemoteNote" :profile="authorProfile" />
        <MustardNoteHeader class="mustard-note-actions" style="translate: 5px; flex: 1">
          <template v-if="isMyOwnNote">
            <IconButton
              v-if="isLocalNote"
              icon="publish"
              title="Publish this note (do not publish sensitive data)"
              :disabled="isPublishDisabled"
              @click="emit('pressed-publish', note)"
              @mousedown.stop
            />
            <IconButton
              icon="trash"
              title="Delete this note"
              :disabled="isPending"
              @click="emit('pressed-delete', note)"
              @mousedown.stop
            />
          </template>
          <span
            v-if="showRepostButton"
            class="mustard-repost-toggle"
            :style="{ '--repost-rotation': `${repostRotation}deg` }"
          >
            <IconButton
              icon="repost"
              :class="{ 'is-reposted': isRepostedByMe }"
              :title="
                isRepostedByMe ? 'Remove your repost' : 'Repost so your followers can see this'
              "
              @click="onRepostClick"
              @mousedown.stop
            />
          </span>
        </MustardNoteHeader>
      </div>
      <!-- Collapsible body (content + footer + date) -->
      <div class="mustard-note-body">
        <div class="mustard-note-body-inner">
          <!-- eslint-disable-next-line vue/no-v-html -->
          <div
            class="mustard-note-content"
            v-html="renderedContent"
            @mousedown="onContentMousedown"
          />
          <div v-if="shouldShowCharacterCount" class="character-count over-limit">
            {{ characterCountText }}
          </div>
          <div class="mustard-note-footer">
            <CommentToggle
              v-if="showCommentToggle"
              class="mustard-note-comment-toggle"
              :count="commentCount"
              :loading="commentsLoading"
              :unread="unreadCount"
              :logged-in="isLoggedIn"
              :expanded="isExpanded"
              :note-hovered="isHovered"
              @click="onToggleComments"
            />
            <div class="mustard-note-date">
              {{ formattedDate }}
              <IconButton
                v-if="isRemoteNote && isMyOwnNote"
                icon="published"
                :static="true"
                title="This note is published"
              />
            </div>
          </div>
          <div
            v-if="showCommentToggle"
            class="mustard-note-thread-wrapper"
            :class="{ 'is-open': isExpanded }"
          >
            <div class="mustard-note-thread-inner">
              <MustardCommentThread
                v-if="isExpanded"
                ref="commentThreadRef"
                :note="note"
                @request-login="requestLogin"
              />
            </div>
          </div>
        </div>
      </div>
    </div>
    <!-- Slot rendered outside .mustard-note so absolutely-positioned content
         (e.g. PublishConfirmBubble) isn't clipped by the note's overflow:hidden -->
    <slot />
  </div>
</template>

<style scoped>
/* Wrapper sizes to the inner .mustard-note (which is `width: fit-content`),
 * so any absolutely-positioned slot content uses the note's actual bounds
 * as its containing block. The wrapper itself gets `position: fixed` from
 * the parent's `.mustard-positioned` class (attribute inheritance), making
 * it the positioning context for the slot. */
.mustard-note-wrapper {
  width: fit-content;
}

.mustard-note {
  cursor: grab;
  user-select: none;
  overflow: hidden;
  /* Explicit baseline so the minimize transition can interpolate max-width.
   * Without this the unminimized state computes to `max-width: none`, which
   * is not a length and therefore not smoothly interpolatable with `38px` —
   * the browser falls back to discrete animation (instant jump). Matches the
   * inner content's max-width + outer horizontal padding (1em total from
   * .mustard-notes-padding). */
  max-width: calc(var(--mustard-note-content-max-width) + 1em);
}

.mustard-note.is-dragging {
  cursor: grabbing;
}

/* --- Minimized state ---
 * The note itself becomes the minimized indicator: clipped to a small pill
 * via max-width + overflow:hidden. On hover it expands back to full size.
 *
 * Expand (hover enter): width first (no delay), then height (delayed).
 * Collapse (hover leave): height first (no delay), then width (delayed).
 */

.mustard-note.is-minimized {
  max-width: 38px;
  padding: 4px !important;
  cursor: pointer;
  /* Collapse: height shrinks first, width shrinks after */
  transition:
    max-width 0.2s ease 0.12s,
    padding 0.2s ease;
}

.mustard-note.is-minimized:hover {
  max-width: 300px;
  padding: 8px 0.5em 4px !important;
  cursor: grab;
  /* Expand: width grows first, height grows after */
  transition:
    max-width 0.2s ease,
    padding 0.2s ease;
}

/* Header margin collapses when minimized */

.mustard-note-header {
  display: flex;
  flex-direction: row;
  align-items: center;
  gap: 8px;
  margin-bottom: 8px;
  transition: margin-bottom 0.2s ease;
}

.mustard-note.is-minimized .mustard-note-header {
  margin-bottom: 0;
}

.mustard-note.is-minimized:hover .mustard-note-header {
  margin-bottom: 8px;
}

/* Repost toggle: hidden by default, fades in only while the note is hovered so
 * resting notes stay clean. The rotation (set per-press via the --repost-rotation
 * custom property) animates as a 360° ease-out spin on the icon image only — the
 * wrapper carries the press-indicator background, so rotating it would spin that
 * darkened hover/active frame too. */
.mustard-repost-toggle {
  display: inline-flex;
  opacity: 0;
  pointer-events: none;
  transition: opacity 0.15s ease;
}

.mustard-repost-toggle :deep(img) {
  transform: rotate(var(--repost-rotation, 0deg));
  transition: transform 0.5s ease-out;
}

.mustard-note:hover .mustard-repost-toggle {
  opacity: 1;
  pointer-events: auto;
}

/* Subtle highlight ring once the user has reposted (visible on hover). */
.mustard-repost-toggle :deep(.is-reposted) {
  border-radius: 6px;
  background: var(--mustard-glass-strong);
}

/* Header actions: hidden when minimized, fade in on hover */

.mustard-note.is-minimized .mustard-note-actions {
  opacity: 0;
  pointer-events: none;
}

.mustard-note.is-minimized:hover .mustard-note-actions {
  opacity: 1;
  pointer-events: auto;
  transition: opacity 0.15s ease 0.15s;
}

/* Body: CSS grid for smooth height animation */

.mustard-note-body {
  display: grid;
  grid-template-rows: 1fr;
  opacity: 1;
}

.mustard-note-body-inner {
  overflow: hidden;
}

.mustard-note.is-minimized .mustard-note-body {
  grid-template-rows: 0fr;
  opacity: 0;
  /* Collapse: height shrinks immediately (before width) */
  transition:
    grid-template-rows 0.2s ease,
    opacity 0.15s ease;
}

.mustard-note.is-minimized:hover .mustard-note-body {
  grid-template-rows: 1fr;
  opacity: 1;
  /* Expand: height grows after width (delayed) */
  transition:
    grid-template-rows 0.2s ease 0.1s,
    opacity 0.2s ease 0.1s;
}

/* --- Content styles --- */

.mustard-note-content {
  min-width: var(--mustard-note-content-width);
  max-width: var(--mustard-note-content-max-width);
  word-break: break-word;
}

:deep(.mustard-note-content p) {
  margin: 0 !important;
}

:deep(.mustard-note-content p:empty) {
  display: none;
}

:deep(.mustard-note-content h1),
:deep(.mustard-note-content h2),
:deep(.mustard-note-content h3),
:deep(.mustard-note-content h4),
:deep(.mustard-note-content h5),
:deep(.mustard-note-content h6) {
  color: var(--mustard-text) !important;
  margin: 0.25em 0;
}

:deep(.mustard-note-image) {
  pointer-events: none;
  user-select: none;
}

:deep(.mustard-note-link) {
  word-break: break-all;
}

.character-count {
  text-align: right;
  font-size: 0.75em;
  margin-top: 8px;
}

.character-count.over-limit {
  opacity: 1;
  color: #d32f2f;
  font-weight: bold;
}

.mustard-note-footer {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 8px;
  margin-top: 8px;
}

.mustard-note-comment-toggle {
  flex-shrink: 0;
}

.mustard-note-date {
  display: flex;
  justify-content: flex-end;
  align-items: center;
  gap: 2px;
  font-size: 0.75em;
  opacity: 0.5;
  margin-left: auto;
}

.mustard-note-date :deep(.icon-static) {
  padding: 0;
}

/* Comment thread: grid-row animation for smooth expand/collapse.
 *
 * `grid-template-columns: minmax(0, 1fr)` makes the single implicit column
 * stretch to fill the wrapper's width (i.e. the note body's width) rather
 * than shrinking to fit its content's preferred width. Without this, the
 * comment input row (textarea + send button) would only get its intrinsic
 * preferred width — meaning a `flex: 1` textarea has nothing "left over"
 * to grow into when the note widens.
 *
 * We don't cap the wrapper's width here because the surrounding note
 * content (`.mustard-note-content` with `max-width: var(...)`) already
 * bounds the body-inner, which is what we'd inherit anyway. The inner's
 * `overflow: hidden` keeps any wide comment image / URL clipped to that
 * bound so the thread can never blow out the note's width. */
.mustard-note-thread-wrapper {
  display: grid;
  grid-template-rows: 0fr;
  grid-template-columns: minmax(0, 1fr);
  min-width: var(--mustard-note-content-width);
  transition:
    grid-template-rows 0.2s ease,
    opacity 0.15s ease;
  opacity: 0;
}

.mustard-note-thread-wrapper.is-open {
  grid-template-rows: 1fr;
  opacity: 1;
}

.mustard-note-thread-inner {
  overflow: hidden;
}
</style>
