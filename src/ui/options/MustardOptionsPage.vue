<script setup lang="ts">
/**
 * MustardOptionsPage Component
 *
 * Purpose:
 * This is the settings/preferences page for the Mustard extension. Users can configure
 * extension-wide settings, manage their account, and adjust preferences.
 *
 * How to access in Chrome:
 * Method 1: Right-click the Mustard extension icon → Select "Options"
 * Method 2: Go to chrome://extensions → Find "Mustard" → Click "Options" or "Extension options"
 * Method 3: Programmatically via browser.runtime.openOptionsPage() API
 *
 * Note: This is different from the popup menu (MustardPopupMenu.vue) which opens
 * when clicking the extension icon. This is a full-page settings interface.
 */

import { ref, onMounted } from 'vue'
import { version } from '../../../package.json'

const PUBLISH_CONFIRM_DISMISSED_KEY = 'mustard-publish-confirm-dismissed'
const NOTES_MINIMIZED_KEY = 'mustard-notes-minimized'
const SHOW_ANCHOR_IN_EDITOR_KEY = 'mustard-show-anchor-in-editor'

const logoUrl = browser.runtime.getURL('/mustard_bottle_smile_512.png')
const helloMustardUrl = 'https://fettstorch.github.io/mustard/'
const bskyProfileUrl = 'https://bsky.app/profile/mustardnotes.com'

const showPublishWarning = ref(true)
const minimizeNotes = ref(false)
const showAnchorInEditor = ref(false)
const minimizeShortcut = ref<string>('')
const shortcutsUrl = ref<string>('')

onMounted(async () => {
  const result = await browser.storage.local.get([
    PUBLISH_CONFIRM_DISMISSED_KEY,
    NOTES_MINIMIZED_KEY,
    SHOW_ANCHOR_IN_EDITOR_KEY,
  ])
  showPublishWarning.value = !result[PUBLISH_CONFIRM_DISMISSED_KEY]
  minimizeNotes.value = !!result[NOTES_MINIMIZED_KEY]
  showAnchorInEditor.value = !!result[SHOW_ANCHOR_IN_EDITOR_KEY]

  // Read the live keybinding so it stays accurate after the user rebinds.
  try {
    const commands = (await browser.commands?.getAll?.()) ?? []
    const cmd = commands.find((c) => c.name === 'toggle-minimize-notes')
    minimizeShortcut.value = cmd?.shortcut || ''
  } catch {
    // commands API unavailable — leave shortcut empty.
  }

  // Firefox has no deep link to per-extension shortcut management; about:addons
  // is the closest. Chromium browsers expose chrome://extensions/shortcuts.
  const isFirefox = typeof (browser.runtime as { getBrowserInfo?: unknown }).getBrowserInfo === 'function'
  shortcutsUrl.value = isFirefox ? 'about:addons' : 'chrome://extensions/shortcuts'
})

function openShortcutsPage() {
  // chrome:// and about: URLs can't be opened via window.open — must use tabs.create.
  if (shortcutsUrl.value) {
    browser.tabs.create({ url: shortcutsUrl.value }).catch(() => {})
  }
}

function onPublishWarningChange() {
  browser.storage.local.set({ [PUBLISH_CONFIRM_DISMISSED_KEY]: !showPublishWarning.value })
}

function onMinimizeNotesChange() {
  browser.storage.local.set({ [NOTES_MINIMIZED_KEY]: minimizeNotes.value })
}

function onShowAnchorInEditorChange() {
  browser.storage.local.set({ [SHOW_ANCHOR_IN_EDITOR_KEY]: showAnchorInEditor.value })
}

function openKofi() {
  window.open('https://ko-fi.com/fettstorch', '_blank')
}
</script>

