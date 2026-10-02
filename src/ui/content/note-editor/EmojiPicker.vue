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
const COLUMNS = 5
watch(
  () => props.items,
  () => {
    selectedIndex.value = 0
  },
)
const position = computed(() => {
  const rect = props.clientRect?.()
  const gutter = 8
  const width = Math.min(340, window.innerWidth - gutter * 2)
  const height = Math.min(320, window.innerHeight - gutter * 2)
  const left = Math.max(gutter, Math.min(rect?.left ?? gutter, window.innerWidth - width - gutter))
  const below = (rect?.bottom ?? gutter) + 6
  const above = (rect?.top ?? gutter) - height - 6
  const top =
    below + height <= window.innerHeight - gutter
      ? below
      : above >= gutter
        ? above
        : Math.max(gutter, window.innerHeight - height - gutter)
  return { top, left }
})

function onKeyDown(event: KeyboardEvent): boolean {
  if (!props.items.length) return false
  const step = {
    ArrowDown: COLUMNS,
    ArrowUp: -COLUMNS,
    ArrowRight: 1,
    ArrowLeft: -1,
  }[event.key]
  if (step !== undefined) {
    selectedIndex.value = Math.max(0, Math.min(props.items.length - 1, selectedIndex.value + step))
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
        <span class="emoji-glyph">{{ item.emoji }}</span>
        <span class="emoji-name">{{ item.names[0] }}</span>
      </button>
    </div>
    <div v-if="!items.length" class="emoji-empty">No matching emoji</div>
  </div>
</template>

<style scoped>
.mustard-emoji-picker {
  position: fixed;
  z-index: 2147483647;
  width: min(340px, calc(100vw - 16px));
  max-height: min(320px, calc(100vh - 16px));
  display: flex;
  flex-direction: column;
  overflow: hidden;
  font-family: var(--mustard-font);
}
.emoji-list {
  display: grid;
  grid-template-columns: repeat(5, minmax(0, 1fr));
  gap: 2px;
  overflow-y: auto;
  padding: 4px;
}
.emoji-list button {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 2px;
  width: 100%;
  min-width: 0;
  min-height: 54px;
  margin: 0;
  padding: 4px 2px;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: inherit;
  text-align: center;
  font: inherit;
  cursor: pointer;
}
.emoji-list button.selected {
  background: var(--mustard-glass-hover);
}
.emoji-glyph {
  font-size: 25px;
  line-height: 1.15;
}
.emoji-name {
  display: block;
  width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 9px;
  line-height: 1.2;
  opacity: 0.7;
}
.emoji-empty {
  padding: 12px;
  font-size: 12px;
}
</style>
