<script setup lang="ts">
import { computed } from 'vue'
import type { UserProfile } from '@/shared/model/UserProfile'
import AuthorAvatar from './AuthorAvatar.vue'

/** Max reposter avatars shown before collapsing into a "+N" chip. */
const MAX_VISIBLE_REPOSTERS = 3

const props = defineProps<{
  /** The note's original author — always rendered front-most (on top). */
  author: UserProfile | null
  /** All reposters of the note (may include accounts the viewer doesn't follow). May be empty. */
  reposters: (UserProfile | null)[]
}>()

const visibleReposters = computed(() => props.reposters.slice(0, MAX_VISIBLE_REPOSTERS))

/** How many reposters didn't fit — shown as a "+N" chip. */
const overflowCount = computed(() => Math.max(0, props.reposters.length - MAX_VISIBLE_REPOSTERS))
</script>

<template>
  <div class="repost-avatar-stack">
    <!--
      Render order = paint order. Reposters paint first (further back / right),
      the original author paints last so it sits on top, per design. Each item
      after the first overlaps the previous via negative margin. We reverse the
      visual stacking with z-index so the author is front-most.
    -->
    <!-- "+N" overflow chip sits at the very back (right-most). -->
    <div
      v-if="overflowCount > 0"
      class="repost-overflow"
      :title="`+${overflowCount} more reposted`"
    >
      +{{ overflowCount }}
    </div>
    <div
      v-for="(reposter, i) in visibleReposters"
      :key="reposter?.id ?? `reposter-${i}`"
      class="repost-stack-item"
      :style="{ zIndex: i + 1 }"
    >
      <AuthorAvatar :profile="reposter" />
    </div>
    <!-- Original author: front-most. -->
    <div class="repost-stack-item author-item" :style="{ zIndex: visibleReposters.length + 1 }">
      <AuthorAvatar :profile="author" />
    </div>
  </div>
</template>

<style scoped>
/*
 * Lay items out right-to-left (row-reverse) so the first DOM item (the overflow
 * chip / back-most) ends up on the right and the original author (last DOM item)
 * ends up on the left, overlapping everything to its right. Combined with the
 * z-index above, the author renders fully visible on top and reposters peek out
 * from behind it.
 */
.repost-avatar-stack {
  display: flex;
  flex-direction: row-reverse;
  align-items: center;
  flex-shrink: 0;
}

.repost-stack-item {
  position: relative;
  border-radius: 50%;
  /* White ring so overlapping avatars stay visually separated. */
  box-shadow: 0 0 0 1.5px var(--mustard-yellow-light, #ffe066);
}

/* Every item except the right-most (back-most) overlaps its right neighbour. */
.repost-stack-item:not(:last-child),
.repost-overflow:not(:last-child) {
  margin-left: -10px;
}

.repost-overflow {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  border-radius: 50%;
  background: rgba(128, 128, 128, 0.3);
  box-shadow: 0 0 0 1.5px var(--mustard-yellow-light, #ffe066);
  font-size: 0.6rem;
  font-weight: bold;
  color: var(--mustard-text);
  flex-shrink: 0;
  user-select: none;
}
</style>
