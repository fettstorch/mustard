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
 * Method 3: Programmatically via chrome.runtime.openOptionsPage() API
 *
 * Note: This is different from the popup menu (MustardPopupMenu.vue) which opens
 * when clicking the extension icon. This is a full-page settings interface.
 */

const logoUrl = chrome.runtime.getURL('mustard_bottle_smile_512.png')
const welcomeUrl = chrome.runtime.getURL('src/ui/welcome/index.html')

function openKofi() {
  window.open('https://ko-fi.com/fettstorch', '_blank')
}
</script>

<template>
  <div class="options-page mustard-notes-bg mustard-notes-txt">
    <div class="header">
      <img :src="logoUrl" alt="Mustard" class="logo" />
      <h1>Mustard Options</h1>
    </div>

    <div class="content">
      <section class="support-section">
        <h2 class="section-title">Support Mustard</h2>
        <p class="section-desc">
          If you enjoy using Mustard, consider buying me a coffee to support development!
        </p>
        <button class="kofi-btn" @click="openKofi">
          <svg class="kofi-icon" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M5 11.5C5 9.567 6.567 8 8.5 8H16V11.5C16 14.538 13.538 17 10.5 17C7.462 17 5 14.538 5 11.5Z" fill="currentColor"/>
            <path d="M16 8H17.5C19.433 8 21 9.567 21 11.5C21 13.433 19.433 15 17.5 15H16V8Z" fill="currentColor"/>
          </svg>
          Buy me a coffee on Ko-fi
        </button>
      </section>

      <section class="link-section">
        <h2 class="section-title">Resources</h2>
        <a :href="welcomeUrl" target="_blank" class="welcome-link">
          View welcome page &amp; getting started guide
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
  margin-bottom: 32px;
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

.content {
  display: flex;
  flex-direction: column;
  gap: 24px;
}

.support-section {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.section-title {
  margin: 0;
  font-size: 1rem;
  font-weight: 600;
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
</style>
