<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, useTemplateRef, watch } from 'vue'
import type { LinkPreview } from '@/shared/model/LinkPreview'
import { normalizeHttpUrl } from '@/shared/link-preview'
import { createGetLinkPreviewImageMessage, sendMessage } from '@/shared/messaging'

const props = defineProps<{ preview: LinkPreview; dismissible?: boolean }>()
const emit = defineEmits<{ (event: 'dismiss'): void }>()
const cardRef = useTemplateRef<HTMLElement>('cardRef')
const imageDataUrl = ref(props.preview.imageDataUrl)
let isVisible = false
let imageRequestId = 0
let observer: IntersectionObserver | undefined

const href = computed(() => normalizeHttpUrl(props.preview.url) ?? '#')
const domain = computed(() => {
  try {
    return new URL(href.value).hostname.replace(/^www\./, '')
  } catch {
    return 'Link'
  }
})

async function loadThumbnail() {
  const path = props.preview.thumbnailPath
  if (!isVisible || !path || imageDataUrl.value) return
  const requestId = ++imageRequestId
  try {
    const dataUrl = await sendMessage(createGetLinkPreviewImageMessage(path))
    if (requestId === imageRequestId && path === props.preview.thumbnailPath) {
      imageDataUrl.value = dataUrl
    }
  } catch (error) {
    console.debug('mustard [link-preview] thumbnail load failed:', error)
  }
}

watch(
  () => [props.preview.thumbnailPath, props.preview.imageDataUrl] as const,
  ([thumbnailPath, suppliedDataUrl]) => {
    imageRequestId++
    imageDataUrl.value = suppliedDataUrl
    if (thumbnailPath) void loadThumbnail()
  },
)

onMounted(() => {
  const card = cardRef.value
  if (!card || typeof IntersectionObserver === 'undefined') {
    isVisible = true
    void loadThumbnail()
    return
  }
  observer = new IntersectionObserver((entries) => {
    if (!entries.some((entry) => entry.isIntersecting)) return
    isVisible = true
    observer?.disconnect()
    void loadThumbnail()
  })
  observer.observe(card)
})

onUnmounted(() => {
  imageRequestId++
  observer?.disconnect()
})
</script>

<template>
  <span class="mustard-link-preview-shell" :class="{ dismissible }">
    <a
      ref="cardRef"
      class="mustard-link-preview"
      :class="{ 'mustard-link-preview--with-image': imageDataUrl }"
      :href="href"
      target="_blank"
      rel="noopener noreferrer"
      :title="`Open ${domain}`"
      @mousedown.stop
    >
      <img
        v-if="imageDataUrl"
        class="mustard-link-preview-image"
        :src="imageDataUrl"
        alt=""
        draggable="false"
        @dragstart.prevent
      />
      <span
        class="mustard-link-preview-copy"
        :class="{
          'mustard-link-preview-copy--title-only': preview.title && !preview.description,
          'mustard-link-preview-copy--description-only': !preview.title && preview.description,
        }"
      >
        <span v-if="preview.title" class="mustard-link-preview-title">{{ preview.title }}</span>
        <span v-if="preview.description" class="mustard-link-preview-description">
          {{ preview.description }}
        </span>
      </span>
    </a>
    <button
      v-if="dismissible"
      type="button"
      class="mustard-link-preview-dismiss"
      title="Remove link preview"
      aria-label="Remove link preview"
      @mousedown.stop.prevent
      @click.stop.prevent="emit('dismiss')"
    >
      ×
    </button>
  </span>
</template>

<style scoped>
.mustard-link-preview-shell {
  position: relative;
  display: block;
  width: min(100%, var(--mustard-note-content-max-width));
  max-width: var(--mustard-note-content-max-width);
}

.mustard-link-preview {
  display: flex;
  width: 100%;
  margin-top: 8px;
  overflow: hidden;
  color: inherit !important;
  text-decoration: none !important;
  border-radius: 7px;
  background: var(--mustard-glass-strong);
  cursor: pointer;
}

.mustard-link-preview:hover {
  background: var(--mustard-glass-strong);
}

.mustard-link-preview--with-image {
  height: 72px;
}

.mustard-link-preview-image {
  flex: 0 0 72px;
  width: 72px;
  height: 72px;
  object-fit: cover;
  border: 0;
}

.mustard-link-preview-copy {
  display: flex;
  flex: 1;
  flex-direction: column;
  justify-content: center;
  min-width: 0;
  overflow: hidden;
  gap: 2px;
  padding: 5px 8px;
}

.dismissible .mustard-link-preview-copy {
  padding-right: 28px;
}

.mustard-link-preview-dismiss {
  all: unset;
  position: absolute;
  z-index: 1;
  top: 4px;
  right: 4px;
  box-sizing: border-box;
  display: grid;
  width: 17px;
  height: 17px;
  color: inherit;
  font-family: system-ui, sans-serif;
  font-size: 15px;
  font-weight: 600;
  line-height: 1;
  cursor: pointer;
  opacity: 0.55;
  place-items: center;
  border-radius: 50%;
  background: var(--mustard-glass-strong);
}

.mustard-link-preview-dismiss:hover,
.mustard-link-preview-dismiss:focus-visible {
  opacity: 1;
  outline: 1px solid var(--mustard-border-faded);
}

.mustard-link-preview-title {
  display: -webkit-box;
  overflow: hidden;
  color: inherit;
  font-size: 0.7em;
  font-weight: 700;
  line-height: 1.25;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
}

.mustard-link-preview-description {
  display: -webkit-box;
  overflow: hidden;
  font-size: 0.7em;
  line-height: 1.25;
  opacity: 0.8;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
}

.mustard-link-preview-copy--title-only .mustard-link-preview-title,
.mustard-link-preview-copy--description-only .mustard-link-preview-description {
  -webkit-line-clamp: 4;
}
</style>
