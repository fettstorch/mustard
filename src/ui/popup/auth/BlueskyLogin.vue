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
const selectedProfile = ref<BskyProfile>()
const inputRef = ref<HTMLInputElement | null>(null)
const pickerRef = ref<InstanceType<typeof MentionPicker> | null>(null)
const isInputFocused = ref(false)
const showSuggestions = ref(false)
const activeSuggestionId = ref<string>()
let searchTimer: ReturnType<typeof setTimeout> | undefined
let searchSequence = 0

const isPickerOpen = computed(
  () => isInputFocused.value && showSuggestions.value && pickerItems.value.length > 0,
)

const pickerItems = computed<MentionCandidate[]>(() =>
  suggestions.value.map((profile) => ({
    provider: 'atproto',
    accountId: profile.id,
    handle: profile.handle,
    displayName: profile.displayName,
    avatarUrl: profile.avatarUrl,
  })),
)

const exactProfile = computed(() => {
  const handle = blueskyHandle.value.trim().replace(/^@/, '').toLowerCase()
  if (!handle) return undefined

  const matches = [...suggestions.value, ...(selectedProfile.value ? [selectedProfile.value] : [])]
    .filter((profile) => profile.handle.toLowerCase() === handle)
    .filter(
      (profile, index, profiles) => profiles.findIndex(({ id }) => id === profile.id) === index,
    )

  return matches.length === 1 ? matches[0] : undefined
})

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
  selectedProfile.value = suggestions.value.find(({ id }) => id === profile.accountId) ?? {
    type: 'atproto',
    id: profile.accountId,
    displayName: profile.displayName,
    avatarUrl: profile.avatarUrl,
    handle: profile.handle,
  }
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

function onInputFocus() {
  isInputFocused.value = true
  showSuggestions.value = true
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
    <div class="login-input-row">
      <img
        v-if="exactProfile?.avatarUrl"
        :src="exactProfile.avatarUrl"
        :alt="`${exactProfile.displayName} profile picture`"
        class="login-avatar"
        referrerpolicy="no-referrer"
      />
      <input
        ref="inputRef"
        id="bluesky-login-handle"
        v-model="blueskyHandle"
        type="text"
        role="combobox"
        name="username"
        autocomplete="username"
        aria-autocomplete="list"
        aria-controls="bluesky-login-suggestions"
        :aria-expanded="isPickerOpen"
        :aria-activedescendant="isPickerOpen ? activeSuggestionId : undefined"
        autocapitalize="none"
        spellcheck="false"
        placeholder="your.handle.bsky.social"
        class="mustard-notes-input login-handle-input"
        :disabled="isLoggingIn"
        @focus="onInputFocus"
        @input="showSuggestions = true"
        @blur="isInputFocused = false"
        @keydown="onInputKeyDown"
      />
    </div>
    <MentionPicker
      v-if="isPickerOpen"
      ref="pickerRef"
      id="bluesky-login-suggestions"
      :items="pickerItems"
      :query="blueskyHandle"
      :client-rect="inputRect"
      :on-select="selectProfile"
      :on-highlight-change="(id) => (activeSuggestionId = id)"
      footer="Bluesky profiles"
      inline
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

.login-input-row {
  display: flex;
  align-items: center;
  gap: 0.75rem;
}

.login-avatar {
  width: 2.5rem;
  height: 2.5rem;
  border-radius: 9999px;
  object-fit: cover;
  border: 2px solid var(--mustard-border);
  flex-shrink: 0;
}

.login-handle-input {
  min-width: 0;
  flex: 1;
}

.login-error {
  font-size: 0.875rem;
  color: #b91c1c;
  font-weight: 500;
}
</style>
