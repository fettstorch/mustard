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
  createGetNotesVisibleMessage,
  createSetNotesVisibleMessage,
  createGetAppStatusMessage,
  createRequestUpdateMessage,
  sendMessage,
  sendTabMessage,
  type AtprotoSessionResponse,
} from '@/shared/messaging'
import type { UserProfile } from '@/shared/model/UserProfile'
import BlueskyLogin from './auth/BlueskyLogin.vue'
import MyPagesSection from './MyPagesSection.vue'
import MentionsSection from './MentionsSection.vue'

const NOTES_MINIMIZED_KEY = 'mustard-notes-minimized'

const session = ref<AtprotoSessionResponse>(null)
const profile = ref<UserProfile | null>(null)
const isOutdated = ref(false)
const areNotesVisible = ref(true)
const areNotesMinimized = ref(false)
const activeTabId = ref<number | null>(null)

onMounted(async () => {
  // Client-version guard: surface an update notice when the backend has moved
  // past this build. Fail-open — any error leaves the popup fully usable.
  sendMessage(createGetAppStatusMessage())
    .then((status) => {
      isOutdated.value = !!status?.outdated
    })
    .catch(() => {})

  // Get session via service worker (auth state lives there)
  const existingSession = await sendMessage(createGetAtprotoSessionMessage())
  if (existingSession) {
    session.value = existingSession
  }

  // Load minimize preference from storage
  const stored = await browser.storage.local.get(NOTES_MINIMIZED_KEY)
  areNotesMinimized.value = !!stored[NOTES_MINIMIZED_KEY]

  // Get active tab and query its notes visibility state
  const [tab] = await browser.tabs.query({ active: true, currentWindow: true })
  if (tab?.id && tab.url && (tab.url.startsWith('http://') || tab.url.startsWith('https://'))) {
    activeTabId.value = tab.id
    try {
      areNotesVisible.value = await sendTabMessage(tab.id, createGetNotesVisibleMessage())
    } catch {
      // Content script not yet injected on this tab (e.g. tab was open before install)
    }
  }
})

function onUpdateClick() {
  // Background decides what's possible: Chrome triggers a store update check +
  // reload; elsewhere it opens the store listing (or no-ops if not configured).
  sendMessage(createRequestUpdateMessage()).catch(() => {})
}

async function toggleNotesVisibility() {
  if (!activeTabId.value) return
  try {
    const newVisible = !areNotesVisible.value
    await sendTabMessage(activeTabId.value, createSetNotesVisibleMessage(newVisible))
    areNotesVisible.value = newVisible
  } catch {
    // Content script not available on this tab
  }
}

function toggleNotesMinimized() {
  const newValue = !areNotesMinimized.value
  areNotesMinimized.value = newValue
  browser.storage.local.set({ [NOTES_MINIMIZED_KEY]: newValue })
}

