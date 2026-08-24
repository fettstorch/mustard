// @vitest-environment jsdom

import { afterEach, describe, expect, it } from 'vitest'
import { siteStrategyFor } from '../../src/shared/site-strategies'

const STREAM_PLACE_VOD = 'https://stream.place/iame.li/video/3msjhn6ahhthp'

afterEach(() => {
  document.body.innerHTML = ''
})

describe('getPageKey', () => {
  it('keeps only the video id on YouTube watch pages', () => {
    expect(siteStrategyFor('https://www.youtube.com/watch?v=abc&t=42s&list=xyz').getPageKey()).toBe(
      'https://www.youtube.com/watch?v=abc',
    )
  })

  it('uses origin and pathname everywhere else', () => {
    expect(siteStrategyFor('https://example.com/some/path?utm=1#frag').getPageKey()).toBe(
      'https://example.com/some/path',
    )
    expect(siteStrategyFor(`${STREAM_PLACE_VOD}?t=99`).getPageKey()).toBe(STREAM_PLACE_VOD)
  })
})

describe('isVideoNotePage', () => {
  it('accepts YouTube watch pages with a video id', () => {
    expect(siteStrategyFor('https://www.youtube.com/watch?v=abc').isVideoNotePage()).toBe(true)
    expect(siteStrategyFor('https://www.youtube.com/watch').isVideoNotePage()).toBe(false)
  })

  it('accepts stream.place VODs but not live streams', () => {
    expect(siteStrategyFor(STREAM_PLACE_VOD).isVideoNotePage()).toBe(true)
    expect(siteStrategyFor('https://stream.place/iame.li').isVideoNotePage()).toBe(false)
  })

  it('rejects unknown pages and invalid urls', () => {
    expect(siteStrategyFor('https://example.com/video/123').isVideoNotePage()).toBe(false)
    expect(siteStrategyFor('not a url').isVideoNotePage()).toBe(false)
  })
})

describe('resolveTargetElement', () => {
  it('re-aims overlay clicks at the video on stream.place VODs', () => {
    const overlay = document.createElement('div')
    const video = document.createElement('video')
    expect(siteStrategyFor(STREAM_PLACE_VOD).resolveTargetElement(overlay, [overlay, video])).toBe(
      video,
    )
  })

  it('keeps the clicked element when no video is under the click', () => {
    const overlay = document.createElement('div')
    expect(siteStrategyFor(STREAM_PLACE_VOD).resolveTargetElement(overlay, [overlay])).toBe(overlay)
  })

  it('never re-aims on pages without a site strategy', () => {
    const overlay = document.createElement('div')
    const video = document.createElement('video')
    expect(
      siteStrategyFor('https://example.com/').resolveTargetElement(overlay, [overlay, video]),
    ).toBe(overlay)
  })
})

describe('createSelector', () => {
  it("uses the bare tag for stream.place's single video", () => {
    const video = document.createElement('video')
    document.body.appendChild(video)
    expect(siteStrategyFor(STREAM_PLACE_VOD).createSelector(video)).toBe('video')
  })

  it('has no opinion when the video is not unique or the site has no strategy', () => {
    const video = document.createElement('video')
    document.body.appendChild(video)
    document.body.appendChild(document.createElement('video'))
    expect(siteStrategyFor(STREAM_PLACE_VOD).createSelector(video)).toBeNull()
    expect(siteStrategyFor('https://www.youtube.com/watch?v=abc').createSelector(video)).toBeNull()
  })
})
