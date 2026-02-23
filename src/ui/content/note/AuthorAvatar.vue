<script setup lang="ts">
import { computed } from 'vue'
import type { UserProfile } from '@/shared/model/UserProfile'

const props = defineProps<{
  profile: UserProfile | null
}>()

const profileUrl = computed(() => {
  if (!props.profile?.handle) return null
  return `https://bsky.app/profile/${props.profile.handle}`
})
</script>

<template>
  <a
    v-if="profileUrl"
    :href="profileUrl"
    target="_blank"
    rel="noopener noreferrer"
    class="author-avatar"
    :title="profile?.displayName ?? 'Loading...'"
    @mousedown.stop
  >
    <img
      v-if="profile?.avatarUrl"
      :src="profile.avatarUrl"
      :alt="profile.displayName"
      class="avatar-image"
      draggable="false"
    />
    <div v-else class="avatar-placeholder" />
  </a>
  <div v-else class="author-avatar" :title="profile?.displayName ?? 'Loading...'">
    <img
      v-if="profile?.avatarUrl"
      :src="profile.avatarUrl"
      :alt="profile.displayName"
      class="avatar-image"
      draggable="false"
    />
    <div v-else class="avatar-placeholder" />
  </div>
</template>

<style scoped>
.author-avatar {
  display: block;
  width: 24px;
  height: 24px;
  flex-shrink: 0;
  cursor: pointer;
}

.avatar-image {
  width: 100%;
  height: 100%;
  border-radius: 50%;
  object-fit: cover;
  transition: opacity 0.15s ease;
}

.author-avatar:hover .avatar-image {
  opacity: 0.8;
}

.avatar-placeholder {
  width: 100%;
  height: 100%;
  border-radius: 50%;
  background: rgba(128, 128, 128, 0.3);
}
</style>
