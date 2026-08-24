// @vitest-environment jsdom

import { afterEach, describe, expect, it } from 'vitest'
import { pageKeyToHref, siteStrategyFor } from '../../src/shared/site-strategies'

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

  it('keys atproto posts by their canonical AT-URI across appviews', () => {
    const atUri = 'at://tangled.org/app.bsky.feed.post/3mttcilenbc23'
    expect(
      siteStrategyFor('https://bsky.app/profile/tangled.org/post/3mttcilenbc23').getPageKey(),
    ).toBe(atUri)
    expect(
      siteStrategyFor('https://mu.social/profile/tangled.org/post/3mttcilenbc23').getPageKey(),
    ).toBe(atUri)
  })
})

describe('pageKeyToHref', () => {
  it('opens AT-URI keys on the reference appview', () => {
    expect(pageKeyToHref('at://tangled.org/app.bsky.feed.post/3mttcilenbc23')).toBe(
      'https://bsky.app/profile/tangled.org/post/3mttcilenbc23',
    )
  })

  it('passes ordinary page keys through unchanged', () => {
    expect(pageKeyToHref('https://example.com/some/path')).toBe('https://example.com/some/path')
    expect(pageKeyToHref(STREAM_PLACE_VOD)).toBe(STREAM_PLACE_VOD)
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

  it('accepts Twitch VODs and clips but not live streams', () => {
    expect(siteStrategyFor('https://www.twitch.tv/videos/2854057658').isVideoNotePage()).toBe(true)
    expect(
      siteStrategyFor(
        'https://www.twitch.tv/reval/clip/SpicyOilyCardTheThing-rSVqAE6dzgz8wC7M',
      ).isVideoNotePage(),
    ).toBe(true)
    expect(siteStrategyFor('https://www.twitch.tv/reval').isVideoNotePage()).toBe(false)
    expect(siteStrategyFor('https://www.twitch.tv/directory/category/x').isVideoNotePage()).toBe(
      false,
    )
  })

  it('accepts atproto post pages but not profiles or feeds', () => {
    expect(
      siteStrategyFor(
        'https://bsky.app/profile/debbieohi.com/post/3mtm3ff75lc2d',
      ).isVideoNotePage(),
    ).toBe(true)
    expect(
      siteStrategyFor(
        'https://mu.social/profile/debbieohi.com/post/3mtm3ff75lc2d',
      ).isVideoNotePage(),
    ).toBe(true)
    expect(siteStrategyFor('https://bsky.app/profile/debbieohi.com').isVideoNotePage()).toBe(false)
    expect(siteStrategyFor('https://bsky.app/').isVideoNotePage()).toBe(false)
  })

  it('rejects unknown pages and invalid urls', () => {
    expect(siteStrategyFor('https://example.com/video/123').isVideoNotePage()).toBe(false)
    expect(siteStrategyFor('not a url').isVideoNotePage()).toBe(false)
  })
})

describe('resolveTargetElement', () => {
  it('re-aims overlay clicks at the video on stream.place VODs and Twitch', () => {
    const overlay = document.createElement('div')
    const video = document.createElement('video')
    expect(siteStrategyFor(STREAM_PLACE_VOD).resolveTargetElement(overlay, [overlay, video])).toBe(
      video,
    )
    expect(
      siteStrategyFor('https://www.twitch.tv/videos/2854057658').resolveTargetElement(overlay, [
        overlay,
        video,
      ]),
    ).toBe(video)
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

describe('Bluesky post selectors', () => {
  const BSKY_POST = 'https://bsky.app/profile/debbieohi.com/post/3mtm3ff75lc2d'

  it('scopes the selector to the enclosing post item', () => {
    document.body.innerHTML = `
      <div data-testid="postThreadItem-by-debbieohi.com"><video></video></div>
      <div data-testid="postThreadItem-by-someone.else"><video></video></div>
    `
    const video = document.querySelector('[data-testid="postThreadItem-by-someone.else"] video')!
    expect(siteStrategyFor(BSKY_POST).createSelector(video)).toBe(
      '[data-testid="postThreadItem-by-someone.else"] video',
    )
  })

  it('refuses an ambiguous scope when same-author posts share a testid', () => {
    document.body.innerHTML = `
      <div data-testid="postThreadItem-by-debbieohi.com"><video></video></div>
      <div data-testid="postThreadItem-by-debbieohi.com"><video></video></div>
    `
    const firstVideo = document.querySelector('video')!
    // Even the FIRST match must be refused: the selector would resolve to
    // whichever post renders first, not to this specific video.
    expect(siteStrategyFor(BSKY_POST).createSelector(firstVideo)).toBeNull()
  })

  it('falls back to the bare tag for a single unscoped video', () => {
    const video = document.createElement('video')
    document.body.appendChild(video)
    expect(siteStrategyFor(BSKY_POST).createSelector(video)).toBe('video')
  })

  it('has no opinion when neither scoping nor uniqueness holds', () => {
    document.body.innerHTML = '<video></video><video></video>'
    const video = document.querySelectorAll('video')[1]!
    expect(siteStrategyFor(BSKY_POST).createSelector(video)).toBeNull()
  })
})
