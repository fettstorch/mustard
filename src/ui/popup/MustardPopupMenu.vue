<script setup lang="ts">
/**
 * MustardPopupMenu Component
 *
 * The main popup menu that appears when users click the Mustard extension icon
 * in the Chrome toolbar.
 */
import { ref, onMounted, watch } from 'vue'
import {
  createGetAtprotoSessionMessage,
  createAtprotoLogoutMessage,
  createGetProfilesMessage,
  type AtprotoSessionResponse,
  type GetProfilesResponse,
} from '@/shared/messaging'
import type { UserProfile } from '@/shared/model/UserProfile'
import BlueskyLogin from './auth/BlueskyLogin.vue'

const session = ref<AtprotoSessionResponse>(null)
const profile = ref<UserProfile | null>(null)

onMounted(async () => {
  // Get session via service worker (auth state lives there)
  const existingSession = (await chrome.runtime.sendMessage(
    createGetAtprotoSessionMessage(),
  )) as AtprotoSessionResponse
  if (existingSession) {
    session.value = existingSession
  }
})

// Fetch profile when session changes
watch(
  session,
  async (newSession) => {
    if (newSession) {
      const profiles = (await chrome.runtime.sendMessage(
        createGetProfilesMessage([newSession.did]),
      )) as GetProfilesResponse
      profile.value = profiles[newSession.did] ?? null
    } else {
      profile.value = null
    }
  },
  { immediate: true },
)

function onLoginSuccess(newSession: NonNullable<AtprotoSessionResponse>) {
  session.value = newSession
}

async function handleLogout() {
  if (!session.value) return
  await chrome.runtime.sendMessage(createAtprotoLogoutMessage(session.value.did))
  session.value = null
}

function openOptions() {
  chrome.runtime.openOptionsPage()
}

const gearIconUrl = chrome.runtime.getURL('gear_128.png')
const logoUrl = chrome.runtime.getURL('mustard_bottle_smile_512.png')
</script>

<template>
  <div class="mustard-popup mustard-notes-bg mustard-notes-txt">
    <div class="flex justify-between items-center mb-4">
      <h1 class="mustard-title flex items-center gap-1.5">
        <img :src="logoUrl" alt="Mustard" class="w-6 h-6" />
        Mustard
      </h1>
      <button
        @click="openOptions"
        class="mustard-icon-btn"
        title="Options"
      >
        <img :src="gearIconUrl" alt="Settings" class="w-5 h-5 block" />
      </button>
    </div>

    <!-- Logged in -->
    <div v-if="session" class="flex flex-col gap-3">
      <div class="flex items-center gap-3">
        <img
          v-if="profile?.avatarUrl"
          :src="profile.avatarUrl"
          alt="Profile picture"
          class="w-10 h-10 rounded-full object-cover border-2 border-[var(--mustard-border)]"
        />
        <div v-else class="w-10 h-10 rounded-full flex items-center justify-center border-2 avatar-placeholder">
          <span class="text-sm">?</span>
        </div>
        <div class="flex flex-col min-w-0">
          <span class="mustard-label font-medium truncate">
            {{ profile?.displayName ?? 'Loading...' }}
          </span>
          <span class="text-xs opacity-60 truncate"> @{{ profile?.handle ?? '...' }} </span>
        </div>
      </div>
      <button
        @click="handleLogout"
        class="mustard-notes-btn"
      >
        Logout
      </button>
    </div>

    <!-- Not logged in -->
    <BlueskyLogin v-else @success="onLoginSuccess" />
  </div>
</template>

<style scoped>
.mustard-popup {
  width: 300px;
  padding: 1em;
}

.mustard-title {
  font-size: 1.25rem;
  font-weight: 600;
}

.mustard-label {
  font-size: 0.875rem;
}

.mustard-icon-btn {
  padding: 4px;
  border-radius: 6px;
  transition: background-color 0.15s;
}

.mustard-icon-btn:hover {
  background-color: var(--mustard-glass);
}

.mustard-icon-btn:active {
  background-color: var(--mustard-glass-hover);
}

.avatar-placeholder {
  background-color: var(--mustard-orange-dark);
  border-color: var(--mustard-border);
}
</style>
