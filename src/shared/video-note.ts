import { when } from '@fettstorch/jule'
import type { VideoElementAnchorData } from './model/MustardNoteElementAnchorData'
import { isVideoElement } from './video-element'

export const VIDEO_NOTE_DEFAULT_DURATION = 5
export const VIDEO_NOTE_TIME_STEP = 0.1
export const VIDEO_NOTE_MIN_DURATION = VIDEO_NOTE_TIME_STEP

/**
 * Video-note authoring is intentionally limited to the curated YouTube watch
 * surface. Keeping this decision in one strategy makes adding a later curated
 * site independent from anchor capture and editor rendering.
 */
export function getVideoElementAnchorData(
  pageUrl: string,
  element: Element | null,
): VideoElementAnchorData | undefined {
  if (!isVideoElement(element) || !isCuratedVideoPage(pageUrl)) {
    return undefined
  }

  return {
    type: 'video',
    startAt: normalizeVideoStartAt(element.currentTime),
    duration: VIDEO_NOTE_DEFAULT_DURATION,
  }
}

export function normalizeVideoStartAt(value: unknown): number {
  const numberValue = toFiniteNumber(value)
  return numberValue === undefined ? 0 : Math.max(0, numberValue)
}

export function normalizeVideoDuration(value: unknown): number {
  const numberValue = toFiniteNumber(value)
  return numberValue === undefined
    ? VIDEO_NOTE_DEFAULT_DURATION
    : Math.max(VIDEO_NOTE_MIN_DURATION, numberValue)
}

function toFiniteNumber(value: unknown): number | undefined {
  if (value === '' || value === null || value === undefined) return undefined
  const numberValue = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(numberValue) ? numberValue : undefined
}

function isCuratedVideoPage(pageUrl: string): boolean {
  let url: URL
  try {
    url = new URL(pageUrl)
  } catch {
    return false
  }

  const strategyKey = `${url.hostname.replace(/^www\./, '')}${url.pathname}`
  return when(strategyKey)({
    'youtube.com/watch': () => !!url.searchParams.get('v')?.trim(),
    else: () => false,
  })
}
