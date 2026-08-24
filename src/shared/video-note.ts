import type { MustardNoteAnchorData } from './model/MustardNoteAnchorData'
import type { VideoElementAnchorData } from './model/MustardNoteElementAnchorData'
import { siteStrategyFor } from './site-strategies'
import { isVideoElement } from './video-element'

export const VIDEO_NOTE_DEFAULT_DURATION = 5
export const VIDEO_NOTE_TIME_STEP = 1
const VIDEO_NOTE_MIN_DURATION = VIDEO_NOTE_TIME_STEP

/**
 * Video-note authoring is intentionally limited to curated video surfaces
 * (see site-strategies.ts). Keeping that decision in one place makes adding a
 * site independent from anchor capture and editor rendering.
 */
export function getVideoElementAnchorData(
  pageUrl: string,
  element: Element | null,
): VideoElementAnchorData | undefined {
  if (!isVideoElement(element) || !siteStrategyFor(pageUrl).isVideoNotePage()) {
    return undefined
  }

  return {
    type: 'video',
    startAt: normalizeVideoStartAt(element.currentTime),
    duration: VIDEO_NOTE_DEFAULT_DURATION,
  }
}

/**
 * A video note is visible from its start time until its duration has played
 * out. The end bound is exclusive so back-to-back timeframes never overlap.
 */
export function isWithinVideoTimeframe(
  anchorData: VideoElementAnchorData,
  currentTime: number,
): boolean {
  return currentTime >= anchorData.startAt && currentTime < anchorData.startAt + anchorData.duration
}

export function normalizeVideoStartAt(value: unknown): number {
  const numberValue = toFiniteNumber(value)
  // Floor, don't round: rounding up would put the start just past the paused
  // playhead the note was authored at, hiding the note the moment it's saved.
  return numberValue === undefined ? 0 : floorToTimeStep(Math.max(0, numberValue))
}

export function normalizeVideoDuration(value: unknown): number {
  const numberValue = toFiniteNumber(value)
  return numberValue === undefined
    ? VIDEO_NOTE_DEFAULT_DURATION
    : Math.max(VIDEO_NOTE_MIN_DURATION, roundToTimeStep(numberValue))
}

/**
 * Renders seconds as a video timestamp (`m:ss`, `h:mm:ss`) — whole seconds,
 * matching the granularity notes are authored at.
 */
export function formatVideoTimestamp(totalSeconds: number): string {
  const wholeSeconds = Math.round(Math.max(0, totalSeconds))
  const hours = Math.floor(wholeSeconds / 3600)
  const minutes = Math.floor((wholeSeconds % 3600) / 60)
  const seconds = wholeSeconds % 60

  const paddedSeconds = String(seconds).padStart(2, '0')
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, '0')}:${paddedSeconds}`
    : `${minutes}:${paddedSeconds}`
}

/**
 * Parses user timestamp input: plain seconds (`332.8`), `m:ss`, or `h:mm:ss`,
 * accepting a comma as the decimal separator.
 */
export function parseVideoTimestamp(value: string): number | undefined {
  const parts = value.trim().replace(',', '.').split(':')
  if (parts.length > 3) return undefined

  let seconds = 0
  for (const part of parts) {
    const partValue = Number(part)
    if (part.trim() === '' || !Number.isFinite(partValue) || partValue < 0) return undefined
    seconds = seconds * 60 + partValue
  }
  return seconds
}

function roundToTimeStep(value: number): number {
  return Math.round(value / VIDEO_NOTE_TIME_STEP) * VIDEO_NOTE_TIME_STEP
}

function floorToTimeStep(value: number): number {
  return Math.floor(value / VIDEO_NOTE_TIME_STEP) * VIDEO_NOTE_TIME_STEP
}

function toFiniteNumber(value: unknown): number | undefined {
  if (value === '' || value === null || value === undefined) return undefined
  const numberValue = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(numberValue) ? numberValue : undefined
}

/**
 * Jumps the anchored video to the note's timeframe start. A no-op when the
 * anchor isn't a timed video note, the video isn't on this page, or an ad
 * owns the player (seeking then would scrub the ad, not the video).
 */
export function seekVideoToTimeframeStart(anchor: MustardNoteAnchorData): void {
  const anchorData = anchor.elementAnchorData
  if (anchorData?.type !== 'video' || !anchor.elementSelector || isVideoAdShowing()) return
  const video = document.querySelector(anchor.elementSelector)
  if (isVideoElement(video)) video.currentTime = anchorData.startAt
}

/**
 * Whether the curated player is currently playing an ad. YouTube runs ads
 * through the same <video> element as the content and flags the player
 * container while doing so — playback time read or written during an ad
 * belongs to the ad, not the video.
 */
export function isVideoAdShowing(): boolean {
  const player = document.querySelector('#movie_player')
  return (
    !!player &&
    (player.classList.contains('ad-showing') || player.classList.contains('ad-interrupting'))
  )
}
