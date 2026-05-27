<script setup lang="ts">
import { ref, watch, computed, onUnmounted, useTemplateRef } from 'vue'

type Gif = {
  id: string
  src: string
  preview: string
  title: string
}

type GiphyImage = {
  url: string
  width: string
  height: string
}

type GiphyGif = {
  id: string
  title: string
  images: {
    original: GiphyImage
    fixed_width: GiphyImage
  }
}

type GiphyResponse = {
  data: GiphyGif[]
}

const props = defineProps<{
  query: string
  clientRect: (() => DOMRect | null) | null | undefined
  onSelect: (gif: { src: string }) => void
}>()

const GIPHY_API_KEY = import.meta.env.VITE_GIPHY_API_KEY
const DEBOUNCE_MS = 250

const gifs = ref<Gif[]>([])
const loading = ref(false)
const errorMsg = ref<string | null>(null)
const selectedIndex = ref(0)
const gridRef = useTemplateRef<HTMLElement>('gridRef')

let abortController: AbortController | null = null
let debounceTimer: number | null = null

async function fetchGifs(term: string) {
  if (!GIPHY_API_KEY) {
    errorMsg.value = 'Set VITE_GIPHY_API_KEY in .env.* to enable Giphy'
    gifs.value = []
    return
  }

  abortController?.abort()
  abortController = new AbortController()
  loading.value = true
  errorMsg.value = null

  const params = new URLSearchParams({
    api_key: GIPHY_API_KEY,
    limit: '24',
    rating: 'pg-13',
    bundle: 'messaging_non_clips',
  })
  if (term) params.set('q', term)

  const endpoint = term ? 'search' : 'trending'
  const url = `https://api.giphy.com/v1/gifs/${endpoint}?${params.toString()}`

  try {
    const res = await fetch(url, { signal: abortController.signal })
    if (!res.ok) throw new Error(`Giphy API ${res.status}`)
    const data = (await res.json()) as GiphyResponse
    gifs.value = data.data.map((g) => ({
      id: g.id,
      src: g.images.original.url,
      preview: g.images.fixed_width.url,
      title: g.title,
    }))
    selectedIndex.value = 0
  } catch (e) {
    if ((e as Error).name === 'AbortError') return
    errorMsg.value = (e as Error).message
    gifs.value = []
  } finally {
    loading.value = false
  }
}

watch(
  () => props.query,
  (q) => {
    if (debounceTimer) clearTimeout(debounceTimer)
    debounceTimer = window.setTimeout(() => fetchGifs(q), DEBOUNCE_MS)
  },
  { immediate: true },
)

onUnmounted(() => {
  abortController?.abort()
  if (debounceTimer) clearTimeout(debounceTimer)
})

const position = computed(() => {
  const rect = props.clientRect?.()
  if (!rect) return { top: 0, left: 0 }
  return { top: rect.bottom + 6, left: rect.left }
})

function scrollSelectedIntoView() {
  const el = gridRef.value?.children[selectedIndex.value] as HTMLElement | undefined
  el?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
}

function onKeyDown(event: KeyboardEvent): boolean {
  if (!gifs.value.length) return false

  const max = gifs.value.length - 1
  let next = selectedIndex.value

  switch (event.key) {
    case 'ArrowRight':
      next = Math.min(selectedIndex.value + 1, max)
      break
    case 'ArrowLeft':
      next = Math.max(selectedIndex.value - 1, 0)
      break
    case 'ArrowDown':
      next = Math.min(selectedIndex.value + 3, max)
      break
    case 'ArrowUp':
      next = Math.max(selectedIndex.value - 3, 0)
      break
    case 'Enter':
      props.onSelect({ src: gifs.value[selectedIndex.value]!.src })
      return true
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
    class="mustard-giphy-picker mustard-notes-bg mustard-notes-border mustard-notes-txt"
    :style="{ top: position.top + 'px', left: position.left + 'px' }"
    @mousedown.prevent
  >
    <div class="picker-header">
      <span class="picker-title">/giphy</span>
      <span class="picker-query">{{ query || 'trending' }}</span>
      <span v-if="loading" class="picker-loading">…</span>
    </div>

    <div v-if="errorMsg" class="picker-message picker-error">{{ errorMsg }}</div>
    <div v-else-if="loading && !gifs.length" class="picker-message">Searching…</div>
    <div v-else-if="!gifs.length" class="picker-message">No results</div>
    <div v-else ref="gridRef" class="picker-grid">
      <button
        v-for="(gif, index) in gifs"
        :key="gif.id"
        type="button"
        class="picker-cell"
        :class="{ 'picker-cell-selected': index === selectedIndex }"
        :title="gif.title"
        @click="props.onSelect({ src: gif.src })"
        @mouseenter="selectedIndex = index"
        @mousedown.prevent
      >
        <img :src="gif.preview" :alt="gif.title" loading="lazy" referrerpolicy="no-referrer" />
      </button>
    </div>

    <div class="picker-footer">↑↓→← navigate · ↵ select</div>
  </div>
</template>

<style scoped>
/* 340px outer width leaves room for: 3px border each side + grid padding + scrollbar + gaps,
 * and lets the `minmax(0, 1fr)` columns below self-size so the grid never overflows. */
.mustard-giphy-picker {
  position: fixed;
  z-index: 2147483647;
  width: 340px;
  max-height: 380px;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  font-family: var(--mustard-font);
  box-sizing: border-box;
}

.mustard-giphy-picker *,
.mustard-giphy-picker *::before,
.mustard-giphy-picker *::after {
  box-sizing: border-box;
}

.picker-header {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 10px;
  font-size: 12px;
  border-bottom: 1px solid var(--mustard-border-subtle);
}

.picker-title {
  font-weight: 700;
}

.picker-query {
  flex: 1;
  opacity: 0.7;
  font-style: italic;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.picker-loading {
  opacity: 0.6;
}

.picker-message {
  padding: 18px 12px;
  text-align: center;
  font-size: 12px;
  opacity: 0.7;
}

.picker-error {
  color: #d32f2f;
  opacity: 1;
}

.picker-grid {
  display: grid;
  /* minmax(0, 1fr) lets columns shrink to fit available width regardless of
   * scrollbar width or border thickness — no overflow possible. */
  grid-template-columns: repeat(3, minmax(0, 1fr));
  grid-auto-rows: 100px;
  gap: 4px;
  padding: 6px;
  overflow-y: auto;
  overflow-x: hidden;
  flex: 1;
  min-width: 0;
  min-height: 0;
}

/* Defensively reset against host-page button styles (content scripts have no global reset). */
.picker-cell {
  width: 100%;
  height: 100%;
  margin: 0;
  padding: 0;
  font: inherit;
  color: inherit;
  border: 2px solid transparent;
  background: var(--mustard-glass);
  cursor: pointer;
  border-radius: 6px;
  overflow: hidden;
  display: block;
  min-width: 0;
  transition:
    transform 0.1s ease,
    box-shadow 0.1s ease;
}

.picker-cell-selected {
  transform: scale(1.18);
  box-shadow: 0 8px 18px rgba(0, 0, 0, 0.45);
  z-index: 1;
  position: relative;
}

.picker-cell img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
  pointer-events: none;
}

.picker-footer {
  padding: 4px 8px;
  font-size: 10px;
  opacity: 0.55;
  border-top: 1px solid var(--mustard-border-subtle);
  text-align: center;
  letter-spacing: 0.02em;
}
</style>
