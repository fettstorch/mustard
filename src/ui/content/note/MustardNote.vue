<script setup lang="ts">
import { computed } from 'vue'
import type { MustardNote } from '@/shared/model/MustardNote'
import IconButton from '../IconButton.vue'
import MustardNoteHeader from '../MustardNoteHeader.vue'

const props = defineProps<{
  note: MustardNote
}>()

const emit = defineEmits<{
  (e: 'pressed-edit', note: MustardNote): void
  (e: 'pressed-delete', note: MustardNote): void
}>()

const isMyOwnNote = props.note.authorId === 'local'

const formattedDate = computed(() => {
  return props.note.updatedAt.toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  })
})
</script>

<template>
  <div
    class="mustard-note mustard-plastic mustard-rounded mustard-text-content mustard-padding"
    style="width: fit-content; padding-top: 8px; padding-bottom: 4px"
  >
    <!-- Header -->
    <MustardNoteHeader style="translate: 5px; margin-bottom: 8px">
      <template v-if="isMyOwnNote">
        <IconButton icon="edit" @click="emit('pressed-edit', note)" />
        <IconButton icon="trash" @click="emit('pressed-delete', note)" />
      </template>
    </MustardNoteHeader>
    <!-- Note Content (read-only) -->
    <div class="mustard-note-content" style="width: 260px">
      {{ note.content }}
    </div>
    <!-- Date footer -->
    <div class="mustard-note-date">
      {{ formattedDate }}
    </div>
  </div>
</template>

<style scoped>
.mustard-note-content {
  white-space: pre-wrap;
  word-break: break-word;
}

.mustard-note-date {
  text-align: right;
  font-size: 0.75em;
  opacity: 0.5;
  margin-top: 8px;
}
</style>
