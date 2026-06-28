<script setup lang="ts">
/**
 * "Mentions" section in the popup.
 *
 * Lists the current user's unread @-mentions (in notes or comments). Only
 * rendered when there's at least one unread mention. Clicking a row opens the
 * page where the mention lives and marks that single mention seen.
 */
import { onMounted, ref } from 'vue'
import {
  createGetMyMentionsMessage,
  createMarkMentionSeenMessage,
  sendMessage,
} from '@/shared/messaging'
import type { DtoMustardMention } from '@/shared/dto/DtoMustardMention'
import { useNotificationsChanged } from './use-notifications-changed'
import { openPageFocused } from './open-page-focused'
import { displayUrl } from './display-url'

const props = defineProps<{
  /** When true, skip remote mark-seen writes (client is below min version). */
  isOutdated?: boolean
}>()

const mentions = ref<DtoMustardMention[]>([])

async function refresh() {
  try {
    const data = await sendMessage(createGetMyMentionsMessage())
    mentions.value = data ?? []
  } catch (err) {
    console.error('MentionsSection.refresh failed:', err)
    mentions.value = []
  }
}

onMounted(refresh)
useNotificationsChanged(refresh)

function actorLabel(m: DtoMustardMention): string {
  if (m.actorHandle) return `@${m.actorHandle}`
  if (m.actorDisplayName) return m.actorDisplayName
  return 'Someone'
}

async function openMention(m: DtoMustardMention) {
  if (!props.isOutdated) {
    // Optimistically remove from the list and mark seen.
    mentions.value = mentions.value.filter((x) => x.id !== m.id)
    sendMessage(createMarkMentionSeenMessage(m.id)).catch(() => {})
  }
  await openPageFocused(m.pageUrl, m.noteId)
}
</script>

<template>
  <div v-if="mentions.length > 0" class="mentions-section">
    <div class="mentions-header">
      <span class="mentions-title">
        Mentions
        <span class="mentions-unread-pill">{{ mentions.length }}</span>
      </span>
    </div>

    <div class="mentions-list">
      <button
        v-for="m in mentions"
        :key="m.id"
        type="button"
        class="mentions-row"
        :title="m.pageUrl"
        @click="openMention(m)"
      >
        <img
          v-if="m.actorAvatarUrl"
          :src="m.actorAvatarUrl"
          alt=""
          class="mentions-avatar"
          referrerpolicy="no-referrer"
        />
        <div v-else class="mentions-avatar mentions-avatar-placeholder" />
        <span class="mentions-body">
          <span class="mentions-line">
            <span class="mentions-actor">{{ actorLabel(m) }}</span>
            mentioned you in a {{ m.source }}
          </span>
          <span v-if="m.snippet" class="mentions-snippet">{{ m.snippet }}</span>
          <span class="mentions-url">{{ displayUrl(m.pageUrl) }}</span>
        </span>
      </button>
    </div>
  </div>
</template>

<style scoped>
.mentions-section {
  margin-bottom: 0.75rem;
  border-bottom: 1px solid var(--mustard-border-subtle);
  padding-bottom: 0.5rem;
}

.mentions-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0.5rem 0;
  font-size: 0.875rem;
  font-weight: 500;
}

.mentions-title {
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
}

.mentions-unread-pill {
  display: inline-flex;
  align-items: center;
  padding: 1px 6px;
  font-size: 0.65rem;
  font-weight: 600;
  border-radius: 999px;
  background: #d32f2f;
  color: #fff;
}

.mentions-list {
  display: flex;
  flex-direction: column;
  gap: 2px;
  max-height: 280px;
  overflow-y: auto;
  overflow-x: hidden;
  margin-top: 4px;
  scrollbar-gutter: stable;
}

.mentions-row {
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

.mentions-row:hover {
  background: var(--mustard-glass-hover);
}

.mentions-avatar {
  width: 28px;
  height: 28px;
  border-radius: 50%;
  object-fit: cover;
  flex-shrink: 0;
}

.mentions-avatar-placeholder {
  background: rgba(128, 128, 128, 0.3);
}

.mentions-body {
  display: flex;
  flex-direction: column;
  min-width: 0;
  gap: 1px;
}

.mentions-line {
  line-height: 1.3;
}

.mentions-actor {
  font-weight: 600;
}

.mentions-snippet {
  opacity: 0.75;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.mentions-url {
  opacity: 0.5;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
