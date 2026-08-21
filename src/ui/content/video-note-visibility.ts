import { onUnmounted, reactive, ref, watchEffect } from 'vue'
import type { MustardNote } from '@/shared/model/MustardNote'
import { isVideoElement } from '@/shared/video-element'
import { isWithinVideoTimeframe } from '@/shared/video-note'

/**
 * Tracks playback time of the videos that timed notes are anchored to, and
 * answers whether each note's timeframe is currently playing.
 *
 * Videos are resolved lazily from the notes' selectors and re-resolved
 * whenever the watched sources change (notes arriving, resize/scroll ticks),
 * which covers SPA pages that mount their player after the notes load.
 */
export function useVideoNoteVisibility(options: {
  getNotes: () => MustardNote[]
  /** Extra reactive dependency that retriggers video re-resolution. */
  getRetriggerTick: () => number
}) {
  /** Latest known playback time per anchored video, keyed by element selector. */
  const videoTimes = reactive<Record<string, number>>({})
  const trackedVideos = new Map<string, { video: HTMLVideoElement; onTimeChange: () => void }>()

  // SPA players often mount after the notes load, with no scroll/resize in
  // between to retrigger resolution — retry unresolved selectors on a bounded
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
      const selector = note.anchorData.elementSelector
      if (note.anchorData.elementAnchorData?.type !== 'video' || !selector) continue

      const tracked = trackedVideos.get(selector)
      if (tracked?.video.isConnected) continue
      if (tracked) untrackVideo(selector, tracked)

      const video = document.querySelector(selector)
      if (!isVideoElement(video)) {
        hasUnresolvedVideo = true
        continue
      }
      trackVideo(selector, video)
    }

    if (hasUnresolvedVideo && retriesLeft > 0 && retryTimer === undefined) {
      retryTimer = window.setTimeout(() => {
        retryTimer = undefined
        retriesLeft--
        retryTick.value++
      }, 500)
    }
  })

  function trackVideo(selector: string, video: HTMLVideoElement) {
    const onTimeChange = () => {
      videoTimes[selector] = video.currentTime
    }
    // `timeupdate` covers playback; `seeked` covers jumps while paused.
    video.addEventListener('timeupdate', onTimeChange)
    video.addEventListener('seeked', onTimeChange)
    trackedVideos.set(selector, { video, onTimeChange })
    onTimeChange()
  }

  function untrackVideo(
    selector: string,
    tracked: NonNullable<ReturnType<typeof trackedVideos.get>>,
  ) {
    tracked.video.removeEventListener('timeupdate', tracked.onTimeChange)
    tracked.video.removeEventListener('seeked', tracked.onTimeChange)
    trackedVideos.delete(selector)
    delete videoTimes[selector]
  }

  /** Notes without video timing are always visible; timed notes only while playing their timeframe. */
  function isNoteTimeframeActive(note: MustardNote): boolean {
    const elementAnchorData = note.anchorData.elementAnchorData
    if (elementAnchorData?.type !== 'video') return true
    const selector = note.anchorData.elementSelector
    if (!selector) return true
    const currentTime = videoTimes[selector]
    // Video not resolved yet (e.g. SPA player still mounting): keep the note
    // hidden rather than flash it outside its timeframe.
    if (currentTime === undefined) return false
    return isWithinVideoTimeframe(elementAnchorData, currentTime)
  }

  onUnmounted(() => {
    stopWatcher()
    if (retryTimer !== undefined) clearTimeout(retryTimer)
    for (const [selector, tracked] of trackedVideos) {
      untrackVideo(selector, tracked)
    }
  })

  return { isNoteTimeframeActive }
}
