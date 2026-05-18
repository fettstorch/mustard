<script setup lang="ts">
import { computed } from 'vue'

const props = defineProps<{
  /** Number of comments on the parent note */
  count: number
  /** Currently loading the comment list? */
  loading: boolean
  /** Number of unread notifications for this note (drives the red dot) */
  unread: number
  /** Is the user logged in? Drives "+ Add comment" affordance when count===0 */
  loggedIn: boolean
  /** Whether the thread is currently expanded */
  expanded: boolean
  /** Whether the parent note is currently being hovered (drives "+ Add comment" label) */
  noteHovered: boolean
}>()

defineEmits<{
  (e: 'click'): void
}>()

/**
 * Visibility rules:
 *   - logged in   → always visible (loading "…", count, or "+ Add comment")
 *   - logged out  → only visible if there's at least one comment to show
 *
 * During the initial load we don't yet know the count; for logged-out viewers
 * we keep the toggle hidden until the data lands to avoid a brief flicker on
 * notes that turn out to have zero comments.
 */
const visible = computed(() => {
  if (props.loggedIn) return true
  if (props.loading) return false
  return props.count > 0
})

/**
 * Static label that's always visible when present:
 *   - loading    → "…"
 *   - count > 0  → the count number
 *
 * In the count === 0 + loggedIn case we render the "+ Add comment" affordance
 * separately so its visibility can animate via CSS grid-template-columns
 * without any JS-driven layout changes.
 */
const staticLabel = computed<string | null>(() => {
  if (props.loading) return '…'
  if (props.count > 0) return String(props.count)
  return null
})

const showAddAffordance = computed(
  // Suppress when the thread is already open — the input is right there,
  // the affordance no longer adds information.
  () => !props.loading && props.count === 0 && props.loggedIn && !props.expanded,
)

const showDot = computed(() => props.unread > 0)
</script>

<template>
  <button
    v-if="visible"
    type="button"
    class="comment-toggle"
    :class="{ 'is-empty': !loading && count === 0, 'is-expanded': expanded }"
    :title="
      loading
        ? 'Loading comments…'
        : count > 0
          ? `${count} comment${count === 1 ? '' : 's'}`
          : 'Add the first comment'
    "
    @click="$emit('click')"
    @mousedown.stop
  >
    <span class="comment-toggle-icon" aria-hidden="true">
      <!-- Inline SVG so no extra asset / no CSP image-src concerns -->
      <svg
        width="14"
        height="14"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="2.5"
        stroke-linecap="round"
        stroke-linejoin="round"
      >
        <path
          d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"
        />
      </svg>
    </span>
    <span v-if="staticLabel !== null" class="comment-toggle-label">{{ staticLabel }}</span>
    <!--
      "+ Add comment" affordance: stays in the DOM whenever it's relevant
      (count===0 + loggedIn) so its width can animate smoothly via
      grid-template-columns. The note's `width: fit-content` reflows each
      frame, so the whole note grows / shrinks in lockstep — pure CSS.
    -->
    <span
      v-if="showAddAffordance"
      class="comment-toggle-affordance"
      :class="{ 'is-visible': noteHovered }"
    >
      <span class="comment-toggle-affordance-inner">+ Add comment</span>
    </span>
    <span v-if="showDot" class="comment-toggle-dot" :title="`${unread} unread`" />
  </button>
</template>

<style scoped>
.comment-toggle {
  position: relative;
  display: inline-flex;
  align-items: center;
  /* No `gap` — we use explicit margins so a zero-width affordance container
   * doesn't leave behind a 4px dead space when the label is collapsed. */
  padding: 2px 8px;
  margin: 0;
  border: 2px solid var(--mustard-border);
  border-radius: 999px;
  background: var(--mustard-glass);
  color: var(--mustard-text);
  font-family: var(--mustard-font);
  font-size: 0.75em;
  line-height: 1;
  cursor: pointer;
  transition: background 0.15s ease;
}

.comment-toggle:hover {
  background: var(--mustard-glass-hover);
}

.comment-toggle.is-expanded {
  background: var(--mustard-glass-strong);
}

.comment-toggle.is-empty {
  opacity: 0.85;
}

.comment-toggle-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
}

.comment-toggle-label {
  font-weight: 500;
  white-space: nowrap;
  margin-left: 4px;
}

/* "+ Add comment" affordance: stays in the DOM, animates 0fr ↔ 1fr via
 * grid-template-columns. Same trick the note body uses (rows) for its
 * minimize animation, except along the X axis here. */
.comment-toggle-affordance {
  display: inline-grid;
  grid-template-columns: 0fr;
  overflow: hidden;
  transition: grid-template-columns 0.2s ease;
}

.comment-toggle-affordance.is-visible {
  grid-template-columns: 1fr;
}

.comment-toggle-affordance-inner {
  min-width: 0;
  white-space: nowrap;
  font-weight: 500;
  /* Padding instead of parent flex-gap so collapsed (0fr) state truly has
   * no visual space between the bubble and the affordance. */
  padding-left: 4px;
}

.comment-toggle-dot {
  position: absolute;
  top: -3px;
  right: -3px;
  width: 9px;
  height: 9px;
  border-radius: 50%;
  background: #d32f2f;
  box-shadow: 0 0 0 2px var(--mustard-yellow);
}
</style>
