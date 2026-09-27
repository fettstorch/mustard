<script setup lang="ts">
import { computed, onUnmounted, ref } from 'vue'
import type { UserProfile } from '@/shared/model/UserProfile'
import { providerProfileUrl } from '@/shared/providers'
import {
  createGetSubscriptionsMessage,
  createSetUserSubscriptionMessage,
  sendMessage,
} from '@/shared/messaging'

const props = defineProps<{
  profile: UserProfile | null
  /** Enables the in-page Mustard profile card for a note's original author. */
  userId?: string
  canSubscribe?: boolean
  isOwnProfile?: boolean
  isOutdated?: boolean
}>()

const root = ref<HTMLElement | null>(null)
const open = ref(false)
const subscribed = ref(false)
const loading = ref(false)
const error = ref<string | null>(null)
const cardPosition = ref({ top: 0, left: 0 })

const profileUrl = computed(() => {
  if (!props.profile?.handle) return null
  return providerProfileUrl(props.profile.type, props.profile.handle)
})

const usesProfileCard = computed(() => !!props.userId)

async function toggleCard() {
  open.value = !open.value
  error.value = null
  if (!open.value) {
    removeGlobalListeners()
    return
  }

  const rect = root.value?.getBoundingClientRect()
  if (rect) {
    cardPosition.value = {
      top: rect.bottom + 6,
      left: Math.max(8, Math.min(rect.left, window.innerWidth - 228)),
    }
  }
  document.addEventListener('mousedown', onDocumentMouseDown)
  document.addEventListener('keydown', onDocumentKeyDown)

  if (props.canSubscribe && props.userId && !props.isOwnProfile) {
    loading.value = true
    const subscriptions = await sendMessage(createGetSubscriptionsMessage()).catch(() => [])
    subscribed.value = subscriptions.some(
      (item) => item.kind === 'user' && item.targetUserId === props.userId,
    )
    loading.value = false
  }
}

async function toggleSubscription() {
  if (!props.userId || !props.canSubscribe || props.isOwnProfile || props.isOutdated) return
  loading.value = true
  error.value = null
  const next = !subscribed.value
  try {
    await sendMessage(createSetUserSubscriptionMessage(props.userId, next))
    subscribed.value = next
  } catch {
    error.value = 'Could not update subscription.'
  } finally {
    loading.value = false
  }
}

function closeCard() {
  open.value = false
  removeGlobalListeners()
}

function onDocumentMouseDown(event: MouseEvent) {
  if (!root.value?.contains(event.target as Node)) closeCard()
}

function onDocumentKeyDown(event: KeyboardEvent) {
  if (event.key === 'Escape') closeCard()
}

function removeGlobalListeners() {
  document.removeEventListener('mousedown', onDocumentMouseDown)
  document.removeEventListener('keydown', onDocumentKeyDown)
}

onUnmounted(removeGlobalListeners)
</script>

