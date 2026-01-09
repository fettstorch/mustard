<script setup lang="ts"></script>

<template>
  <div class="clickable-el" style="">
    <div class="content">
      <slot />
    </div>
  </div>
</template>

<style scoped>
.clickable-el {
  cursor: pointer;
  user-select: none;
  transition: all 0.1s ease-in-out;

  .content {
    display: flex;
  }

  &:hover {
    background:
      radial-gradient(ellipse 50% 100% at 0% 50%, #5c3a1e50 0%, #5c3a1e00 50%),
      radial-gradient(ellipse 50% 100% at 100% 50%, #5c3a1e50 0%, #5c3a1e00 50%);
  }

  &:active {
    background:
      radial-gradient(ellipse 100% 100% at 0% 50%, #5c3a1e50 0%, #5c3a1e00 50%),
      radial-gradient(ellipse 100% 100% at 100% 50%, #5c3a1e50 0%, #5c3a1e00 50%);

    .content {
      transform: scale(0.9);
    }
  }
}
</style>
