<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import {
  createGetProfilesMessage,
  createGetSubscriptionsMessage,
  createSetIdentitySubscriptionMessage,
  createSetPageSubscriptionMessage,
  createSetUserSubscriptionMessage,
  sendMessage,
} from '@/shared/messaging'
import { displayUrl } from '@/shared/display-url'
import type { MentionCandidate } from '@/shared/model/MentionCandidate'
import type { Subscription } from '@/shared/model/Subscription'
import { isPageSubscriptionSupported } from '@/shared/model/Subscription'
import type { UserProfile } from '@/shared/model/UserProfile'
import MentionPicker from '@/ui/content/note-editor/MentionPicker.vue'
import { useMentionCandidates } from '@/ui/content/note-editor/use-mention-candidates'

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
  if (!needle) return candidates.value
  return candidates.value.filter(
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
      <span>Subscriptions</span>
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
        footer="Bluesky mutuals & GitHub follows"
        inline
      />

      <p v-if="feedback" class="subscription-feedback">{{ feedback }}</p>

      <div v-if="pageSubscriptions.length || userSubscriptions.length" class="subscription-list">
        <div v-for="item in pageSubscriptions" :key="item.id" class="subscription-row">
          <span class="subscription-row-label" :title="item.pageKey">
            {{ displayUrl(item.pageKey) }}
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
          <span class="subscription-row-label">{{ userLabel(item.targetUserId) }}</span>
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

.subscription-row-label {
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
