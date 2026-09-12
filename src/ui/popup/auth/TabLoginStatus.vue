<script setup lang="ts">
import { onMounted, onUnmounted, ref } from 'vue'
import { sendMessage, type AtprotoSessionResponse } from '@/shared/messaging'
import type { OAuthLoginStatus } from '@/shared/oauth-login'

const emit = defineEmits<{
  success: [session: NonNullable<AtprotoSessionResponse>]
}>()
const status = ref<OAuthLoginStatus>({ status: 'idle' })
let timer: ReturnType<typeof setTimeout> | undefined
let stopped = false
let wasPending = false

async function refresh() {
  try {
    status.value = await sendMessage({ type: 'GET_OAUTH_LOGIN_STATUS' })
    if (wasPending && status.value.status === 'idle') {
      const session = await sendMessage({ type: 'GET_ATPROTO_SESSION' })
      if (session) emit('success', session)
    }
    wasPending = status.value.status === 'pending'
  } catch {
    status.value = {
      status: 'failed',
      message: 'Could not check sign-in. Reopen Mustard to retry.',
    }
  } finally {
    // Only while this visible extension UI is mounted; no background keep-alive.
    if (!stopped) timer = setTimeout(refresh, 1000)
  }
}

async function cancel() {
  await sendMessage({ type: 'CANCEL_OAUTH_LOGIN' })
  wasPending = false
  status.value = { status: 'idle' }
}

onMounted(refresh)
onUnmounted(() => {
  stopped = true
  clearTimeout(timer)
})
</script>

<template>
  <div aria-live="polite">
    <template v-if="status.status === 'pending'">
      <p>Finish signing in in the new tab, then reopen Mustard.</p>
      <button type="button" @click="cancel">Cancel sign-in</button>
    </template>
    <p v-else-if="status.status === 'failed'" role="alert">{{ status.message }}</p>
  </div>
</template>
