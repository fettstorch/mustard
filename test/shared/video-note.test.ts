// @vitest-environment jsdom

import { describe, expect, it } from 'vitest'
import {
  formatVideoTimestamp,
  getVideoElementAnchorData,
  isWithinVideoTimeframe,
  normalizeVideoDuration,
  normalizeVideoStartAt,
  parseVideoTimestamp,
  VIDEO_NOTE_DEFAULT_DURATION,
} from '../../src/shared/video-note'

describe('getVideoElementAnchorData', () => {
  it('captures the current time on a YouTube watch page', () => {
    const video = document.createElement('video')
    video.currentTime = 12.2

    expect(getVideoElementAnchorData('https://www.youtube.com/watch?v=abc', video)).toEqual({
      type: 'video',
      startAt: 12,
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

  it('floors start times so the captured playhead stays inside the timeframe', () => {
    expect(normalizeVideoStartAt(332.796905)).toBe(332)
    expect(normalizeVideoStartAt(12.34)).toBe(12)
    // A note authored at a paused playhead must be visible right away.
    const startAt = normalizeVideoStartAt(332.796905)
    expect(isWithinVideoTimeframe({ type: 'video', startAt, duration: 5 }, 332.796905)).toBe(true)
  })

  it('rounds durations to whole seconds', () => {
    expect(normalizeVideoDuration(4.96)).toBe(5)
    expect(normalizeVideoDuration(0.04)).toBeGreaterThan(0)
  })

  it('defaults invalid durations and clamps non-positive values', () => {
    expect(normalizeVideoDuration('')).toBe(VIDEO_NOTE_DEFAULT_DURATION)
    expect(normalizeVideoDuration(Number.NaN)).toBe(VIDEO_NOTE_DEFAULT_DURATION)
    expect(normalizeVideoDuration(0)).toBeGreaterThan(0)
    expect(normalizeVideoDuration(-2)).toBeGreaterThan(0)
  })
})

describe('video timestamp formatting', () => {
  it('renders whole-second m:ss timestamps', () => {
    expect(formatVideoTimestamp(0)).toBe('0:00')
    expect(formatVideoTimestamp(332.796905)).toBe('5:33')
    expect(formatVideoTimestamp(75)).toBe('1:15')
    expect(formatVideoTimestamp(3723)).toBe('1:02:03')
  })

  it('parses timestamps, plain seconds, and comma decimals', () => {
    expect(parseVideoTimestamp('5:32')).toBe(332)
    expect(parseVideoTimestamp('332.8')).toBeCloseTo(332.8)
    expect(parseVideoTimestamp('332,8')).toBeCloseTo(332.8)
    expect(parseVideoTimestamp('1:02:03')).toBe(3723)
    expect(parseVideoTimestamp('')).toBeUndefined()
    expect(parseVideoTimestamp('abc')).toBeUndefined()
    expect(parseVideoTimestamp('1:2:3:4')).toBeUndefined()
  })

  it('round-trips through format and parse', () => {
    for (const seconds of [0, 59, 60, 3599, 3600, 333]) {
      expect(parseVideoTimestamp(formatVideoTimestamp(seconds))).toBe(seconds)
    }
  })
})
