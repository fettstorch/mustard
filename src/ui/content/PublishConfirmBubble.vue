<script setup lang="ts">
import { ref } from 'vue'

const props = withDefaults(
  defineProps<{
    variant?: 'default' | 'danger'
    title?: string
    message?: string
    confirmLabel?: string
    cancelLabel?: string
  }>(),
  {
    variant: 'default',
    title: undefined,
    message: undefined,
    confirmLabel: 'Publish',
    cancelLabel: 'Cancel',
  },
)

const emit = defineEmits<{
  (e: 'confirm', dontShowAgain: boolean): void
  (e: 'cancel'): void
}>()

const dontShowAgain = ref(false)
</script>

<template>
  <div
    class="publish-confirm-bubble mustard-notes-bg mustard-notes-border mustard-notes-txt"
    :class="{ 'is-danger': props.variant === 'danger' }"
    @mousedown.stop
  >
    <!-- Speech bubble tail -->
    <div class="bubble-tail" />

    <p v-if="props.title" class="bubble-title">{{ props.title }}</p>

    <p class="bubble-message">
      <slot>
        {{ props.message ?? 'Your note will be visible to' }}
        <strong v-if="!props.message">all your Bluesky followers</strong>
        <template v-if="!props.message">. Make sure not to share sensitive information.</template>
      </slot>
    </p>

    <label class="dont-show-again" @mousedown.stop>
      <input v-model="dontShowAgain" type="checkbox" />
      Don't show this again
    </label>

    <div class="bubble-actions">
      <button class="mustard-notes-btn" @click="emit('cancel')" @mousedown.stop>
        {{ props.cancelLabel }}
      </button>
      <button
        class="mustard-notes-btn-primary"
        @click="emit('confirm', dontShowAgain)"
        @mousedown.stop
      >
        {{ props.confirmLabel }}
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

/* -- danger variant (matches welcome page .warning style) ------------------ */
.publish-confirm-bubble.is-danger {
  --bubble-accent: #c0392b;
  background: #fff0f0;
  box-shadow: none;
  border-color: var(--bubble-accent);
}

.is-danger .bubble-tail {
  border-top-color: var(--bubble-accent);
}

.is-danger .bubble-title {
  color: var(--bubble-accent);
}

.is-danger .mustard-notes-btn-primary {
  background-color: var(--bubble-accent);
  border-color: var(--bubble-accent);
}

.is-danger .mustard-notes-btn-primary:hover {
  background-color: #a93226;
  border-color: #a93226;
}

/* -------------------------------------------------------------------------- */

.bubble-tail {
  position: absolute;
  bottom: -10px;
  right: 16px;
  width: 0;
  height: 0;
  border-left: 10px solid transparent;
  border-right: 10px solid transparent;
  border-top: 10px solid var(--mustard-border);
}

.bubble-title {
  margin: 0 0 6px;
  font-size: 0.85em;
  font-weight: 700;
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
