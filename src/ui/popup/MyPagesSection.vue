<script setup lang="ts">
/**
 * "My Pages" section in the popup.
 *
 * Lists every page where the logged-in user has published notes. Pages with
 * unread comment notifications float to the top (sorted by unread count desc),
 * remaining pages sort by most-recently-updated note desc.
 *
 * The section is collapsible (click the header to expand/collapse).
 * Clicking a page row opens that URL in a new tab.
 */
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { createGetMyPagesOverviewMessage } from '@/shared/messaging'
import type { DtoMyPagesOverview } from '@/shared/dto/DtoMyPagesOverview'

const overview = ref<DtoMyPagesOverview>([])
const isExpanded = ref(false)
const isLoading = ref(false)

const totalUnread = computed(() =>
  overview.value.reduce((sum, entry) => sum + entry.unreadCount, 0),
)

async function refresh() {
  isLoading.value = true
  try {
    const data = (await browser.runtime.sendMessage(
      createGetMyPagesOverviewMessage(),
    )) as DtoMyPagesOverview | null
    overview.value = data ?? []
  } catch (err) {
    console.error('MyPagesSection.refresh failed:', err)
    overview.value = []
  } finally {
    isLoading.value = false
  }
}

function onNotificationsChanged(message: unknown) {
  if (
    typeof message === 'object' &&
    message !== null &&
    (message as { type?: string }).type === 'NOTIFICATIONS_CHANGED'
  ) {
    refresh()
  }
}

onMounted(() => {
  refresh()
  browser.runtime.onMessage.addListener(onNotificationsChanged)
  // Auto-expand if there are unread items so the user spots them immediately.
  // We can only know after the first refresh; a brief watch handles it.
})

onUnmounted(() => {
  browser.runtime.onMessage.removeListener(onNotificationsChanged)
})

function openPage(pageUrl: string) {
  browser.tabs.create({ url: pageUrl, active: true }).catch(() => {})
}

function displayUrl(pageUrl: string): string {
  try {
    const u = new URL(pageUrl)
    const path = u.pathname === '/' ? '' : u.pathname
    return `${u.host}${path}`
  } catch {
    return pageUrl
  }
}

function toggle() {
  isExpanded.value = !isExpanded.value
}
</script>

<template>
  <div class="my-pages-section">
    <button
      type="button"
      class="my-pages-header"
      :title="isExpanded ? 'Collapse' : 'Expand'"
      @click="toggle"
    >
      <span class="my-pages-title">
        My Mustard Notes
        <span v-if="totalUnread > 0" class="my-pages-unread-pill"> {{ totalUnread }} unread </span>
      </span>
      <span class="my-pages-chevron" :class="{ 'is-open': isExpanded }">›</span>
    </button>

    <div v-if="isExpanded" class="my-pages-list">
      <div v-if="isLoading && overview.length === 0" class="my-pages-status">Loading…</div>
      <div v-else-if="overview.length === 0" class="my-pages-status">
        You haven't published any notes yet.
      </div>
      <button
        v-for="entry in overview"
        :key="entry.pageUrl"
        type="button"
        class="my-pages-row"
        :class="{ 'has-unread': entry.unreadCount > 0 }"
        :title="entry.pageUrl"
        @click="openPage(entry.pageUrl)"
      >
        <span
          v-if="entry.unreadCount > 0"
          class="my-pages-badge"
          :title="`${entry.unreadCount} unread`"
        >
          {{ entry.unreadCount }}
        </span>
        <span class="my-pages-url">{{ displayUrl(entry.pageUrl) }}</span>
      </button>
    </div>
  </div>
</template>

<style scoped>
.my-pages-section {
  margin-bottom: 0.75rem;
  border-bottom: 1px solid var(--mustard-border-subtle);
  padding-bottom: 0.5rem;
}

.my-pages-header {
  display: flex;
  width: 100%;
  align-items: center;
  justify-content: space-between;
  padding: 0.5rem 0;
  background: none;
  border: none;
  color: var(--mustard-text);
  font-family: var(--mustard-font);
  font-size: 0.875rem;
  font-weight: 500;
  cursor: pointer;
}

.my-pages-title {
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
}

.my-pages-unread-pill {
  display: inline-flex;
  align-items: center;
  padding: 1px 6px;
  font-size: 0.65rem;
  font-weight: 600;
  border-radius: 999px;
  background: #d32f2f;
  color: #fff;
}

.my-pages-chevron {
  font-size: 1rem;
  transition: transform 0.15s ease;
}

.my-pages-chevron.is-open {
  transform: rotate(90deg);
}

.my-pages-list {
  display: flex;
  flex-direction: column;
  gap: 2px;
  /* Generous cap so users see a lot at a glance, then scroll for the rest.
     If the total popup exceeds the browser's popup ceiling, the popup body
     still scrolls (its scrollbars are hidden in MustardPopupMenu) so the
     logout button further down stays reachable. */
  max-height: 420px;
  overflow-y: auto;
  /* Without explicit overflow-x, the spec coerces it to auto, which yields a
     horizontal scrollbar on subpixel rounding. Force it off. */
  overflow-x: hidden;
  margin-top: 4px;
  /* Reserve room for the scrollbar so rows don't shift when it appears. */
  scrollbar-gutter: stable;
  /* Scrollbar appearance comes from the global Mustard rules in
     src/styles/mustard-notes.css (scoped to .mustard-popup descendants). */
}

.my-pages-status {
  font-size: 0.75rem;
  opacity: 0.7;
  padding: 0.25rem 0.5rem;
}

.my-pages-row {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 8px;
  background: var(--mustard-glass);
  border: 1px solid var(--mustard-border-subtle);
  border-radius: 6px;
  color: var(--mustard-text);
  font-family: var(--mustard-font);
  font-size: 0.75rem;
  cursor: pointer;
  text-align: left;
  transition: background 0.15s ease;
}

.my-pages-row:hover {
  background: var(--mustard-glass-hover);
}

.my-pages-row.has-unread {
  border-color: #d32f2f;
}

.my-pages-badge {
  flex-shrink: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 18px;
  height: 18px;
  padding: 0 5px;
  font-size: 0.65rem;
  font-weight: 600;
  border-radius: 999px;
  background: #d32f2f;
  color: #fff;
}

.my-pages-url {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
