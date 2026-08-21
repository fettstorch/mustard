// @vitest-environment jsdom

import { describe, expect, it } from 'vitest'
import {
  getVideoElementAnchorData,
  isWithinVideoTimeframe,
  normalizeVideoDuration,
  normalizeVideoStartAt,
  VIDEO_NOTE_DEFAULT_DURATION,
} from '../../src/shared/video-note'

describe('getVideoElementAnchorData', () => {
  it('captures the current time on a YouTube watch page', () => {
    const video = document.createElement('video')
    video.currentTime = 12.5

    expect(getVideoElementAnchorData('https://www.youtube.com/watch?v=abc', video)).toEqual({
      type: 'video',
      startAt: 12.5,
      duration: VIDEO_NOTE_DEFAULT_DURATION,
    })
  })

  it('does not add metadata outside the curated watch page', () => {
    const video = document.createElement('video')
    const unsupportedUrls = [
      'https://www.youtube.com/shorts/abc',
      'https://m.youtube.com/watch?v=abc',
      'https://www.youtube.com/embed/abc',
      'https://www.youtube.com/watch?v=',
      'https://www.youtube.com/watch',
    ]

    for (const url of unsupportedUrls) {
      expect(getVideoElementAnchorData(url, video)).toBeUndefined()
    }
    expect(getVideoElementAnchorData('https://www.youtube.com/watch?v=abc', document.body)).toBe(
      undefined,
    )
  })
})

describe('isWithinVideoTimeframe', () => {
  const anchorData = { type: 'video', startAt: 10, duration: 5 } as const

  it('is visible from the start time until the duration has played out', () => {
    expect(isWithinVideoTimeframe(anchorData, 10)).toBe(true)
    expect(isWithinVideoTimeframe(anchorData, 12.5)).toBe(true)
    expect(isWithinVideoTimeframe(anchorData, 14.99)).toBe(true)
  })

  it('is hidden before the start and once the timeframe ends', () => {
    expect(isWithinVideoTimeframe(anchorData, 9.99)).toBe(false)
    expect(isWithinVideoTimeframe(anchorData, 15)).toBe(false)
    expect(isWithinVideoTimeframe(anchorData, 0)).toBe(false)
  })
})

describe('video timing normalization', () => {
  it('clamps negative or invalid start times to zero', () => {
    expect(normalizeVideoStartAt(-1)).toBe(0)
    expect(normalizeVideoStartAt(Number.NaN)).toBe(0)
    expect(normalizeVideoStartAt(Number.POSITIVE_INFINITY)).toBe(0)
  })

  it('defaults invalid durations and clamps non-positive values', () => {
    expect(normalizeVideoDuration('')).toBe(VIDEO_NOTE_DEFAULT_DURATION)
    expect(normalizeVideoDuration(Number.NaN)).toBe(VIDEO_NOTE_DEFAULT_DURATION)
    expect(normalizeVideoDuration(0)).toBeGreaterThan(0)
    expect(normalizeVideoDuration(-2)).toBeGreaterThan(0)
  })
})