// Fetch profile when session changes
watch(
  session,
  async (newSession) => {
    if (newSession) {
      const profiles = await sendMessage(createGetProfilesMessage([newSession.did]))
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
  await sendMessage(createAtprotoLogoutMessage(session.value.did))
  session.value = null
}

function openOptions() {
  browser.runtime.openOptionsPage()
}

const gearIconUrl = browser.runtime.getURL('/gear_128.png')
const logoUrl = browser.runtime.getURL('/mustard_bottle_smile_512.png')
</script>

<template>
  <div class="mustard-popup mustard-notes-bg mustard-notes-txt">
    <div class="popup-header">
      <h1 class="mustard-title">
        <img :src="logoUrl" alt="Mustard" class="popup-logo" />
        Mustard
      </h1>
      <button @click="openOptions" class="mustard-icon-btn" title="Options">
        <img :src="gearIconUrl" alt="Settings" class="icon-img" />
      </button>
    </div>

    <!-- Update-required guard: shown when this build is below the backend's
         minimum supported version. -->
    <div v-if="isOutdated" class="update-banner">
      <strong>Update required</strong>
      <span>
        This version of Mustard is no longer supported. Update it to keep using it. You might also
        need to re-login here afterwards.
      </span>
      <button class="update-button" @click="onUpdateClick">Update now</button>
    </div>

    <!-- Notes visibility toggle -->
    <div v-if="activeTabId" class="mustard-toggle-row">
      <span class="mustard-label">Show notes</span>
      <button
        @click="toggleNotesVisibility"
        :class="['mustard-toggle', areNotesVisible ? 'is-on' : 'is-off']"
        :title="areNotesVisible ? 'Hide notes on this page' : 'Show notes on this page'"
      >
        <span class="mustard-toggle-knob" />
      </button>
    </div>

    <!-- Minimize notes toggle (only when notes are visible) -->
    <div v-if="activeTabId && areNotesVisible" class="mustard-toggle-row">
      <span class="mustard-label">Minimize notes</span>
      <button
        @click="toggleNotesMinimized"
        :class="['mustard-toggle', areNotesMinimized ? 'is-on' : 'is-off']"
        :title="areNotesMinimized ? 'Show full notes' : 'Minimize notes to dots'"
      >
        <span class="mustard-toggle-knob" />
      </button>
    </div>

    <!-- Logged in -->
    <div v-if="session" class="session-container">
      <MentionsSection :is-outdated="isOutdated" />
      <MyPagesSection />
      <div class="profile-row">
        <img
          v-if="profile?.avatarUrl"
          :src="profile.avatarUrl"
          alt="Profile picture"
          class="avatar"
        />
        <div v-else class="avatar avatar-placeholder">
          <span class="avatar-placeholder-text">?</span>
        </div>
        <div class="profile-info">
          <span class="profile-name mustard-label">
            {{ profile?.displayName ?? 'Loading...' }}
          </span>
          <span class="profile-handle"> @{{ profile?.handle ?? '...' }} </span>
        </div>
      </div>
      <button @click="handleLogout" class="mustard-notes-btn">Logout</button>
    </div>

    <!-- Not logged in -->
    <BlueskyLogin v-else @success="onLoginSuccess" />
  </div>
</template>

<!--
  Non-scoped: hide the browser-default popup-level scrollbars (Firefox draws
  ugly grey ones, WebKit auto-hides). Scrolling still works — when the popup
  content exceeds the browser's popup ceiling, the body still scrolls so the
  logout button stays reachable; only the scrollbar chrome is invisible.
-->
<style>
html,
body {
  /* Firefox */
  scrollbar-width: none;
  /* legacy Edge/IE */
  -ms-overflow-style: none;
}

html::-webkit-scrollbar,
body::-webkit-scrollbar {
  /* Chrome/Safari/Edge */
  display: none;
}
</style>

<style scoped>
.mustard-popup {
  width: 300px;
  padding: 1em;
}

.popup-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 1rem;
}

.mustard-title {
  display: flex;
  align-items: center;
  gap: 0.375rem;
  font-size: 1.25rem;
  font-weight: 600;
}

.popup-logo {
  width: 1.5rem;
  height: 1.5rem;
}

.icon-img {
  width: 1.25rem;
  height: 1.25rem;
  display: block;
}

.mustard-label {
  font-size: 0.875rem;
}

.update-banner {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
  padding: 0.625rem 0.75rem;
  margin-bottom: 0.75rem;
  border-radius: 8px;
  border: 2px solid var(--mustard-border);
  background: var(--mustard-glass);
  font-size: 0.8125rem;
  line-height: 1.35;
}

.update-banner strong {
  font-size: 0.875rem;
}

.update-button {
  align-self: flex-start;
  margin-top: 0.25rem;
  padding: 0.375rem 0.75rem;
  border-radius: 6px;
  border: 2px solid var(--mustard-border);
  background: var(--mustard-glass);
  font-size: 0.8125rem;
  font-weight: 600;
  cursor: pointer;
  transition: background-color 0.15s;
}

.update-button:hover {
  background: var(--mustard-glass-hover);
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

.mustard-toggle-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0.5rem 0;
  margin-bottom: 0.75rem;
  border-bottom: 1px solid var(--mustard-border-subtle);
}

.mustard-toggle {
  position: relative;
  display: inline-flex;
  height: 24px;
  width: 44px;
  align-items: center;
  border-radius: 9999px;
  transition: background-color 0.2s;
  border: 2px solid var(--mustard-border);
}

.mustard-toggle.is-on {
  background-color: var(--mustard-border);
}

.mustard-toggle.is-off {
  background-color: var(--mustard-glass);
}

.mustard-toggle-knob {
  display: inline-block;
  height: 16px;
  width: 16px;
  border-radius: 9999px;
  background-color: var(--mustard-yellow-light);
  transition: transform 0.2s;
  border: 1px solid var(--mustard-border);
}

.mustard-toggle.is-on .mustard-toggle-knob {
  transform: translateX(22px);
}

.mustard-toggle.is-off .mustard-toggle-knob {
  transform: translateX(2px);
}

.session-container {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}

.profile-row {
  display: flex;
  align-items: center;
  gap: 0.75rem;
}

.avatar {
  width: 2.5rem;
  height: 2.5rem;
  border-radius: 9999px;
  object-fit: cover;
  border: 2px solid var(--mustard-border);
  flex-shrink: 0;
}

.avatar-placeholder {
  display: flex;
  align-items: center;
  justify-content: center;
  background-color: var(--mustard-orange-dark);
  border-color: var(--mustard-border);
}

.avatar-placeholder-text {
  font-size: 0.875rem;
}

.profile-info {
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.profile-name {
  font-weight: 500;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.profile-handle {
  font-size: 0.75rem;
  opacity: 0.6;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
