<script setup lang="ts">
/**
 * MustardPopupMenu Component
 *
 * Purpose:
 * This is the main popup menu that appears when users click the Mustard extension icon
 * in the Chrome toolbar. It provides controls for managing mustard on the current webpage.
 *
 * How to access in Chrome:
 * 1. Click the Mustard extension icon in the Chrome toolbar (next to address bar)
 * 2. The popup will open below/above the icon
 */

function openOptions() {
  chrome.runtime.openOptionsPage()
}

const gearIconUrl = chrome.runtime.getURL('gear_128.png')
</script>

<template>
  <div class="popup-container">
    <div class="header">
      <h1>Mustard</h1>
      <button @click="openOptions" class="gear-button" title="Options">
        <img :src="gearIconUrl" alt="Settings" class="gear-icon" />
      </button>
    </div>
    <p>Mustard popup menu is working!</p>
  </div>
</template>

<style scoped>
.popup-container {
  width: 300px;
  padding: 16px;
}

.header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 16px;
}

h1 {
  margin: 0;
  font-size: 20px;
  font-weight: 600;
}

.gear-button {
  background: none;
  border: none;
  padding: 4px;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 4px;
  transition: background-color 0.2s;
}

.gear-button:hover {
  background-color: #f0f0f0;
}

.gear-button:active {
  background-color: #e0e0e0;
}

.gear-icon {
  width: 20px;
  height: 20px;
  display: block;
}

p {
  margin: 0;
  color: #666;
  font-size: 14px;
}
</style>
