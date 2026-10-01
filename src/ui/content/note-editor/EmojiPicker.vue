<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type { EmojiEntry } from '@/shared/emoji'

const props = defineProps<{
  items: EmojiEntry[]
  clientRect: (() => DOMRect | null) | null | undefined
  onSelect: (item: EmojiEntry) => void
}>()
const selectedIndex = ref(0)
const list = ref<HTMLElement | null>(null)
watch(
  () => props.items,
  () => {
    selectedIndex.value = 0
  },
)
const position = computed(() => {
  const rect = props.clientRect?.()
  return { top: (rect?.bottom ?? 0) + 6, left: rect?.left ?? 0 }
})

function onKeyDown(event: KeyboardEvent): boolean {
  if (!props.items.length) return false
  if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
    selectedIndex.value = Math.max(
      0,
      Math.min(props.items.length - 1, selectedIndex.value + (event.key === 'ArrowDown' ? 1 : -1)),
    )
    requestAnimationFrame(() =>
      list.value?.children[selectedIndex.value]?.scrollIntoView({ block: 'nearest' }),
    )
    return true
  }
  if (event.key === 'Enter' || event.key === 'Tab') {
    props.onSelect(props.items[selectedIndex.value]!)
    return true
  }
  return false
}
defineExpose({ onKeyDown })
</script>

<template>
  <div
    class="mustard-emoji-picker mustard-notes-bg mustard-notes-border mustard-notes-txt"
    role="listbox"
    :style="{ top: position.top + 'px', left: position.left + 'px' }"
    @mousedown.prevent
  >
    <div ref="list" class="emoji-list">
      <button
        v-for="(item, index) in items"
        :key="item.emoji"
        type="button"
        role="option"
        :aria-selected="index === selectedIndex"
        :class="{ selected: index === selectedIndex }"
        :title="item.names.map((name) => `:${name}:`).join(', ')"
        @mouseenter="selectedIndex = index"
        @mousedown.prevent
        @click="onSelect(item)"
      >
        <span>{{ item.emoji }}</span
        ><span>:{{ item.names[0] }}:</span>
      </button>
    </div>
    <div v-if="!items.length" class="emoji-empty">No matching emoji</div>
  </div>
</template>

<style scoped>
.mustard-emoji-picker {
  position: fixed;
  z-index: 2147483647;
  width: 230px;
  max-height: 240px;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  font-family: var(--mustard-font);
}
.emoji-list {
  overflow-y: auto;
  padding: 4px;
}
.emoji-list button {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  margin: 0;
  padding: 5px 6px;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: inherit;
  text-align: left;
  font: inherit;
  cursor: pointer;
}
.emoji-list button.selected {
  background: var(--mustard-glass-hover);
}
.emoji-list button span:first-child {
  font-size: 20px;
}
.emoji-empty {
  padding: 12px;
  font-size: 12px;
}
</style>
