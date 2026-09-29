<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import {
  createGetProfilesMessage,
  createGetSubscriptionsMessage,
  createResolveSubscriptionIdentitiesMessage,
  createSetIdentitySubscriptionMessage,
  createSetPageSubscriptionMessage,
  createSetUserSubscriptionMessage,
  sendMessage,
} from '@/shared/messaging'
import { displayUrl, pageFaviconUrl } from '@/shared/display-url'
import type { MentionCandidate } from '@/shared/model/MentionCandidate'
import type { Subscription } from '@/shared/model/Subscription'
import { isPageSubscriptionSupported } from '@/shared/model/Subscription'
import type { UserProfile } from '@/shared/model/UserProfile'
import MentionPicker from '@/ui/content/note-editor/MentionPicker.vue'
import { useMentionCandidates } from '@/ui/content/note-editor/use-mention-candidates'
import { filterSubscriptionCandidates } from './subscription-candidates'

const props = defineProps<{
  pageKey: string | null
  isOutdated?: boolean
}>()

const expanded = ref(false)
const subscriptions = ref<Subscription[]>([])
const profiles = ref<Record<string, UserProfile | null>>({})
const query = ref('')
const pickerRef = ref<InstanceType<typeof MentionPicker> | null>(null)
const inputFocused = ref(false)
const activeSuggestionId = ref<string>()
const busyTarget = ref<string | null>(null)
const feedback = ref<string | null>(null)
const { candidates } = useMentionCandidates()
const resolvedCandidateUserIds = ref<Record<string, string>>({})
let candidateRequestId = 0

watch(
  candidates,
  async (nextCandidates) => {
    const requestId = ++candidateRequestId
    resolvedCandidateUserIds.value = {}
    if (!nextCandidates.length) return
    const resolved = await sendMessage(
      createResolveSubscriptionIdentitiesMessage(
        nextCandidates.map(({ provider, accountId }) => ({ provider, accountId })),
      ),
    ).catch(() => ({}))
    if (requestId === candidateRequestId) resolvedCandidateUserIds.value = resolved
  },
  { immediate: true },
)

const subscriptionCandidates = computed(() =>
  filterSubscriptionCandidates(candidates.value, resolvedCandidateUserIds.value),
)

const pageSupported = computed(
  () => props.pageKey != null && isPageSubscriptionSupported(props.pageKey),
)
const pageSubscribed = computed(() =>
  subscriptions.value.some((item) => item.kind === 'page' && item.pageKey === props.pageKey),
)
const pageSubscriptions = computed(() => subscriptions.value.filter((item) => item.kind === 'page'))
const userSubscriptions = computed(() => subscriptions.value.filter((item) => item.kind === 'user'))
const pickerItems = computed(() => {
  const needle = query.value.trim().replace(/^@/, '').toLowerCase()
  if (!needle) return subscriptionCandidates.value
  return subscriptionCandidates.value.filter(
    (item) =>
      item.handle.toLowerCase().includes(needle) || item.displayName.toLowerCase().includes(needle),
  )
})
const pickerOpen = computed(() => inputFocused.value && query.value.trim().length > 0)

async function refresh() {
  subscriptions.value = await sendMessage(createGetSubscriptionsMessage()).catch(() => [])
  const userIds = subscriptions.value
    .filter((item) => item.kind === 'user')
    .map((item) => item.targetUserId)
  profiles.value = userIds.length
    ? await sendMessage(createGetProfilesMessage(userIds)).catch(() => ({}))
    : {}
}

onMounted(refresh)

async function togglePageSubscription() {
  if (!props.pageKey || !pageSupported.value || props.isOutdated) return
  const next = !pageSubscribed.value
  busyTarget.value = 'page'
  feedback.value = null
  try {
    await sendMessage(createSetPageSubscriptionMessage(props.pageKey, next))
    await refresh()
  } catch {
    feedback.value = 'Could not update this page subscription.'
  } finally {
    busyTarget.value = null
  }
}

async function subscribeToCandidate(candidate: MentionCandidate) {
  if (props.isOutdated) return
  const key = `${candidate.provider}:${candidate.accountId}`
  busyTarget.value = key
  feedback.value = null
  try {
    const userId = await sendMessage(
      createSetIdentitySubscriptionMessage(
        { provider: candidate.provider, accountId: candidate.accountId },
        true,
      ),
    )
    if (!userId) {
      feedback.value = `${candidate.displayName} does not use Mustard yet.`
      return
    }
    query.value = ''
    inputFocused.value = false
    await refresh()
  } catch {
    feedback.value = 'Could not subscribe to this person.'
  } finally {
    busyTarget.value = null
  }
}

