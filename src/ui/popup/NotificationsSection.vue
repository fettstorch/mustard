<script setup lang="ts">
/**
 * Existing notification section in the popup.
 *
 * Lists every unread notification. Clicking a row opens the associated note
 * and marks that notification seen.
 */
import { onMounted, ref } from 'vue'
import {
  createGetMyNotificationsMessage,
  createMarkNotificationSeenMessage,
  sendMessage,
} from '@/shared/messaging'
import type { DtoMustardNotification } from '@/shared/dto/DtoMustardMention'
import { useNotificationsChanged } from './use-notifications-changed'
import { openPageFocused } from './open-page-focused'
import { displayUrl } from '@/shared/display-url'

const props = defineProps<{
  /** When true, skip remote mark-seen writes (client is below min version). */
  isOutdated?: boolean
}>()

const notifications = ref<DtoMustardNotification[]>([])

async function refresh() {
  try {
    const data = await sendMessage(createGetMyNotificationsMessage())
    notifications.value = data ?? []
  } catch (err) {
    console.error('NotificationsSection.refresh failed:', err)
    notifications.value = []
  }
}

onMounted(refresh)
useNotificationsChanged(refresh)

function actorLabel(m: DtoMustardNotification): string {
  if (m.actorHandle) return `@${m.actorHandle}`
  if (m.actorDisplayName) return m.actorDisplayName
  return 'Someone'
}

function actionLabel(notification: DtoMustardNotification): string {
  if (notification.type === 'mention') return `mentioned you in a ${notification.source}`
  if (notification.type === 'comment') return 'added a comment'
  return 'added a note you subscribed to'
}

async function openNotification(m: DtoMustardNotification) {
  if (!props.isOutdated) {
    // Optimistically remove from the list and mark seen.
    notifications.value = notifications.value.filter((x) => x.id !== m.id)
    sendMessage(createMarkNotificationSeenMessage(m.id)).catch(() => {})
  }
  await openPageFocused(m.pageUrl, m.noteId)
}
</script>

<template>
  <div v-if="notifications.length > 0" class="notifications-section popup-section">
    <div class="notifications-header popup-section-header">
      <span class="notifications-title popup-section-title">
        Notifications
        <span class="notifications-unread-pill">{{ notifications.length }}</span>
      </span>
    </div>

    <div class="notifications-list">
      <button
        v-for="m in notifications"
        :key="m.id"
        type="button"
        class="notifications-row"
        :title="m.pageUrl"
        @click="openNotification(m)"
      >
        <img
          v-if="m.actorAvatarUrl"
          :src="m.actorAvatarUrl"
          alt=""
          class="notifications-avatar"
          referrerpolicy="no-referrer"
        />
        <div v-else class="notifications-avatar notifications-avatar-placeholder" />
        <span class="notifications-body">
          <span class="notifications-line">
            <span class="notifications-actor">{{ actorLabel(m) }}</span>
            {{ actionLabel(m) }}
          </span>
          <span v-if="m.snippet" class="notifications-snippet">{{ m.snippet }}</span>
          <span class="notifications-url">{{ displayUrl(m.pageUrl) }}</span>
        </span>
      </button>
    </div>
  </div>
</template>

<style scoped>
.notifications-section {
  min-width: 0;
}

.notifications-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: 0.875rem;
  font-weight: 500;
}

.notifications-title {
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
}

.notifications-unread-pill {
  display: inline-flex;
  align-items: center;
  padding: 1px 6px;
  font-size: 0.65rem;
  font-weight: 600;
  border-radius: 999px;
  background: #d32f2f;
  color: #fff;
}

.notifications-list {
  display: flex;
  flex-direction: column;
  gap: 2px;
  max-height: 280px;
  overflow-y: auto;
  overflow-x: hidden;
  margin-top: 4px;
  scrollbar-gutter: stable;
}

.notifications-row {
  display: flex;
  align-items: flex-start;
  gap: 8px;
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

.notifications-row:hover {
  background: var(--mustard-glass-hover);
}

.notifications-avatar {
  width: 28px;
  height: 28px;
  border-radius: 50%;
  object-fit: cover;
  flex-shrink: 0;
}

.notifications-avatar-placeholder {
  background: rgba(128, 128, 128, 0.3);
}

.notifications-body {
  display: flex;
  flex-direction: column;
  min-width: 0;
  gap: 1px;
}

.notifications-line {
  line-height: 1.3;
}

.notifications-actor {
  font-weight: 600;
}

.notifications-snippet {
  opacity: 0.75;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.notifications-url {
  opacity: 0.5;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
