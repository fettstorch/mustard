<script setup lang="ts">
/**
 * GithubLogin Component
 *
 * Handles the GitHub OAuth login flow via service worker.
 */
import { ref } from 'vue'
import {
  createGithubLoginMessage,
  sendMessage,
  type AtprotoSessionResponse,
} from '@/shared/messaging'

const emit = defineEmits<{
  success: [session: NonNullable<AtprotoSessionResponse>]
}>()

const isLoggingIn = ref(false)
const errorMessage = ref<string | null>(null)

async function login() {
  isLoggingIn.value = true
  errorMessage.value = null

  try {
    const session = await sendMessage(createGithubLoginMessage())
    if (session) {
      emit('success', session)
    } else {
      errorMessage.value = 'Login failed or was cancelled'
    }
  } catch (e) {
    errorMessage.value = e instanceof Error ? e.message : 'Login failed'
  } finally {
    isLoggingIn.value = false
  }
}
</script>

<template>
  <div class="login-form">
    <p class="login-label">Login with GitHub</p>
    <button @click="login" class="mustard-notes-btn-primary github-btn" :disabled="isLoggingIn">
      <span class="github-icon" aria-hidden="true">
        <!-- GitHub logo as inline SVG (no external resource needed in content scripts) -->
        <svg viewBox="0 0 16 16" width="16" height="16" fill="currentColor">
          <path
            d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38
            0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13
            -.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87
            2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15
            -.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0
            1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82
            1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0
            1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z"
          />
        </svg>
      </span>
      {{ isLoggingIn ? 'Connecting...' : 'Continue with GitHub' }}
    </button>
    <p v-if="errorMessage" class="login-error">{{ errorMessage }}</p>
  </div>
</template>

<style scoped>
.login-form {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}

.login-label {
  font-size: 0.875rem;
  font-weight: 500;
  color: var(--mustard-text);
}

.github-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0.5rem;
}

.github-icon {
  display: flex;
  align-items: center;
}

.login-error {
  font-size: 0.875rem;
  color: #b91c1c;
  font-weight: 500;
}
</style>
