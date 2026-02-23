<script setup lang="ts">
import { computed } from 'vue'
import ClickableEl from './ClickableEl.vue'

const xIconUrl = chrome.runtime.getURL('close_x_red_48.png')
const upvoteIconUrl = chrome.runtime.getURL('upvote_blue_48.png')
const eyeOpenIconUrl = chrome.runtime.getURL('eye_open_48.png')
const eyeClosedIconUrl = chrome.runtime.getURL('eye_closed_48.png')
const saveIconUrl = chrome.runtime.getURL('save_disk_48.png')
const trashIconUrl = chrome.runtime.getURL('delete_bin_48.png')
const publishIconUrl = chrome.runtime.getURL('publish_arrow_blue_48.png')
const publishedIconUrl = chrome.runtime.getURL('published_cloud_check_48.png')

const props = defineProps<{
  icon: 'x' | 'upvote' | 'eye-open' | 'eye-closed' | 'save' | 'trash' | 'publish' | 'published'
  disabled?: boolean
  /** If true, renders as a static indicator without hover/click styles */
  static?: boolean
}>()

const iconUrl = computed(() => {
  if (props.icon === 'x') {
    return xIconUrl
  } else if (props.icon === 'upvote') {
    return upvoteIconUrl
  } else if (props.icon === 'eye-open') {
    return eyeOpenIconUrl
  } else if (props.icon === 'eye-closed') {
    return eyeClosedIconUrl
  } else if (props.icon === 'save') {
    return saveIconUrl
  } else if (props.icon === 'trash') {
    return trashIconUrl
  } else if (props.icon === 'publish') {
    return publishIconUrl
  } else if (props.icon === 'published') {
    return publishedIconUrl
  }
  throw new Error(`Invalid icon: ${props.icon}`)
})
</script>

<template>
  <ClickableEl v-if="!static" style="padding: 4px" :class="{ 'icon-disabled': disabled }">
    <img :src="iconUrl" width="16" height="16" draggable="false" />
  </ClickableEl>
  <span v-else class="icon-static" style="padding: 4px">
    <img :src="iconUrl" width="16" height="16" draggable="false" />
  </span>
</template>

<style scoped>
.icon-disabled {
  opacity: 0.4;
  pointer-events: none;
}

.icon-static {
  display: inline-flex;
  cursor: default;
}
</style>