async function removeUserSubscription(targetUserId: string) {
  if (props.isOutdated) return
  busyTarget.value = targetUserId
  feedback.value = null
  try {
    await sendMessage(createSetUserSubscriptionMessage(targetUserId, false))
    await refresh()
  } catch {
    feedback.value = 'Could not remove this subscription.'
  } finally {
    busyTarget.value = null
  }
}

async function removePageSubscription(pageKey: string) {
  if (props.isOutdated) return
  busyTarget.value = pageKey
  feedback.value = null
  try {
    await sendMessage(createSetPageSubscriptionMessage(pageKey, false))
    await refresh()
  } catch {
    feedback.value = 'Could not remove this subscription.'
  } finally {
    busyTarget.value = null
  }
}

function onInputKeyDown(event: KeyboardEvent) {
  if (event.key === 'Escape') {
    inputFocused.value = false
    return
  }
  if (pickerOpen.value && pickerRef.value?.onKeyDown?.(event)) event.preventDefault()
}

function userLabel(targetUserId: string): string {
  const profile = profiles.value[targetUserId]
  return profile?.displayName || (profile?.handle ? `@${profile.handle}` : 'Mustard user')
}

function hideFailedImage(event: Event) {
  if (event.currentTarget instanceof HTMLImageElement) event.currentTarget.hidden = true
}
</script>

<template>
  <section class="subscriptions-section popup-section">
    <button
      type="button"
      class="subscriptions-heading popup-section-header"
      :aria-expanded="expanded"
      aria-controls="subscriptions-panel"
      @click="expanded = !expanded"
    >
      <span class="popup-section-title">Subscriptions</span>
      <span class="subscriptions-chevron" :class="{ 'is-open': expanded }" aria-hidden="true"
        >›</span
      >
    </button>

    <div v-if="expanded" id="subscriptions-panel" class="subscriptions-panel">
      <button
        v-if="pageSupported"
        type="button"
        class="mustard-notes-btn subscription-page-button"
        :disabled="busyTarget === 'page' || isOutdated"
        @click="togglePageSubscription"
      >
        {{ pageSubscribed ? 'Unsubscribe from this page' : 'Subscribe to notes on this page' }}
      </button>
      <p v-else-if="pageKey?.startsWith('at://')" class="subscription-hint">
        Page subscriptions are not available for Bluesky posts.
      </p>

      <label class="subscription-label" for="subscription-user-search">Subscribe to a user</label>
      <input
        id="subscription-user-search"
        v-model="query"
        class="mustard-notes-input subscription-input"
        type="text"
        role="combobox"
        autocomplete="off"
        aria-autocomplete="list"
        aria-controls="subscription-user-suggestions"
        :aria-expanded="pickerOpen"
        :aria-activedescendant="pickerOpen ? activeSuggestionId : undefined"
        placeholder="Search friends"
        :disabled="isOutdated"
        @focus="inputFocused = true"
        @blur="inputFocused = false"
        @keydown="onInputKeyDown"
      />
      <MentionPicker
        v-if="pickerOpen"
        ref="pickerRef"
        id="subscription-user-suggestions"
        :items="pickerItems"
        :query="query"
        :client-rect="null"
        :on-select="subscribeToCandidate"
        :on-highlight-change="(id) => (activeSuggestionId = id)"
        footer="Mustard accounts you follow"
        inline
      />

      <p v-if="feedback" class="subscription-feedback">{{ feedback }}</p>

      <div v-if="pageSubscriptions.length || userSubscriptions.length" class="subscription-list">
        <div v-for="item in pageSubscriptions" :key="item.id" class="subscription-row">
          <span class="subscription-row-main">
            <span class="subscription-row-icon subscription-page-icon" aria-hidden="true">
              <svg viewBox="0 0 24 24" fill="none">
                <circle cx="12" cy="12" r="8.5" />
                <path
                  d="M3.5 12h17M12 3.5c2.2 2.3 3.3 5.1 3.3 8.5S14.2 18.2 12 20.5M12 3.5C9.8 5.8 8.7 8.6 8.7 12s1.1 6.2 3.3 8.5"
                />
              </svg>
              <img
                v-if="pageFaviconUrl(item.pageKey)"
                :src="pageFaviconUrl(item.pageKey) ?? undefined"
                alt=""
                referrerpolicy="no-referrer"
                @error="hideFailedImage"
              />
            </span>
            <span class="subscription-row-label" :title="item.pageKey">
              {{ displayUrl(item.pageKey) }}
            </span>
          </span>
          <button
            type="button"
            class="subscription-remove"
            :disabled="busyTarget === item.pageKey || isOutdated"
            :aria-label="`Unsubscribe from ${item.pageKey}`"
            @click="removePageSubscription(item.pageKey)"
          >
            <span aria-hidden="true">×</span>
          </button>
        </div>
        <div v-for="item in userSubscriptions" :key="item.id" class="subscription-row">
          <span class="subscription-row-main">
            <span class="subscription-row-icon subscription-user-avatar" aria-hidden="true">
              <svg viewBox="0 0 24 24" fill="none">
                <circle cx="12" cy="8.5" r="3.5" />
                <path d="M5.5 20c.6-4 2.8-6 6.5-6s5.9 2 6.5 6" />
              </svg>
              <img
                v-if="profiles[item.targetUserId]?.avatarUrl"
                :src="profiles[item.targetUserId]?.avatarUrl"
                alt=""
                referrerpolicy="no-referrer"
                @error="hideFailedImage"
              />
            </span>
            <span class="subscription-row-label">{{ userLabel(item.targetUserId) }}</span>
          </span>
          <button
            type="button"
            class="subscription-remove"
            :disabled="busyTarget === item.targetUserId || isOutdated"
            :aria-label="`Unsubscribe from ${userLabel(item.targetUserId)}`"
            @click="removeUserSubscription(item.targetUserId)"
          >
            <span aria-hidden="true">×</span>
          </button>
        </div>
      </div>
    </div>
  </section>
