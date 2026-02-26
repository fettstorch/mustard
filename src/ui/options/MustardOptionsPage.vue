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

const gearIconUrl = chrome.runtime.getURL('gear_128.png')
</script>

<template>
  <div class="options-page">
    <div class="header">
      <img :src="gearIconUrl" alt="Settings" class="gear-icon" />
      <h1>Mustard Options</h1>
    </div>

    <div class="content">
      <p class="working-text">Mustard options page is working!</p>
    </div>
  </div>
</template>

<style scoped>
.options-page {
  padding: 24px;
  max-width: 600px;
  margin: 0 auto;
}

.header {
  display: flex;
  align-items: center;
  gap: 16px;
  margin-bottom: 32px;
}

.gear-icon {
  width: 48px;
  height: 48px;
}

h1 {
  margin: 0;
  font-size: 24px;
  font-weight: 600;
}

.content {
  display: flex;
  flex-direction: column;
  gap: 24px;
}

.working-text {
  color: #666;
  font-size: 14px;
  margin: 0;
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
