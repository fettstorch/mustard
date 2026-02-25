<script setup lang="ts">
/**
 * BlueskyLogin Component
 *
 * Handles the Bluesky/AT Protocol login flow.
 * Uses messaging to service worker because popup can close during OAuth flow.
 */
import { ref } from 'vue'
import { createAtprotoLoginMessage, type AtprotoSessionResponse } from '@/shared/messaging'

const emit = defineEmits<{
  success: [session: NonNullable<AtprotoSessionResponse>]
}>()

/** User's Bluesky handle, e.g. "julian.bsky.social" */
const blueskyHandle = ref('')
const isLoggingIn = ref(false)
const errorMessage = ref<string | null>(null)

async function submit() {
  const handle = blueskyHandle.value.trim()
  if (!handle) return

  isLoggingIn.value = true
  errorMessage.value = null

  try {
    // Send to service worker - it handles OAuth and persists across popup close
    const session = (await chrome.runtime.sendMessage(
      createAtprotoLoginMessage(handle),
    )) as AtprotoSessionResponse
    if (session) {
      emit('success', session)
    } else {
      errorMessage.value = 'Login failed or was cancelled'
    }
  } catch (e) {
    errorMessage.value = e instanceof Error ? e.message : 'Login failed'
  } finally {
    isLoggingIn.value = false
  }
}
</script>

<template>
  <div class="flex flex-col gap-3">
    <p class="login-label">Login with Bluesky</p>
    <input
      v-model="blueskyHandle"
      type="text"
      placeholder="your.handle.bsky.social"
      class="mustard-notes-input"
      @keyup.enter="submit"
      :disabled="isLoggingIn"
    />
    <button
      @click="submit"
      class="mustard-notes-btn-primary"
      :disabled="isLoggingIn || !blueskyHandle.trim()"
    >
      {{ isLoggingIn ? 'Logging in...' : 'Login' }}
    </button>
    <p v-if="errorMessage" class="text-sm text-red-700 font-medium">{{ errorMessage }}</p>
  </div>
</template>

<style scoped>
.login-label {
  font-size: 0.875rem;
  font-weight: 500;
  color: var(--mustard-text);
}
</style>
