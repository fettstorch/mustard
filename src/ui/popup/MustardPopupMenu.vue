<script setup lang="ts">
/**
 * MustardPopupMenu Component
 *
 * The main popup menu that appears when users click the Mustard extension icon
 * in the Chrome toolbar.
 */
import { ref, onMounted } from 'vue'
import { logout, getSession } from '@/background/auth/AtprotoAuth'
import type { OAuthSession } from '@atproto/oauth-client-browser'
import BlueskyLogin from './auth/BlueskyLogin.vue'

const session = ref<OAuthSession | null>(null)

onMounted(async () => {
  const existingSession = await getSession()
  if (existingSession) {
    session.value = existingSession
  }
})

function onLoginSuccess(newSession: OAuthSession) {
  session.value = newSession
}

async function handleLogout() {
  if (!session.value) return
  await logout(session.value.did)
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
      <p class="text-sm text-gray-700 break-all">
        Logged in as <strong>{{ session.did }}</strong>
      </p>
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