</template>

<style scoped>
.subscriptions-section {
  min-width: 0;
}

.subscriptions-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  width: 100%;
  border: 0;
  background: transparent;
  color: var(--mustard-text);
  font: inherit;
  font-size: 0.875rem;
  font-weight: 500;
  cursor: pointer;
}

.subscriptions-chevron {
  font-size: 1rem;
  line-height: 1;
  transition: transform 0.15s ease;
}

.subscriptions-chevron.is-open {
  transform: rotate(90deg);
}

.subscriptions-panel {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.subscription-page-button {
  width: 100%;
}

.subscription-label {
  font-size: 0.75rem;
  font-weight: 600;
}

.subscription-input {
  width: 100%;
  box-sizing: border-box;
}

.subscription-hint,
.subscription-feedback {
  margin: 0;
  font-size: 0.7rem;
  line-height: 1.35;
  opacity: 0.7;
}

.subscription-feedback {
  color: var(--mustard-error, #c62828);
  opacity: 1;
}

.subscription-list {
  display: flex;
  flex-direction: column;
  gap: 2px;
  max-height: 180px;
  overflow-y: auto;
  overflow-x: hidden;
  padding-right: 2px;
  scrollbar-gutter: stable;
}

.subscription-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem;
  padding: 5px 6px;
  border: 1px solid var(--mustard-border-subtle);
  border-radius: 6px;
  font-size: 0.7rem;
}

.subscription-row-main {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
  flex: 1;
}

.subscription-row-icon {
  position: relative;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex: 0 0 24px;
  width: 24px;
  height: 24px;
  overflow: hidden;
  border: 1px solid var(--mustard-border-subtle);
  background: var(--mustard-glass-hover);
  color: inherit;
  opacity: 0.9;
}

.subscription-row-icon svg {
  width: 15px;
  height: 15px;
  stroke: currentColor;
  stroke-width: 1.5;
  stroke-linecap: round;
  stroke-linejoin: round;
  opacity: 0.55;
}

.subscription-row-icon img {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: cover;
  background: var(--mustard-glass);
}

.subscription-page-icon {
  border-radius: 6px;
}

.subscription-page-icon img {
  padding: 3px;
  box-sizing: border-box;
  object-fit: contain;
}

.subscription-user-avatar {
  border-radius: 50%;
}

.subscription-row-label {
  display: block;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.subscription-remove {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  width: 22px;
  height: 22px;
  padding: 0;
  border: 1px solid transparent;
  border-radius: 50%;
  background: transparent;
  color: inherit;
  font: inherit;
  font-size: 1rem;
  line-height: 1;
  cursor: pointer;
  opacity: 0.7;
  transition:
    background-color 0.15s ease,
    border-color 0.15s ease,
    opacity 0.15s ease;
}

.subscription-remove:hover {
  border-color: var(--mustard-border-subtle);
  background: var(--mustard-glass-hover);
  opacity: 1;
}
</style>
