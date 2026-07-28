<script setup lang="ts">
/**
 * One tile in the options-page hidden-notes gallery.
 *
 * Renders the real `MustardNote` — same avatars, repost stack, link preview, code
 * highlighting and comment thread it has on a page — rather than a lookalike, so
 * the gallery can't drift from how notes actually look. `enabledFeatures` turns
 * off the affordances that only mean something on the note's own page (drag,
 * publish, repost). Un-hide is offered by the note itself, because every note here
 * is hidden; delete stays available on your own notes.
 *
 * All this wrapper adds is the page the note belongs to, which a note never shows
 * on its own page (you're already there) but the gallery has to.
 */
import MustardNote from '@/ui/content/note/MustardNote.vue'
import { displayUrl } from '@/shared/display-url'
import type { MustardNote as MustardNoteType } from '@/shared/model/MustardNote'

const props = defineProps<{
  note: MustardNoteType
}>()

const emit = defineEmits<{
  (e: 'pressed-unhide'): void
  (e: 'pressed-delete'): void
}>()

const NO_DRAG_OFFSET = { x: 0, y: 0 }
</script>

<template>
  <div class="hidden-note-card">
    <MustardNote
      :note="props.note"
      :drag-offset="NO_DRAG_OFFSET"
      :enabled-features="{ drag: false, publish: false, repost: false }"
      @pressed-unhide="emit('pressed-unhide')"
      @pressed-delete="emit('pressed-delete')"
    />
    <a
      class="hidden-note-page"
      :href="props.note.anchorData.pageUrl"
      target="_blank"
      rel="noopener noreferrer"
      :title="props.note.anchorData.pageUrl"
    >
      {{ displayUrl(props.note.anchorData.pageUrl) }}
    </a>
  </div>
</template>

<style scoped>
.hidden-note-card {
  /* inline-block so `break-inside: avoid` keeps the tile whole instead of
   * splitting it across two columns of the mosaic. */
  display: inline-block;
  width: 100%;
  break-inside: avoid;
  margin-bottom: 14px;
}

/* Every note in this gallery is hidden, so the page-side "why is this here?"
 * fade would just wash out the whole section — and the grab cursor advertises a
 * drag that `enabledFeatures` has switched off. */
.hidden-note-card :deep(.mustard-note.is-hidden) {
  opacity: 1;
}

.hidden-note-card :deep(.mustard-note) {
  cursor: default;
}

/* Shrink the note to fit the settings column while keeping its own proportions.
 *
 * `zoom` rather than `transform: scale()` on purpose: scale() leaves the original
 * layout box behind, so the mosaic would pack tiles at full size and leave large
 * gaps. zoom scales the layout too, so columns see the reduced height. It's
 * Baseline (May 2024), which this extension's Chrome/Firefox targets clear.
 *
 * Applied to the note only, not the whole card — the page URL underneath stays at
 * full size, since at 0.67 it would render around 7px. */
.hidden-note-card :deep(.mustard-note-wrapper) {
  zoom: var(--hidden-note-zoom, 1);
}

/* On a page the eye is hover-gated to keep the resting note clean. Here it's the
 * whole point of the section, so it shouldn't need discovering — pin the wrapper
 * open instead of hover-driven. */
.hidden-note-card :deep(.mustard-hide-toggle) {
  grid-template-columns: minmax(0, 1fr);
  opacity: 1;
}

.hidden-note-page {
  display: block;
  margin: 4px 2px 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 0.7rem;
  opacity: 0.6;
  color: inherit;
}

.hidden-note-page:hover {
  opacity: 0.9;
}
</style>