<template>
  <span v-if="usesProfileCard" ref="root" class="author-profile-root">
    <button
      type="button"
      class="author-avatar author-avatar-button"
      :title="profile?.displayName ?? 'Loading...'"
      :aria-expanded="open"
      aria-haspopup="dialog"
      @click.stop="toggleCard"
      @mousedown.stop
    >
      <img
        v-if="profile?.avatarUrl"
        :src="profile.avatarUrl"
        :alt="profile.displayName"
        class="avatar-image"
        draggable="false"
      />
      <span v-else class="avatar-placeholder" />
    </button>

    <span
      v-if="open"
      role="dialog"
      :aria-label="`${profile?.displayName ?? 'Mustard user'} profile`"
      class="author-profile-card mustard-notes-bg mustard-notes-border mustard-notes-txt"
      :style="{ top: `${cardPosition.top}px`, left: `${cardPosition.left}px` }"
      @mousedown.stop
    >
      <img
        v-if="profile?.avatarUrl"
        :src="profile.avatarUrl"
        :alt="profile.displayName"
        class="profile-card-avatar"
        draggable="false"
      />
      <span v-else class="profile-card-avatar avatar-placeholder" />
      <span class="profile-card-copy">
        <strong class="profile-card-name">{{ profile?.displayName ?? 'Mustard user' }}</strong>
        <span v-if="profile?.handle" class="profile-card-handle">@{{ profile.handle }}</span>
      </span>
      <button
        v-if="canSubscribe && !isOwnProfile"
        type="button"
        class="profile-card-subscribe"
        :disabled="loading || isOutdated"
        @click.stop="toggleSubscription"
      >
        {{ loading ? 'Loading…' : subscribed ? 'Unsubscribe' : 'Subscribe' }}
      </button>
      <a
        v-if="profileUrl"
        :href="profileUrl"
        target="_blank"
        rel="noopener noreferrer"
        class="profile-card-link"
        @click.stop
        @mousedown.stop
      >
        View on {{ profile?.type === 'github' ? 'GitHub' : 'Bluesky' }}
      </a>
      <span v-if="error" class="profile-card-error">{{ error }}</span>
    </span>
  </span>
  <a
    v-else-if="profileUrl"
    :href="profileUrl"
    target="_blank"
    rel="noopener noreferrer"
    class="author-avatar"
    :title="profile?.displayName ?? 'Loading...'"
    @mousedown.stop
  >
    <img
      v-if="profile?.avatarUrl"
      :src="profile.avatarUrl"
      :alt="profile.displayName"
      class="avatar-image"
      draggable="false"
    />
    <div v-else class="avatar-placeholder" />
  </a>
  <div v-else class="author-avatar" :title="profile?.displayName ?? 'Loading...'">
    <img
      v-if="profile?.avatarUrl"
      :src="profile.avatarUrl"
      :alt="profile.displayName"
      class="avatar-image"
      draggable="false"
    />
    <div v-else class="avatar-placeholder" />
  </div>
</template>

<style scoped>
.author-avatar {
  display: block;
  width: 24px;
  height: 24px;
  flex-shrink: 0;
  cursor: pointer;
}

.author-profile-root {
  display: block;
  width: 24px;
  height: 24px;
  flex-shrink: 0;
}

.author-avatar-button {
  padding: 0;
  border: 0;
  background: transparent;
}

.author-profile-card {
  position: fixed;
  z-index: 2147483647;
  display: grid;
  grid-template-columns: 48px minmax(0, 1fr);
  gap: 8px 10px;
  width: 220px;
  box-sizing: border-box;
  padding: 10px;
  border-radius: 10px;
  cursor: default;
  user-select: text;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.24);
}

.profile-card-avatar {
  grid-row: span 2;
  width: 48px;
  height: 48px;
  border-radius: 50%;
  object-fit: cover;
}

.profile-card-copy {
  display: flex;
  flex-direction: column;
  min-width: 0;
  align-self: center;
}

.profile-card-name,
.profile-card-handle {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.profile-card-name {
  font-size: 0.8rem;
}

.profile-card-handle {
  font-size: 0.7rem;
  opacity: 0.65;
}

.profile-card-subscribe,
.profile-card-link {
  grid-column: 1 / -1;
  box-sizing: border-box;
  width: 100%;
  padding: 5px 8px;
  border-radius: 6px;
  font: inherit;
  font-size: 0.72rem;
  text-align: center;
}

.profile-card-subscribe {
  border: 1px solid var(--mustard-border-subtle);
  background: var(--mustard-glass-hover);
  color: inherit;
  cursor: pointer;
}

.profile-card-link {
  color: inherit;
  text-decoration: underline;
  opacity: 0.7;
}

.profile-card-error {
  grid-column: 1 / -1;
  font-size: 0.65rem;
  color: var(--mustard-error, #c62828);
}

.avatar-image {
  width: 100%;
  height: 100%;
  border-radius: 50%;
  object-fit: cover;
}

.avatar-placeholder {
  width: 100%;
  height: 100%;
  border-radius: 50%;
  background: rgba(128, 128, 128, 0.3);
}
</style>
