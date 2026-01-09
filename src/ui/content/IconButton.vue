<script setup lang="ts">
import { computed } from 'vue'
import ClickableEl from './ClickableEl.vue'

const xIconUrl = chrome.runtime.getURL('close_x_red_48.png')
const upvoteIconUrl = chrome.runtime.getURL('upvote_blue_48.png')
const eyeOpenIconUrl = chrome.runtime.getURL('eye_open_48.png')
const eyeClosedIconUrl = chrome.runtime.getURL('eye_closed_48.png')
const saveIconUrl = chrome.runtime.getURL('save_disk_48.png')
const editIconUrl = chrome.runtime.getURL('edit_pen_48.png')
const trashIconUrl = chrome.runtime.getURL('delete_bin_48.png')

const props = defineProps<{
  icon: 'x' | 'upvote' | 'eye-open' | 'eye-closed' | 'save' | 'edit' | 'trash'
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
  } else if (props.icon === 'edit') {
    return editIconUrl
  } else if (props.icon === 'trash') {
    return trashIconUrl
  }
  throw new Error(`Invalid icon: ${props.icon}`)
})
</script>

<template>
  <ClickableEl style="padding: 4px">
    <img :src="iconUrl" width="16" height="16" draggable="false" />
  </ClickableEl>
</template>
