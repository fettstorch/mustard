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

import { ref, computed, onMounted } from 'vue'
import { version } from '../../../package.json'
import {
  MUSTARD_FONTS,
  MUSTARD_FONT_KEY,
  DEFAULT_FONT_ID,
  getFontById,
  ensureFontStylesheet,
  applyFontVar,
} from '@/shared/fonts'
import {
  MUSTARD_THEMES,
  MUSTARD_THEME_KEY,
  DEFAULT_THEME_ID,
  getThemeById,
  applyTheme,
} from '@/shared/themes'
import {
  sendMessage,
  createGetAtprotoSessionMessage,
  createGithubLoginMessage,
  createAtprotoLoginMessage,
  createDisconnectProviderMessage,
} from '@/shared/messaging'
import { getSupabaseJwt } from '@/background/auth/SupabaseAuth'
import type { LinkedIdentity, UserProfileType } from '@/shared/model/UserProfile'

const PUBLISH_CONFIRM_DISMISSED_KEY = 'mustard-publish-confirm-dismissed'
const NOTES_MINIMIZED_KEY = 'mustard-notes-minimized'
const SHOW_ANCHOR_IN_EDITOR_KEY = 'mustard-show-anchor-in-editor'
const ALT_CLICK_ENABLED_KEY = 'mustard-alt-click-enabled'

const logoUrl = browser.runtime.getURL('/mustard_bottle_smile_512.png')
const helloMustardUrl = 'https://fettstorch.github.io/mustard/'
const bskyProfileUrl = 'https://bsky.app/profile/mustardnotes.com'

const showPublishWarning = ref(true)
const minimizeNotes = ref(false)
const showAnchorInEditor = ref(false)
const altClickEnabled = ref(false)
const selectedFontId = ref<string>(DEFAULT_FONT_ID)
const selectedThemeId = ref<string>(DEFAULT_THEME_ID)

// Connected accounts state. The session message carries more (did/provider for
// legacy single-identity callers), but this page renders purely off the unified
// identity list, so it only declares what it actually reads.
type SessionInfo = {
  userId: string
  identities?: LinkedIdentity[]
}
const currentSession = ref<SessionInfo | null>(null)
const busyProvider = ref<string | null>(null) // provider with an in-flight connect/disconnect
const accountError = ref<string | null>(null)
const blueskyHandle = ref('') // input for "Connect Bluesky"
const showBlueskyConnect = ref(false)

// The providers Mustard can link, in display order.
const SUPPORTED_PROVIDERS: { id: UserProfileType; label: string }[] = [
  { id: 'atproto', label: 'Bluesky' },
  { id: 'github', label: 'GitHub' },
]

const linkedByProvider = computed<Record<string, LinkedIdentity | undefined>>(() => {
  const map: Record<string, LinkedIdentity> = {}
  for (const id of currentSession.value?.identities ?? []) map[id.provider] = id
  return map
})

const linkedCount = computed(() => currentSession.value?.identities?.length ?? 0)

const systemFonts = computed(() => MUSTARD_FONTS.filter((f) => f.category === 'system'))
const webFonts = computed(() => MUSTARD_FONTS.filter((f) => f.category === 'web'))
const minimizeShortcut = ref<string>('')
const popupShortcut = ref<string>('')
const shortcutsUrl = ref<string>('')
const isFirefoxBrowser = ref<boolean>(false)
const isMacPlatform = ref<boolean>(false)