<template>
  <div class="options-page mustard-notes-bg mustard-notes-txt">
    <div class="header">
      <img :src="logoUrl" alt="Mustard" class="logo" />
      <h1>Mustard Options</h1>
      <span class="version">v{{ version }}</span>
    </div>

    <div class="content">
      <!-- Ko-fi section hidden for now -->
      <section v-if="false" class="support-section">
        <h2 class="section-title">Support Mustard</h2>
        <p class="section-desc">
          If you enjoy using Mustard, consider buying me a coffee to support development!
        </p>
        <button class="kofi-btn" @click="openKofi">
          <svg class="kofi-icon" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path
              d="M5 11.5C5 9.567 6.567 8 8.5 8H16V11.5C16 14.538 13.538 17 10.5 17C7.462 17 5 14.538 5 11.5Z"
              fill="currentColor"
            />
            <path
              d="M16 8H17.5C19.433 8 21 9.567 21 11.5C21 13.433 19.433 15 17.5 15H16V8Z"
              fill="currentColor"
            />
          </svg>
          Buy me a coffee on Ko-fi
        </button>
      </section>

      <section class="prefs-section">
        <h2 class="section-title">Preferences</h2>
        <label class="pref-row">
          <input
            v-model="showPublishWarning"
            type="checkbox"
            class="pref-checkbox"
            @change="onPublishWarningChange"
          />
          <span class="pref-label">Show publish warning</span>
        </label>
        <label class="pref-row">
          <input
            v-model="minimizeNotes"
            type="checkbox"
            class="pref-checkbox"
            @change="onMinimizeNotesChange"
          />
          <span class="pref-label">Minimize notes</span>
        </label>
        <label class="pref-row">
          <input
            v-model="showAnchorInEditor"
            type="checkbox"
            class="pref-checkbox"
            @change="onShowAnchorInEditorChange"
          />
          <span class="pref-label">Show anchor data in editor</span>
        </label>
      </section>

      <section class="shortcuts-section">
        <h2 class="section-title">Keyboard shortcuts</h2>
        <div class="shortcut-row">
          <span class="pref-label">Toggle minimize notes</span>
          <kbd v-if="minimizeShortcut" class="shortcut-key">{{ minimizeShortcut }}</kbd>
          <span v-else class="shortcut-unset">Not set</span>
        </div>
        <a class="welcome-link" @click.prevent="openShortcutsPage">
          Customize shortcuts &rarr;
        </a>
      </section>

      <section class="link-section">
        <h2 class="section-title">Resources</h2>
        <a :href="helloMustardUrl" target="_blank" class="welcome-link">
          View Hello Mustard &amp; getting started guide
        </a>
        <a :href="bskyProfileUrl" target="_blank" class="welcome-link">
          @mustardnotes.com on Bluesky
        </a>
      </section>
    </div>
  </div>
</template>

<style scoped>
.options-page {
  padding: 32px;
  max-width: 600px;
  margin: 40px auto;
  border-radius: 16px;
  border: 3px solid var(--mustard-border);
}

.header {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 28px;
  padding-bottom: 20px;
  border-bottom: 2px solid var(--mustard-border-subtle);
}

.logo {
  width: 40px;
  height: 40px;
}

h1 {
  margin: 0;
  font-size: 1.5rem;
  font-weight: 600;
}

.version {
  font-size: 0.75rem;
  opacity: 0.5;
  align-self: flex-end;
  margin-bottom: 4px;
}

.content {
  display: flex;
  flex-direction: column;
  gap: 18px;
}

/* All sections share a glass-card treatment so each block reads as its
 * own grouping rather than blending into a single wall of text. */
.content > section {
  display: flex;
  flex-direction: column;
  gap: 14px;
  padding: 18px 20px;
  background: var(--mustard-glass);
  border: 1.5px solid var(--mustard-border-subtle);
  border-radius: 12px;
}

.section-title {
  margin: 0;
  padding-bottom: 10px;
  border-bottom: 1.5px solid var(--mustard-border-subtle);
  font-size: 0.7rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.12em;
  color: var(--mustard-border);
}

.section-desc {
  margin: 0;
  font-size: 0.875rem;
  opacity: 0.8;
  line-height: 1.5;
}

.kofi-btn {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  align-self: flex-start;
  padding: 0.625rem 1rem;
  font-size: 0.875rem;
  font-weight: 500;
  font-family: var(--mustard-font);
  color: var(--mustard-yellow-light);
  background-color: var(--mustard-border);
  border: 2px solid var(--mustard-border);
  border-radius: 8px;
  cursor: pointer;
  transition: background-color 0.15s;
}

.kofi-btn:hover {
  background-color: var(--mustard-brown-dark);
}

.kofi-icon {
  width: 18px;
  height: 18px;
  flex-shrink: 0;
}

.link-section {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.welcome-link {
  font-size: 0.875rem;
  font-weight: 500;
  color: var(--mustard-brown);
  text-decoration: underline;
  text-underline-offset: 3px;
  cursor: pointer;
}

.welcome-link:hover {
  color: var(--mustard-border);
}

.prefs-section {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.pref-row {
  display: flex;
  align-items: center;
  gap: 10px;
  cursor: pointer;
  width: fit-content;
}

.pref-checkbox {
  width: 16px;
  height: 16px;
  accent-color: var(--mustard-border);
  cursor: pointer;
}

.pref-label {
  font-size: 0.875rem;
}

.shortcut-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.shortcut-key {
  font-family: var(--mustard-font);
  font-size: 0.8rem;
  font-weight: 600;
  padding: 3px 10px;
  border-radius: 6px;
  border: 1.5px solid var(--mustard-border);
  background: var(--mustard-glass-strong);
  color: var(--mustard-text);
  /* Subtle keycap depth */
  box-shadow: 0 1.5px 0 var(--mustard-border);
}

.shortcut-unset {
  font-size: 0.8rem;
  opacity: 0.6;
  font-style: italic;
}
</style>
