import { onUnmounted, reactive, ref, watchEffect } from 'vue'
import type { MustardNote } from '@/shared/model/MustardNote'
import { isVideoElement } from '@/shared/video-element'
import { resolveAnchoredElement } from '@/shared/site-strategies'
import { isWithinVideoTimeframe } from '@/shared/video-note'

/** One stable tracker key per anchor — a post note re-anchored into a feed and its post-page original share it. */
function anchorKey(note: MustardNote): string {
  return `${note.anchorData.pageUrl}::${note.anchorData.elementSelector ?? ''}`
}

/**
 * Tracks playback time of the videos that timed notes are anchored to, and
 * answers whether each note's timeframe is currently playing.
 *
 * Videos are resolved lazily via the shared anchor resolution (stored
 * selector, or the note's embedded post on feed pages) and re-resolved
 * whenever the watched sources change (notes arriving, resize/scroll ticks),
 * which covers SPA pages that mount their player after the notes load.
 */
export function useVideoNoteVisibility(options: {
  getNotes: () => MustardNote[]
  /** Extra reactive dependency that retriggers video re-resolution. */
  getRetriggerTick: () => number
}) {
  /** Latest known playback time per anchored video, keyed by anchor identity. */
  const videoTimes = reactive<Record<string, number>>({})
  const trackedVideos = new Map<string, { video: HTMLVideoElement; onTimeChange: () => void }>()

  // SPA players often mount after the notes load, with no scroll/resize in
  // between to retrigger resolution — retry unresolved anchors on a bounded
  // schedule so a timed note doesn't stay invisible until user interaction.
  const retryTick = ref(0)
  let retryTimer: number | undefined
  let retriesLeft = 40

  const stopWatcher = watchEffect(() => {
    options.getRetriggerTick()
    // eslint-disable-next-line @typescript-eslint/no-unused-expressions
    retryTick.value // dependency: bounded self-retry while videos are unresolved
    let hasUnresolvedVideo = false
    for (const note of options.getNotes()) {
      if (note.anchorData.elementAnchorData?.type !== 'video') continue
      const key = anchorKey(note)

      // Resolve fresh every pass and compare identity: after an SPA
      // navigation the anchor can resolve to a NEW video while the previously
      // tracked one is still connected (retained navigation-stack screens) —
      // "still connected" alone would keep listening to a hidden player.
      const video = resolveAnchoredElement(note.anchorData)
      const tracked = trackedVideos.get(key)
      if (tracked && tracked.video === video) continue
      if (tracked) untrackVideo(key, tracked)

      if (!isVideoElement(video)) {
        if (import.meta.env.DEV) {
          console.debug('mustard [video-tracker] unresolved', key, 'resolved to:', video)
        }
        hasUnresolvedVideo = true
        continue
      }
      if (import.meta.env.DEV) {
        console.debug(
          'mustard [video-tracker] tracking',
          key,
          video,
          'connected:',
          video.isConnected,
        )
      }
      trackVideo(key, video)
    }

    if (hasUnresolvedVideo && retriesLeft > 0 && retryTimer === undefined) {
      retryTimer = window.setTimeout(() => {
        retryTimer = undefined
        retriesLeft--
        retryTick.value++
      }, 500)
    }
  })

  function trackVideo(key: string, video: HTMLVideoElement) {
    const onTimeChange = () => {
      videoTimes[key] = video.currentTime
    }
    // `timeupdate` covers playback; `seeked` covers jumps while paused.
    video.addEventListener('timeupdate', onTimeChange)
    video.addEventListener('seeked', onTimeChange)
    trackedVideos.set(key, { video, onTimeChange })
    onTimeChange()
  }

  function untrackVideo(key: string, tracked: NonNullable<ReturnType<typeof trackedVideos.get>>) {
    tracked.video.removeEventListener('timeupdate', tracked.onTimeChange)
    tracked.video.removeEventListener('seeked', tracked.onTimeChange)
    trackedVideos.delete(key)
    delete videoTimes[key]
  }

  /** Notes without video timing are always visible; timed notes only while playing their timeframe. */
  function isNoteTimeframeActive(note: MustardNote): boolean {
    const elementAnchorData = note.anchorData.elementAnchorData
    if (elementAnchorData?.type !== 'video') return true
    const currentTime = videoTimes[anchorKey(note)]
    // Video not resolved yet (e.g. SPA player still mounting): keep the note
    // hidden rather than flash it outside its timeframe.
    if (currentTime === undefined) return false
    return isWithinVideoTimeframe(elementAnchorData, currentTime)
  }

  onUnmounted(() => {
    stopWatcher()
    if (retryTimer !== undefined) clearTimeout(retryTimer)
    for (const [key, tracked] of trackedVideos) {
      untrackVideo(key, tracked)
    }
  })

  return { isNoteTimeframeActive }
}
