<script setup lang="ts">
/**
 * ProviderLogin Component
 *
 * Shows Bluesky and GitHub login options side by side. Delegates to
 * BlueskyLogin or GithubLogin depending on the selected provider tab.
 */
import { ref } from 'vue'
import BlueskyLogin from './BlueskyLogin.vue'
import GithubLogin from './GithubLogin.vue'
import type { AtprotoSessionResponse } from '@/shared/messaging'

type Provider = 'bluesky' | 'github'

const emit = defineEmits<{
  success: [session: NonNullable<AtprotoSessionResponse>]
}>()

const activeProvider = ref<Provider>('bluesky')

function onSuccess(session: NonNullable<AtprotoSessionResponse>) {
  emit('success', session)
}
</script>

<template>
  <div class="provider-login">
    <!-- Provider tabs -->
    <div class="provider-tabs" role="tablist">
      <button
        role="tab"
        :aria-selected="activeProvider === 'bluesky'"
        :class="['provider-tab', activeProvider === 'bluesky' && 'is-active']"
        @click="activeProvider = 'bluesky'"
      >
        Bluesky
      </button>
      <button
        role="tab"
        :aria-selected="activeProvider === 'github'"
        :class="['provider-tab', activeProvider === 'github' && 'is-active']"
        @click="activeProvider = 'github'"
      >
        GitHub
      </button>
    </div>

    <!-- Provider form -->
    <BlueskyLogin v-if="activeProvider === 'bluesky'" @success="onSuccess" />
    <GithubLogin v-else-if="activeProvider === 'github'" @success="onSuccess" />
  </div>
</template>

<style scoped>
.provider-login {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}

.provider-tabs {
  display: flex;
  gap: 0;
  border-bottom: 1px solid var(--mustard-border-subtle);
  margin-bottom: 0.25rem;
}

.provider-tab {
  flex: 1;
  padding: 0.4rem 0;
  font-size: 0.8125rem;
  font-weight: 500;
  color: var(--mustard-text);
  opacity: 0.55;
  border-bottom: 2px solid transparent;
  border-radius: 0;
  transition:
    opacity 0.15s,
    border-color 0.15s;
}

.provider-tab:hover {
  opacity: 0.8;
}

.provider-tab.is-active {
  opacity: 1;
  border-bottom-color: var(--mustard-border);
}
</style>