onMounted(async () => {
  const result = await browser.storage.local.get([
    PUBLISH_CONFIRM_DISMISSED_KEY,
    NOTES_MINIMIZED_KEY,
    SHOW_ANCHOR_IN_EDITOR_KEY,
    ALT_CLICK_ENABLED_KEY,
    MUSTARD_FONT_KEY,
    MUSTARD_THEME_KEY,
  ])
  showPublishWarning.value = !result[PUBLISH_CONFIRM_DISMISSED_KEY]
  minimizeNotes.value = !!result[NOTES_MINIMIZED_KEY]
  showAnchorInEditor.value = !!result[SHOW_ANCHOR_IN_EDITOR_KEY]
  altClickEnabled.value = !!result[ALT_CLICK_ENABLED_KEY]
  selectedFontId.value = getFontById(result[MUSTARD_FONT_KEY] as string | undefined).id
  selectedThemeId.value = getThemeById(result[MUSTARD_THEME_KEY] as string | undefined).id

  // Read the live keybindings so they stay accurate after the user rebinds.
  // The popup command is `_execute_action` (Chrome MV3) or
  // `_execute_browser_action` (Firefox MV2) — check both.
  try {
    const commands = (await browser.commands?.getAll?.()) ?? []
    minimizeShortcut.value =
      commands.find((c) => c.name === 'toggle-minimize-notes')?.shortcut || ''
    popupShortcut.value =
      commands.find((c) => c.name === '_execute_action' || c.name === '_execute_browser_action')
        ?.shortcut || ''
  } catch {
    // commands API unavailable — leave shortcuts empty.
  }

  await refreshSession()

  // Chromium exposes chrome://extensions/shortcuts and allows extensions to
  // open it via tabs.create. Firefox blocks extensions from opening `about:`
  // URLs (only a small whitelist like about:blank is allowed), so we surface
  // navigation instructions instead of a clickable link there.
  const isFirefox =
    typeof (browser.runtime as { getBrowserInfo?: unknown }).getBrowserInfo === 'function'
  isFirefoxBrowser.value = isFirefox
  shortcutsUrl.value = isFirefox ? '' : 'chrome://extensions/shortcuts'
  // Pick the right modifier for the Firefox add-ons shortcut hint.
  isMacPlatform.value = /Mac/i.test(navigator.userAgent)
})

