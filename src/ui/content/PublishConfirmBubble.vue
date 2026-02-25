<script setup lang="ts">
import { ref } from 'vue'

const emit = defineEmits<{
  (e: 'confirm', dontShowAgain: boolean): void
  (e: 'cancel'): void
}>()

const dontShowAgain = ref(false)
</script>

<template>
  <div class="publish-confirm-bubble mustard-notes-bg mustard-notes-border mustard-notes-txt">
    <!-- Speech bubble tail -->
    <div class="bubble-tail" />

    <p class="bubble-message">
      This will publish your note to <strong>all your followers</strong>. Make sure not to share
      sensitive information.
    </p>

    <label class="dont-show-again" @mousedown.stop>
      <input v-model="dontShowAgain" type="checkbox" />
      Don't show this again
    </label>

    <div class="bubble-actions">
      <button class="mustard-notes-btn" @click="emit('cancel')" @mousedown.stop>Cancel</button>
      <button class="mustard-notes-btn-primary" @click="emit('confirm', dontShowAgain)" @mousedown.stop>
        Publish
      </button>
    </div>
  </div>
</template>

<style scoped>
.publish-confirm-bubble {
  position: absolute;
  bottom: calc(100% + 12px);
  right: 0;
  width: 240px;
  padding: 12px;
  z-index: 10;
  cursor: default;
}

.bubble-tail {
  position: absolute;
  bottom: -10px;
  right: 16px;
  width: 0;
  height: 0;
  border-left: 10px solid transparent;
  border-right: 10px solid transparent;
  border-top: 10px solid var(--mustard-orange);
}

.bubble-tail::before {
  content: '';
  position: absolute;
  bottom: 2px;
  left: -10px;
  width: 0;
  height: 0;
  border-left: 10px solid transparent;
  border-right: 10px solid transparent;
  border-top: 10px solid var(--mustard-border);
  z-index: -1;
}

.bubble-message {
  margin: 0 0 10px;
  font-size: 0.8em;
  line-height: 1.4;
}

.dont-show-again {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 0.75em;
  margin-bottom: 10px;
  cursor: pointer;
  user-select: none;
}

.dont-show-again input {
  accent-color: var(--mustard-border);
  cursor: pointer;
}

.bubble-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}

.bubble-actions button {
  font-size: 0.8em;
  padding: 6px 12px;
}
</style>
