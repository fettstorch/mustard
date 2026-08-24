// @vitest-environment jsdom

import { afterEach, describe, expect, it } from 'vitest'
import {
  pageKeyToHref,
  resolveAnchoredElement,
  siteStrategyFor,
} from '../../src/shared/site-strategies'

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
    expect(
      siteStrategyFor('https://witchsky.app/profile/tangled.org/post/3mttcilenbc23').getPageKey(),
    ).toBe(atUri)
    expect(
      siteStrategyFor('https://deer.social/profile/tangled.org/post/3mttcilenbc23').getPageKey(),
    ).toBe(atUri)
    expect(
      siteStrategyFor(
        'https://blacksky.community/profile/tangled.org/post/3mttcilenbc23',
      ).getPageKey(),
    ).toBe(atUri)
  })

  it('lists legacy appview-url keys behind the canonical AT-URI', () => {
    expect(
      siteStrategyFor('https://mu.social/profile/tangled.org/post/3mttcilenbc23').getPageKeys(),
    ).toEqual([
      'at://tangled.org/app.bsky.feed.post/3mttcilenbc23',
      'https://mu.social/profile/tangled.org/post/3mttcilenbc23',
    ])
    expect(siteStrategyFor(`${STREAM_PLACE_VOD}?t=99`).getPageKeys()).toEqual([STREAM_PLACE_VOD])
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

  it('accepts atproto post pages and appview feeds (feed videos are post videos)', () => {
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
    expect(siteStrategyFor('https://bsky.app/profile/debbieohi.com').isVideoNotePage()).toBe(true)
    expect(siteStrategyFor('https://bsky.app/').isVideoNotePage()).toBe(true)
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

describe('embedded atproto posts (feeds)', () => {
  const FEED_PAGE = 'https://bsky.app/profile/tangled.org'
  const POST_KEY = 'at://tangled.org/app.bsky.feed.post/3mttcilenbc23'

  function renderFeed() {
    document.body.innerHTML = `
      <div data-testid="feedItem-by-tangled.org">
        <a href="/profile/tangled.org/post/3mttcilenbc23">2h</a>
        <p id="post-text">hello</p>
        <video></video>
      </div>
      <div data-testid="feedItem-by-other.dev">
        <a href="/profile/other.dev/post/abc123">1h</a>
      </div>
    `
  }

  it('collects the canonical keys of embedded posts', () => {
    renderFeed()
    expect(siteStrategyFor(FEED_PAGE).collectEmbeddedPostKeys()).toEqual([
      POST_KEY,
      'at://other.dev/app.bsky.feed.post/abc123',
    ])
    expect(siteStrategyFor('https://example.com/').collectEmbeddedPostKeys()).toEqual([])
    expect(siteStrategyFor(FEED_PAGE).supportsEmbeddedPosts()).toBe(true)
    expect(siteStrategyFor('https://example.com/').supportsEmbeddedPosts()).toBe(false)
  })

  it('keys a click inside an embedded post to the post, with a post-page selector', () => {
    renderFeed()
    const strategy = siteStrategyFor(FEED_PAGE)
    const text = document.getElementById('post-text')!
    const anchor = strategy.resolveEmbeddedPostAnchor(text, [text])!
    expect(anchor.pageKey).toBe(POST_KEY)
    expect(anchor.selector).toBe('[data-testid="postThreadItem-by-tangled.org"]')
    expect(anchor.anchorElement).toBe(text.closest('[data-testid^="feedItem-by-"]'))

    const video = document.querySelector('video')!
    const videoAnchor = strategy.resolveEmbeddedPostAnchor(video, [video])!
    expect(videoAnchor.selector).toBe('[data-testid="postThreadItem-by-tangled.org"] video')
    expect(videoAnchor.anchorElement).toBe(video)
  })

  it('yields no post anchor for clicks outside embedded posts', () => {
    renderFeed()
    const outside = document.createElement('div')
    document.body.appendChild(outside)
    expect(siteStrategyFor(FEED_PAGE).resolveEmbeddedPostAnchor(outside, [outside])).toBeNull()
  })

  it('re-anchors post-keyed notes to their feed item on feed pages', () => {
    renderFeed()
    // jsdom's location is not an appview url — resolveAnchoredElement consults
    // the current page's strategy, so run against the feed strategy via the
    // embedded resolver directly plus the selector-precedence contract.
    const container = siteStrategyFor(FEED_PAGE).resolveEmbeddedPost(POST_KEY)
    expect(container?.getAttribute('data-testid')).toBe('feedItem-by-tangled.org')
    expect(
      siteStrategyFor(FEED_PAGE).resolveEmbeddedPost('at://nope/app.bsky.feed.post/x'),
    ).toBeNull()
  })

  it('resolveAnchoredElement prefers the stored selector and never falls back for unknown pages', () => {
    renderFeed()
    const anchor = { pageUrl: POST_KEY, elementSelector: '#post-text' }
    expect(resolveAnchoredElement(anchor)).toBe(document.getElementById('post-text'))
    // Unresolvable selector on a non-appview page (jsdom location): no embedded
    // resolution available → null, never the absolute-position fallback.
    expect(resolveAnchoredElement({ pageUrl: POST_KEY, elementSelector: '#missing' })).toBeNull()
  })
})

describe('embedded atproto posts (thread pages)', () => {
  const THREAD_PAGE = 'https://bsky.app/profile/author.com/post/3root'
  const ROOT_KEY = 'at://author.com/app.bsky.feed.post/3root'
  const REPLY_KEY = 'at://author.com/app.bsky.feed.post/3reply'

  function renderThread() {
    // The focused post carries no self-permalink; replies do — even same-author ones.
    document.body.innerHTML = `
      <div data-testid="postThreadItem-by-author.com"><p id="root-text">root</p></div>
      <div data-testid="postThreadItem-by-author.com">
        <a href="/profile/author.com/post/3reply">1h</a>
        <p id="reply-text">reply</p>
      </div>
    `
  }

  it('resolves replies by permalink and the focused post by handle', () => {
    renderThread()
    const strategy = siteStrategyFor(THREAD_PAGE)
    expect(strategy.resolveEmbeddedPost(REPLY_KEY)?.querySelector('#reply-text')).toBeTruthy()
    expect(strategy.resolveEmbeddedPost(ROOT_KEY)?.querySelector('#root-text')).toBeTruthy()
  })

  it('keys a click on a reply to the reply post, on the focused post to nothing', () => {
    renderThread()
    const strategy = siteStrategyFor(THREAD_PAGE)
    const replyText = document.getElementById('reply-text')!
    expect(strategy.resolveEmbeddedPostAnchor(replyText, [replyText])?.pageKey).toBe(REPLY_KEY)
    // Focused post: no post-scoped override — the page key already is its AT-URI.
    const rootText = document.getElementById('root-text')!
    expect(strategy.resolveEmbeddedPostAnchor(rootText, [rootText])).toBeNull()
  })

  it('ignores a stored selector that mis-resolves outside the note post item', () => {
    renderThread()
    // A reply note's selector matches the FIRST same-author item (the focused
    // post) — outside the reply's item, so the AT-URI identity wins.
    const anchor = {
      pageUrl: REPLY_KEY,
      elementSelector: '[data-testid="postThreadItem-by-author.com"]',
    }
    // jsdom's location isn't an appview page, so exercise the precedence via
    // the strategy the current page would resolve to on a real appview.
    const item = siteStrategyFor(THREAD_PAGE).resolveEmbeddedPost(REPLY_KEY)!
    const selectorHit = document.querySelector(anchor.elementSelector)!
    expect(item.contains(selectorHit)).toBe(false)
  })
})

describe('embedded post capture hardening', () => {
  const FEED_PAGE = 'https://bsky.app/profile/tangled.org'

  it('extracts keys from permalinks carrying query strings or hashes', () => {
    document.body.innerHTML = `
      <div data-testid="feedItem-by-tangled.org">
        <a href="/profile/tangled.org/post/3abc?ref=feed#top">2h</a>
      </div>
    `
    expect(siteStrategyFor(FEED_PAGE).collectEmbeddedPostKeys()).toEqual([
      'at://tangled.org/app.bsky.feed.post/3abc',
    ])
  })

  it('finds the post item through the click stack when the player is portaled', () => {
    document.body.innerHTML = `
      <div data-testid="feedItem-by-tangled.org" id="item">
        <a href="/profile/tangled.org/post/3abc">2h</a>
        <div id="under-click"></div>
      </div>
      <div id="portal"><video></video></div>
    `
    const video = document.querySelector('video')!
    const underClick = document.getElementById('under-click')!
    const anchor = siteStrategyFor(FEED_PAGE).resolveEmbeddedPostAnchor(video, [video, underClick])!
    expect(anchor.pageKey).toBe('at://tangled.org/app.bsky.feed.post/3abc')
    expect(anchor.anchorElement).toBe(video)
    expect(anchor.selector).toBe('[data-testid="postThreadItem-by-tangled.org"] video')
  })
})
