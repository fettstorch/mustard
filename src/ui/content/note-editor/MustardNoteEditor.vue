<script setup lang="ts">
// MustardNoteEditor
</script>

<template>
  <div
    contenteditable="true"
    class="mustard-note-editor mustard-plastic mustard-rounded mustard-text-content mustard-padding"
    style="width: 300px; caret-color: #5c3a1e"
  ></div>
</template>

<style scoped>
.mustard-note-editor:empty::before {
  content: 'Write your note...';
  color: #5c3a1e50;
  pointer-events: none;
}

.mustard-note-editor:focus {
  outline: none;
}
</style>
