<script setup lang="ts"></script>

<template>
  <div class="mustard-notes-clickable" style="">
    <div class="mustard-notes-clickable-inner">
      <slot />
    </div>
  </div>
</template>

<style scoped>
.mustard-notes-clickable {
  cursor: pointer;
  user-select: none;
  transition: all 0.1s ease-in-out;

  .mustard-notes-clickable-inner {
    display: flex;
  }

  &:hover {
    background:
      radial-gradient(ellipse 50% 100% at 0% 50%, var(--mustard-border-faded) 0%, transparent 50%),
      radial-gradient(ellipse 50% 100% at 100% 50%, var(--mustard-border-faded) 0%, transparent 50%);
  }

  &:active {
    background:
      radial-gradient(ellipse 100% 100% at 0% 50%, var(--mustard-border-faded) 0%, transparent 50%),
      radial-gradient(
        ellipse 100% 100% at 100% 50%,
        var(--mustard-border-faded) 0%,
        transparent 50%
      );

    .mustard-notes-clickable-inner {
      transform: scale(0.9);
    }
  }
}
</style>
