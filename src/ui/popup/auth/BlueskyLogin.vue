<script setup lang="ts">
/**
 * BlueskyLogin Component
 *
 * Handles the Bluesky/AT Protocol login flow.
 * Uses messaging to service worker because popup can close during OAuth flow.
 */
import { onBeforeUnmount, ref, watch } from 'vue'
import {
  createAtprotoLoginMessage,
  createSearchBskyActorsMessage,
  sendMessage,
  type AtprotoSessionResponse,
} from '@/shared/messaging'
import type { BskyProfile } from '@/shared/model/BskyProfile'

const emit = defineEmits<{
  success: [session: NonNullable<AtprotoSessionResponse>]
}>()

/** User's Bluesky handle, e.g. "julian.bsky.social" */
const blueskyHandle = ref('')
const isLoggingIn = ref(false)
const errorMessage = ref<string | null>(null)
const suggestions = ref<BskyProfile[]>([])
let searchTimer: ReturnType<typeof setTimeout> | undefined
let searchSequence = 0

watch(blueskyHandle, (value) => {
  clearTimeout(searchTimer)
  const query = value.trim().replace(/^@/, '')
  if (query.length < 2) {
    suggestions.value = []
    return
  }

  const sequence = ++searchSequence
  searchTimer = setTimeout(async () => {
    const result = await sendMessage(createSearchBskyActorsMessage(query)).catch(() => [])
    if (sequence === searchSequence) suggestions.value = result
  }, 200)
})

onBeforeUnmount(() => clearTimeout(searchTimer))

async function submit() {
  const handle = blueskyHandle.value.trim()
  if (!handle) return

  isLoggingIn.value = true
  errorMessage.value = null

  try {
    // Send to service worker - it handles OAuth and persists across popup close
    const session = await sendMessage(createAtprotoLoginMessage(handle))
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
  <form class="login-form" @submit.prevent="submit">
    <label class="login-label" for="bluesky-login-handle">Login with Bluesky</label>
    <input
      id="bluesky-login-handle"
      v-model="blueskyHandle"
      type="text"
      name="username"
      autocomplete="username"
      autocapitalize="none"
      spellcheck="false"
      list="bluesky-login-suggestions"
      placeholder="your.handle.bsky.social"
      class="mustard-notes-input"
      :disabled="isLoggingIn"
    />
    <datalist id="bluesky-login-suggestions">
      <option
        v-for="profile in suggestions"
        :key="profile.id"
        :value="profile.handle"
        :label="profile.displayName"
      />
    </datalist>
    <button
      type="submit"
      class="mustard-notes-btn-primary"
      :disabled="isLoggingIn || !blueskyHandle.trim()"
    >
      {{ isLoggingIn ? 'Logging in...' : 'Login' }}
    </button>
    <p v-if="errorMessage" class="login-error">{{ errorMessage }}</p>
  </form>
</template>

<style scoped>
.login-form {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}

.login-label {
  font-size: 0.875rem;
  font-weight: 500;
  color: var(--mustard-text);
}

.login-error {
  font-size: 0.875rem;
  color: #b91c1c;
  font-weight: 500;
}
</style>
