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
  type AtprotoSessionResponse,
} from '@/shared/messaging'
import { MustardProfileServiceBsky } from '@/background/business/service/MustardProfileServiceBsky'
import type { UserProfile } from '@/shared/model/UserProfile'
import BlueskyLogin from './auth/BlueskyLogin.vue'

const session = ref<AtprotoSessionResponse>(null)
const profile = ref<UserProfile | null>(null)
const profileService = new MustardProfileServiceBsky()

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
      profile.value = await profileService.getProfile(newSession.did)
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
</script>

<template>
  <div class="w-75 p-4">
    <div class="flex justify-between items-center mb-4">
      <h1 class="text-xl font-semibold">🌭 Mustard</h1>
      <button
        @click="openOptions"
        class="p-1 rounded hover:bg-gray-100 active:bg-gray-200 transition-colors"
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
          class="w-10 h-10 rounded-full object-cover"
        />
        <div v-else class="w-10 h-10 rounded-full bg-gray-200 flex items-center justify-center">
          <span class="text-gray-500 text-sm">?</span>
        </div>
        <div class="flex flex-col min-w-0">
          <span class="text-sm font-medium text-gray-900 truncate">
            {{ profile?.displayName ?? 'Loading...' }}
          </span>
          <span class="text-xs text-gray-500 truncate">
            @{{ profile?.handle ?? '...' }}
          </span>
        </div>
      </div>
      <button
        @click="handleLogout"
        class="px-3 py-2 bg-gray-100 border border-gray-300 rounded-md text-sm hover:bg-gray-200 transition-colors"
      >
        Logout
      </button>
    </div>

    <!-- Not logged in -->
    <BlueskyLogin v-else @success="onLoginSuccess" />
  </div>
</template>
