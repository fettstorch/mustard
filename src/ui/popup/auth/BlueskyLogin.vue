<script setup lang="ts">
/**
 * BlueskyLogin Component
 *
 * Handles the Bluesky/AT Protocol login flow.
 * Uses messaging to service worker because popup can close during OAuth flow.
 */
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import {
  createAtprotoLoginMessage,
  createSearchBskyActorsMessage,
  sendMessage,
  type AtprotoSessionResponse,
} from '@/shared/messaging'
import type { BskyProfile } from '@/shared/model/BskyProfile'
import type { MentionCandidate } from '@/shared/model/MentionCandidate'
import MentionPicker from '@/ui/content/note-editor/MentionPicker.vue'

const emit = defineEmits<{
  success: [session: NonNullable<AtprotoSessionResponse>]
}>()

/** User's Bluesky handle, e.g. "julian.bsky.social" */
const blueskyHandle = ref('')
const isLoggingIn = ref(false)
const errorMessage = ref<string | null>(null)
const suggestions = ref<BskyProfile[]>([])
const inputRef = ref<HTMLInputElement | null>(null)
const pickerRef = ref<InstanceType<typeof MentionPicker> | null>(null)
const isInputFocused = ref(false)
const showSuggestions = ref(false)
let searchTimer: ReturnType<typeof setTimeout> | undefined
let searchSequence = 0

const pickerItems = computed<MentionCandidate[]>(() =>
  suggestions.value.map((profile) => ({
    provider: 'atproto',
    accountId: profile.id,
    handle: profile.handle,
    displayName: profile.displayName,
    avatarUrl: profile.avatarUrl,
  })),
)

const inputRect = () => inputRef.value?.getBoundingClientRect() ?? null

watch(blueskyHandle, (value) => {
  clearTimeout(searchTimer)
  const sequence = ++searchSequence
  const query = value.trim().replace(/^@/, '')
  if (query.length < 2) {
    suggestions.value = []
    return
  }

  searchTimer = setTimeout(async () => {
    const result = await sendMessage(createSearchBskyActorsMessage(query)).catch((error) => {
      console.error('Failed to search Bluesky actors:', error)
      return []
    })
    if (sequence === searchSequence) suggestions.value = result
  }, 200)
})

onBeforeUnmount(() => clearTimeout(searchTimer))

function selectProfile(profile: MentionCandidate) {
  blueskyHandle.value = profile.handle
  suggestions.value = []
  showSuggestions.value = false
  inputRef.value?.focus()
}

function onInputKeyDown(event: KeyboardEvent) {
  if (event.key === 'Escape') {
    showSuggestions.value = false
    return
  }
  if (!showSuggestions.value) return
  if (pickerRef.value?.onKeyDown?.(event)) event.preventDefault()
}

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
      ref="inputRef"
      id="bluesky-login-handle"
      v-model="blueskyHandle"
      type="text"
      name="username"
      autocomplete="username"
      autocapitalize="none"
      spellcheck="false"
      placeholder="your.handle.bsky.social"
      class="mustard-notes-input"
      :disabled="isLoggingIn"
      @focus="
        isInputFocused = true
        showSuggestions = true
      "
      @input="showSuggestions = true"
      @blur="isInputFocused = false"
      @keydown="onInputKeyDown"
    />
    <MentionPicker
      v-if="isInputFocused && showSuggestions && pickerItems.length"
      ref="pickerRef"
      :items="pickerItems"
      :query="blueskyHandle"
      :client-rect="inputRect"
      :on-select="selectProfile"
      footer="Bluesky profiles"
    />
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
