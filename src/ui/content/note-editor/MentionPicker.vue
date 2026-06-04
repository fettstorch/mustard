<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type { BskyProfile } from '@/shared/model/BskyProfile'

const props = defineProps<{
  items: BskyProfile[]
  query: string
  clientRect: (() => DOMRect | null) | null | undefined
  onSelect: (profile: BskyProfile) => void
}>()

const selectedIndex = ref(0)
const listRef = ref<HTMLElement | null>(null)

// Reset highlight to the top whenever the result set changes.
watch(
  () => props.items,
  () => {
    selectedIndex.value = 0
  },
)

const position = computed(() => {
  const rect = props.clientRect?.()
  if (!rect) return { top: 0, left: 0 }
  return { top: rect.bottom + 6, left: rect.left }
})

function scrollSelectedIntoView() {
  const el = listRef.value?.children[selectedIndex.value] as HTMLElement | undefined
  el?.scrollIntoView({ block: 'nearest' })
}

function onKeyDown(event: KeyboardEvent): boolean {
  if (!props.items.length) return false

  const max = props.items.length - 1
  let next = selectedIndex.value

  switch (event.key) {
    case 'ArrowDown':
      next = Math.min(selectedIndex.value + 1, max)
      break
    case 'ArrowUp':
      next = Math.max(selectedIndex.value - 1, 0)
      break
    case 'Enter':
    case 'Tab': {
      const item = props.items[selectedIndex.value]
      if (item) props.onSelect(item)
      return true
    }
    default:
      return false
  }

  if (next !== selectedIndex.value) {
    selectedIndex.value = next
    requestAnimationFrame(scrollSelectedIntoView)
  }
  return true
}

defineExpose({ onKeyDown })
</script>

<template>
  <div
    class="mustard-mention-picker mustard-notes-bg mustard-notes-border mustard-notes-txt"
    :style="{ top: position.top + 'px', left: position.left + 'px' }"
    @mousedown.prevent
  >
    <div v-if="!items.length" class="mention-empty">
      <span class="mention-empty-title">
        {{ query ? `No mutual matches “${query}”` : 'No mutuals to mention' }}
      </span>
      <span class="mention-empty-hint">
        You can only mention mutuals — people you follow who also follow you.
      </span>
    </div>
    <template v-else>
      <div ref="listRef" class="mention-list">
        <button
          v-for="(item, index) in items"
          :key="item.id"
          type="button"
          class="mention-row"
          :class="{ 'mention-row-selected': index === selectedIndex }"
          :title="'@' + item.handle"
          @click="props.onSelect(item)"
          @mouseenter="selectedIndex = index"
          @mousedown.prevent
        >
          <img
            v-if="item.avatarUrl"
            class="mention-avatar"
            :src="item.avatarUrl"
            :alt="item.displayName"
            referrerpolicy="no-referrer"
            draggable="false"
          />
          <div v-else class="mention-avatar mention-avatar-placeholder" />
          <span class="mention-names">
            <span class="mention-display">{{ item.displayName }}</span>
            <span class="mention-handle">@{{ item.handle }}</span>
          </span>
        </button>
      </div>
      <div class="mention-footer">Mutuals only</div>
    </template>
  </div>
</template>

<style scoped>
.mustard-mention-picker {
  position: fixed;
  z-index: 2147483647;
  width: 240px;
  max-height: 240px;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  font-family: var(--mustard-font);
  box-sizing: border-box;
}

.mustard-mention-picker *,
.mustard-mention-picker *::before,
.mustard-mention-picker *::after {
  box-sizing: border-box;
}

.mention-empty {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 12px;
  text-align: center;
}

.mention-empty-title {
  font-size: 12px;
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.mention-empty-hint {
  font-size: 11px;
  line-height: 1.3;
  opacity: 0.6;
}

.mention-footer {
  flex-shrink: 0;
  padding: 5px 8px;
  font-size: 10px;
  letter-spacing: 0.02em;
  text-transform: uppercase;
  opacity: 0.5;
  border-top: 1px solid var(--mustard-border-subtle, rgba(128, 128, 128, 0.2));
}

.mention-list {
  display: flex;
  flex-direction: column;
  padding: 4px;
  gap: 2px;
  overflow-y: auto;
  min-height: 0;
}

/* Reset against host-page button styles (content scripts have no global reset). */
.mention-row {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  margin: 0;
  padding: 5px 6px;
  font: inherit;
  color: inherit;
  text-align: left;
  border: none;
  background: transparent;
  border-radius: 6px;
  cursor: pointer;
}

.mention-row-selected {
  background: var(--mustard-glass-hover);
}

.mention-avatar {
  width: 24px;
  height: 24px;
  border-radius: 50%;
  object-fit: cover;
  flex-shrink: 0;
}

.mention-avatar-placeholder {
  background: rgba(128, 128, 128, 0.3);
}

.mention-names {
  display: flex;
  flex-direction: column;
  min-width: 0;
  line-height: 1.2;
}

.mention-display {
  font-size: 12px;
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.mention-handle {
  font-size: 11px;
  opacity: 0.6;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
