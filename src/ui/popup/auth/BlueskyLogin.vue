<script setup lang="ts">
/**
 * BlueskyLogin Component
 *
 * Handles the Bluesky/AT Protocol login flow.
 * Emits 'success' with the OAuthSession when login completes.
 */
import { ref } from 'vue'
import { login } from '@/background/auth/AtprotoAuth'
import type { OAuthSession } from '@atproto/oauth-client-browser'

const emit = defineEmits<{
  success: [session: OAuthSession]
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
    const session = await login(handle)
    emit('success', session)
  } catch (e) {
    errorMessage.value = e instanceof Error ? e.message : 'Login failed'
  } finally {
    isLoggingIn.value = false
  }
}
</script>

<template>
  <div class="flex flex-col gap-3">
    <p class="text-sm font-medium text-gray-700">Login with Bluesky</p>
    <input
      v-model="blueskyHandle"
      type="text"
      placeholder="your.handle.bsky.social"
      class="px-3 py-2.5 border border-gray-300 rounded-md text-sm outline-none focus:border-amber-600 disabled:bg-gray-100 transition-colors"
      @keyup.enter="submit"
      :disabled="isLoggingIn"
    />
    <button
      @click="submit"
      class="px-4 py-2.5 bg-amber-600 text-white rounded-md text-sm font-medium hover:bg-amber-700 disabled:bg-gray-300 disabled:cursor-not-allowed transition-colors"
      :disabled="isLoggingIn || !blueskyHandle.trim()"
    >
      {{ isLoggingIn ? 'Logging in...' : 'Login' }}
    </button>
    <p v-if="errorMessage" class="text-sm text-red-600">{{ errorMessage }}</p>
  </div>
</template>