function openShortcutsPage() {
  if (!shortcutsUrl.value) return
  browser.tabs.create({ url: shortcutsUrl.value }).catch((err) => {
    console.warn('Could not open shortcuts page:', err)
  })
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

function onAltClickEnabledChange() {
  browser.storage.local.set({ [ALT_CLICK_ENABLED_KEY]: altClickEnabled.value })
}

function onFontChange() {
  const font = getFontById(selectedFontId.value)
  browser.storage.local.set({ [MUSTARD_FONT_KEY]: font.id })
  // Apply immediately for instant preview (also synced via storage.onChanged).
  ensureFontStylesheet(document, font)
  applyFontVar(document.documentElement, font)
}

function onThemeSelect(themeId: string) {
  selectedThemeId.value = themeId
  const theme = getThemeById(themeId)
  browser.storage.local.set({ [MUSTARD_THEME_KEY]: theme.id })
  applyTheme(document.documentElement, theme)
}

function openKofi() {
  window.open('https://ko-fi.com/fettstorch', '_blank')
}

async function refreshSession() {
  try {
    currentSession.value = (await sendMessage(createGetAtprotoSessionMessage())) ?? null
  } catch {
    // ignore — leave the previous value
  }
}

async function connectGithub() {
  busyProvider.value = 'github'
  accountError.value = null
  try {
    // These controls only appear for a logged-in account, so this is always a
    // LINK. Without the current JWT the auth-bridge would create a brand-new
    // account (or switch) instead of attaching to this one — abort and ask the
    // user to re-login rather than silently forking their identity.
    const jwt = await getSupabaseJwt()
    if (!jwt) {
      accountError.value = 'Your session has expired. Please log out and back in, then try again.'
      return
    }
    const result = await sendMessage(createGithubLoginMessage(jwt))
    if (!result) accountError.value = 'GitHub connection failed or was cancelled'
    else await refreshSession()
  } catch (e) {
    accountError.value = e instanceof Error ? e.message : 'Connection failed'
  } finally {
    busyProvider.value = null
  }
}

async function connectBluesky() {
  const handle = blueskyHandle.value.trim().replace(/^@/, '')
  if (!handle) return
  busyProvider.value = 'atproto'
  accountError.value = null
  try {
    // Always a LINK (shown only when logged in); abort without the current JWT
    // so we never fork the account. See connectGithub for the rationale.
    const jwt = await getSupabaseJwt()
    if (!jwt) {
      accountError.value = 'Your session has expired. Please log out and back in, then try again.'
      return
    }
    const result = await sendMessage(createAtprotoLoginMessage(handle, jwt))
    if (!result) {
      accountError.value = 'Bluesky connection failed or was cancelled'
    } else {
      showBlueskyConnect.value = false
      blueskyHandle.value = ''
      await refreshSession()
    }
  } catch (e) {
    accountError.value = e instanceof Error ? e.message : 'Connection failed'
  } finally {
    busyProvider.value = null
  }
}

async function disconnect(provider: string, label: string) {
  // Removing the last identity deletes the whole account + all its content.
  const isLast = linkedCount.value <= 1
  const message = isLast
    ? `Disconnecting ${label} is your last connected account. This will permanently delete your Mustard account and ALL your notes, comments and reposts. Continue?`
    : `Disconnect ${label} from your Mustard account?`
  if (!confirm(message)) return

  busyProvider.value = provider
  accountError.value = null
  try {
    const result = await sendMessage(createDisconnectProviderMessage(provider))
    if (!result) {
      accountError.value = 'Disconnect failed'
      return
    }
    await refreshSession()
  } catch (e) {
    accountError.value = e instanceof Error ? e.message : 'Disconnect failed'
  } finally {
    busyProvider.value = null
  }
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
        <h2 class="section-title">Connected Accounts</h2>
        <div v-if="!currentSession" class="pref-row">
          <span class="pref-label" style="opacity: 0.6">Not logged in</span>
        </div>
        <template v-else>
          <div v-for="p in SUPPORTED_PROVIDERS" :key="p.id" class="account-block">
            <div class="account-row">
              <span class="pref-label">
                {{ p.label }}
                <span v-if="linkedByProvider[p.id]?.handle" class="account-hint">
                  {{ linkedByProvider[p.id]?.handle }}
                </span>
              </span>

              <span v-if="linkedByProvider[p.id]" class="account-actions">
                <span class="account-badge connected">Connected</span>
                <button
                  class="disconnect-btn"
                  :disabled="busyProvider === p.id"
                  @click="disconnect(p.id, p.label)"
                >
                  {{ busyProvider === p.id ? '…' : 'Disconnect' }}
                </button>
              </span>

              <button
                v-else-if="p.id === 'github'"
                class="mustard-notes-btn-primary connect-btn"
                :disabled="busyProvider === 'github'"
                @click="connectGithub"
              >
                {{ busyProvider === 'github' ? 'Connecting…' : 'Connect GitHub' }}
              </button>

              <button
                v-else-if="p.id === 'atproto' && !showBlueskyConnect"
                class="mustard-notes-btn-primary connect-btn"
                @click="showBlueskyConnect = true"
              >
                Connect Bluesky
              </button>
            </div>

            <!-- Bluesky needs a handle, so the connect control is an inline form. -->
            <form
              v-if="p.id === 'atproto' && !linkedByProvider[p.id] && showBlueskyConnect"
              class="bsky-connect-form"
              @submit.prevent="connectBluesky"
            >
              <input
                v-model="blueskyHandle"
                type="text"
                class="bsky-handle-input"
                placeholder="you.bsky.social"
                :disabled="busyProvider === 'atproto'"
              />
              <button
                type="submit"
                class="mustard-notes-btn-primary connect-btn"
                :disabled="busyProvider === 'atproto' || !blueskyHandle.trim()"
              >
                {{ busyProvider === 'atproto' ? 'Connecting…' : 'Connect' }}
              </button>
              <button
                type="button"
                class="disconnect-btn"
                @click="((showBlueskyConnect = false), (blueskyHandle = ''))"
              >
                Cancel
              </button>
            </form>
          </div>

          <p v-if="accountError" class="connect-error">{{ accountError }}</p>
          <p class="pref-hint">
            Connect multiple services to one Mustard account — notes from people you follow on any
            connected service show up together. Disconnecting your last account deletes it.
          </p>
        </template>
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
        <div class="pref-row pref-row-stack">
          <label class="pref-row">
            <input
              v-model="altClickEnabled"
              type="checkbox"
              class="pref-checkbox"
              @change="onAltClickEnabledChange"
            />
            <span class="pref-label">Create note on {{ isMacPlatform ? '⌥' : 'Alt' }}+Click</span>
          </label>
          <span class="pref-hint">
            When on, holding {{ isMacPlatform ? 'Option (⌥)' : 'Alt' }} and clicking anywhere on a
            page creates a mustard note there. Off by default so it won't interfere with sites that
            use {{ isMacPlatform ? 'Option' : 'Alt' }}+Click.
          </span>
        </div>
        <div class="pref-row pref-row-stack">
          <span class="pref-label">Color theme</span>
          <div class="theme-swatches" role="radiogroup" aria-label="Color theme">
            <button
              v-for="theme in MUSTARD_THEMES"
              :key="theme.id"
              type="button"
              class="theme-chip"
              :class="{ 'theme-chip-active': selectedThemeId === theme.id }"
              :aria-checked="selectedThemeId === theme.id"
              role="radio"
              :title="theme.label"
              @click="onThemeSelect(theme.id)"
            >
              <span class="theme-swatch" :style="{ background: theme.swatch }" />
              <span class="theme-label">{{ theme.label }}</span>
            </button>
          </div>
        </div>
        <div class="pref-row pref-row-stack">
          <span class="pref-label">Text font</span>
          <select v-model="selectedFontId" class="pref-select" @change="onFontChange">
            <optgroup label="System (works on every site)">
              <option v-for="font in systemFonts" :key="font.id" :value="font.id">
                {{ font.label }}
              </option>
            </optgroup>
            <optgroup label="Web (may not load on some sites)">
              <option v-for="font in webFonts" :key="font.id" :value="font.id">
                {{ font.label }}
              </option>
            </optgroup>
          </select>
          <span class="pref-hint">
            Web fonts can be blocked by strict sites (e.g. GitHub) and fall back to a system font in
            on-page notes. System fonts always work.
          </span>
        </div>
      </section>

      <section class="shortcuts-section">
        <h2 class="section-title">Keyboard shortcuts</h2>
        <div class="shortcut-row">
          <span class="pref-label">Open Mustard popup</span>
          <kbd v-if="popupShortcut" class="shortcut-key">{{ popupShortcut }}</kbd>
          <span v-else class="shortcut-unset">Not set</span>
        </div>
        <div class="shortcut-row">
          <span class="pref-label">Toggle minimize notes</span>
          <kbd v-if="minimizeShortcut" class="shortcut-key">{{ minimizeShortcut }}</kbd>
          <span v-else class="shortcut-unset">Not set</span>
        </div>
        <a v-if="!isFirefoxBrowser" class="welcome-link" @click.prevent="openShortcutsPage">
          Customize shortcuts &rarr;
        </a>
        <p v-else class="shortcut-hint">
          To customize, open Firefox's application menu (☰) and choose
          <strong>Extensions and themes</strong> (or press
          <kbd class="shortcut-key">{{ isMacPlatform ? '⌘⇧A' : 'Ctrl+Shift+A' }}</kbd
          >). Then click the <strong>⚙</strong> icon in the <strong>top right</strong> and pick
          <strong>Manage Extension Shortcuts</strong>.
        </p>
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

.account-block {
  display: flex;
  flex-direction: column;
  gap: 8px;
  width: 100%;
}

.account-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  width: 100%;
}

.account-actions {
  display: flex;
  align-items: center;
  gap: 8px;
}

.account-badge {
  font-size: 0.75rem;
  font-weight: 600;
  padding: 0.2rem 0.5rem;
  border-radius: 99px;
  letter-spacing: 0.02em;
}

.disconnect-btn {
  font-size: 0.8125rem;
  font-weight: 500;
  font-family: var(--mustard-font);
  color: #b91c1c;
  background: transparent;
  border: 1.5px solid currentColor;
  border-radius: 8px;
  padding: 0.2rem 0.6rem;
  cursor: pointer;
  transition:
    background-color 0.15s,
    opacity 0.15s;
}

.disconnect-btn:hover:not(:disabled) {
  background: rgba(185, 28, 28, 0.08);
}

.disconnect-btn:disabled {
  opacity: 0.5;
  cursor: default;
}

.bsky-connect-form {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.bsky-handle-input {
  flex: 1;
  min-width: 160px;
  font-family: var(--mustard-font);
  font-size: 0.875rem;
  color: var(--mustard-text);
  padding: 6px 10px;
  border-radius: 8px;
  border: 1.5px solid var(--mustard-border);
  background: var(--mustard-glass-strong);
}

.account-badge.connected {
  background: var(--mustard-accent-muted, rgba(234, 179, 8, 0.15));
  color: var(--mustard-accent, #ca8a04);
}

.account-hint {
  font-size: 0.7rem;
  opacity: 0.55;
  margin-left: 0.4rem;
  font-family: monospace;
}

.connect-btn {
  padding: 0.25rem 0.75rem;
  font-size: 0.8125rem;
}

.connect-error {
  font-size: 0.8125rem;
  color: #b91c1c;
  font-weight: 500;
}

.pref-hint {
  font-size: 0.8rem;
  opacity: 0.6;
  line-height: 1.4;
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

.pref-row-stack {
  flex-direction: column;
  align-items: flex-start;
  gap: 8px;
  cursor: default;
  width: 100%;
}

.pref-select {
  font-family: var(--mustard-font);
  font-size: 0.875rem;
  color: var(--mustard-text);
  padding: 6px 10px;
  border-radius: 8px;
  border: 1.5px solid var(--mustard-border);
  background: var(--mustard-glass-strong);
  cursor: pointer;
  min-width: 220px;
}

.pref-hint {
  font-size: 0.75rem;
  line-height: 1.45;
  opacity: 0.7;
}

.theme-swatches {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  width: 100%;
}

.theme-chip {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  padding: 8px;
  border-radius: 10px;
  border: 2px solid var(--mustard-border-subtle);
  background: var(--mustard-glass);
  cursor: pointer;
  transition:
    border-color 0.15s,
    background-color 0.15s;
  min-width: 72px;
}

.theme-chip:hover {
  background: var(--mustard-glass-hover);
  border-color: var(--mustard-border);
}

.theme-chip-active {
  border-color: var(--mustard-border);
  background: var(--mustard-glass-strong);
  box-shadow: 0 0 0 1px var(--mustard-border);
}

.theme-swatch {
  display: block;
  width: 48px;
  height: 32px;
  border-radius: 6px;
  border: 1.5px solid var(--mustard-border-subtle);
  box-shadow: inset 0 1px 2px rgba(0, 0, 0, 0.1);
}

.theme-label {
  font-size: 0.7rem;
  font-weight: 500;
  color: var(--mustard-text);
  text-align: center;
  line-height: 1.2;
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

.shortcut-hint {
  margin: 0;
  font-size: 0.8rem;
  line-height: 1.5;
  opacity: 0.85;
}

.shortcut-hint .shortcut-key {
  /* Inline keycap inside the hint — match the row keycap style but smaller */
  font-size: 0.72rem;
  padding: 1px 6px;
  box-shadow: 0 1px 0 var(--mustard-border);
}
</style>
