import { isVideoElement } from './video-element'

/**
 * Per-site handling for the parts of the note-creation flow that need it.
 * Site strategies override only the hooks they need; every other hook comes
 * from the default strategy, which is itself declared in the table below —
 * the full behavior story lives here, defaults included.
 *
 * Usage: resolve once with `siteStrategyFor(pageUrl)`, then call the hooks on
 * the returned strategy.
 */
type SiteStrategy = {
  /** Which pages this strategy governs. */
  matches(url: URL): boolean
  /** Canonical key notes are stored and queried under. */
  getPageKey?(url: URL): string
  /**
   * Keys this page's notes were stored under before the canonical key changed
   * (e.g. appview URLs from before AT-URI keying). New notes never use these;
   * loading and focus matching still honor them.
   */
  getLegacyPageKeys?(url: URL): string[]
  /** Whether timed video-note authoring is offered on this page. */
  isVideoNotePage?(url: URL): boolean
  /**
   * Re-resolve which element a click was aimed at. `stack` is the full
   * elementsFromPoint stack under the click, topmost first.
   */
  resolveTargetElement?(target: Element, stack: Element[]): Element
  /**
   * Site-aware selector for the chosen element. Null means "no opinion" —
   * the caller falls back to its generic DOM-path selector.
   */
  createSelector?(element: Element): string | null
}

/** A strategy resolved for one concrete page: same hooks, url already bound. */
type BoundSiteStrategy = {
  getPageKey(): string
  /** Canonical key first, then any legacy keys existing notes may live under. */
  getPageKeys(): string[]
  isVideoNotePage(): boolean
  resolveTargetElement(target: Element, stack: Element[]): Element
  createSelector(element: Element): string | null
}

/** Any page without site-specific needs: origin+path key, no video notes. */
const defaultStrategy: Required<SiteStrategy> = {
  matches: () => true,
  getPageKey: (url) => `${url.origin}${url.pathname}`,
  getLegacyPageKeys: () => [],
  isVideoNotePage: () => false,
  resolveTargetElement: (target) => target,
  createSelector: () => null,
}

/**
 * YouTube watch pages: the video id lives in the `v` query param, so the
 * default origin-plus-pathname key would merge every video into one page.
 * Keep the id (and only the id) in the key.
 */
const youtubeWatch: SiteStrategy = {
  matches: (url) => stripWww(url.hostname) === 'youtube.com' && url.pathname === '/watch',
  getPageKey: (url) => {
    const videoId = url.searchParams.get('v')
    return videoId?.trim()
      ? `${url.origin}${url.pathname}?v=${encodeURIComponent(videoId)}`
      : defaultStrategy.getPageKey(url)
  },
  isVideoNotePage: (url) => !!url.searchParams.get('v')?.trim(),
}

/**
 * stream.place VODs (`/{handle}/video/{id}`; live streams stay excluded —
 * their playback clock doesn't persist). The player chrome overlays the
 * <video>, so a click "on the video" lands on an anonymous div; and the DOM
 * around the player is generated (no stable ids or classes), so the bare tag
 * selector is the only stable address for the page's single video.
 */
const streamPlaceVod: SiteStrategy = {
  matches: (url) =>
    stripWww(url.hostname) === 'stream.place' && /^\/[^/]+\/video\/[^/]+$/.test(url.pathname),
  isVideoNotePage: () => true,
  resolveTargetElement: resolveVideoFromClickStack,
  createSelector: uniqueVideoSelector,
}

/**
 * Twitch VODs (`/videos/{id}`); live streams (`/{channel}`) stay excluded —
 * their playback clock doesn't persist. The player has the same shape as
 * stream.place's: chrome overlays the single <video>, and the surrounding DOM
 * is generated styled-components markup with no stable ids or classes.
 */
const twitchVod: SiteStrategy = {
  matches: (url) =>
    stripWww(url.hostname) === 'twitch.tv' && /^\/videos\/[^/]+$/.test(url.pathname),
  isVideoNotePage: () => true,
  resolveTargetElement: resolveVideoFromClickStack,
  createSelector: uniqueVideoSelector,
}

/**
 * Twitch clips (`/{channel}/clip/{slug}`; the clips.twitch.tv share domain
 * redirects here). Today the clip player happens to share the VOD player's
 * shape, but clips are a separate Twitch feature that can evolve on its own —
 * hence its own strategy.
 */
const twitchClip: SiteStrategy = {
  matches: (url) =>
    stripWww(url.hostname) === 'twitch.tv' && /^\/[^/]+\/clip\/[^/]+$/.test(url.pathname),
  isVideoNotePage: () => true,
  resolveTargetElement: resolveVideoFromClickStack,
  createSelector: uniqueVideoSelector,
}

/**
 * Appviews known to render atproto posts with bsky.app's page shape and DOM
 * (same-codebase forks). One line per appview — the strategy itself is shared.
 */
const ATPROTO_APPVIEW_HOSTS = new Set([
  'bsky.app',
  'mu.social',
  'deer.social',
  'witchsky.app',
  'blacksky.community',
])

const ATPROTO_POST_PATH = /^\/profile\/([^/]+)\/post\/([^/]+)$/

/**
 * Atproto post pages. The same post is viewable on any appview
 * (bsky.app/profile/x/post/y ≙ mu.social/profile/x/post/y), so notes are
 * keyed by the post's canonical AT-URI instead of the appview's URL — a note
 * created on one appview surfaces on all of them. The handle stands in for
 * the DID (resolving the DID would need a network call at key time).
 *
 * The post's video sits under overlay chrome like the other curated players,
 * but a thread page can hold several videos (replies, quotes) — so the
 * selector is scoped to the enclosing post item via the appview's stable
 * `data-testid` markers, falling back to the bare tag when the video is the
 * page's only one.
 */
const atprotoPost: SiteStrategy = {
  matches: (url) =>
    ATPROTO_APPVIEW_HOSTS.has(stripWww(url.hostname)) && ATPROTO_POST_PATH.test(url.pathname),
  getPageKey: (url) => {
    const [, handle, rkey] = ATPROTO_POST_PATH.exec(url.pathname)!
    return `at://${handle}/app.bsky.feed.post/${rkey}`
  },
  // Notes created before AT-URI keying live under the appview's own URL.
  getLegacyPageKeys: (url) => [defaultStrategy.getPageKey(url)],
  isVideoNotePage: () => true,
  resolveTargetElement: resolveVideoFromClickStack,
  createSelector: (element) => {
    if (!isVideoElement(element)) return null
    const postItem = element.closest('[data-testid]')
    const testId = postItem?.getAttribute('data-testid')
    if (testId) {
      // Quoted attribute value: only quotes and backslashes need escaping.
      const selector = `[data-testid="${testId.replace(/["\\]/g, '\\$&')}"] video`
      // Same-author posts share a testid: the selector only counts as an
      // address when the clicked video is its one and only match — matching
      // first among several would re-anchor to the wrong video on reorder.
      const matches = document.querySelectorAll(selector)
      if (matches.length === 1 && matches[0] === element) return selector
    }
    return uniqueVideoSelector(element)
  },
}

/** Ordered by specificity; the catch-all default closes the table. */
const SITE_STRATEGIES: SiteStrategy[] = [
  youtubeWatch,
  streamPlaceVod,
  twitchVod,
  twitchClip,
  atprotoPost,
  defaultStrategy,
]

const AT_URI_POST = /^at:\/\/([^/]+)\/app\.bsky\.feed\.post\/([^/]+)$/

/**
 * Converts a canonical page key into a URL a browser tab can open. AT-URI
 * keys open on bsky.app (the reference appview); every other key already is
 * its page's URL.
 */
export function pageKeyToHref(pageKey: string): string {
  const atUriPost = AT_URI_POST.exec(pageKey)
  return atUriPost ? `https://bsky.app/profile/${atUriPost[1]}/post/${atUriPost[2]}` : pageKey
}

/**
 * Resolves the page's strategy once: the most specific match, completed with
 * the default's hooks and bound to the given url. An unparseable url gets the
 * default strategy (its page key is the raw string, since there is nothing to
 * normalize).
 */
export function siteStrategyFor(pageUrl: string): BoundSiteStrategy {
  const url = toUrl(pageUrl)
  const strategy = url
    ? { ...defaultStrategy, ...SITE_STRATEGIES.find((candidate) => candidate.matches(url))! }
    : defaultStrategy

  return {
    getPageKey: () => (url ? strategy.getPageKey(url) : pageUrl),
    getPageKeys: () =>
      url ? [strategy.getPageKey(url), ...strategy.getLegacyPageKeys(url)] : [pageUrl],
    isVideoNotePage: () => !!url && strategy.isVideoNotePage(url),
    resolveTargetElement: (target, stack) => strategy.resolveTargetElement(target, stack),
    createSelector: (element) => strategy.createSelector(element),
  }
}

//--- module private utility

/** Shared hook: prefer the video hidden under player chrome at the click point. */
function resolveVideoFromClickStack(target: Element, stack: Element[]): Element {
  return isVideoElement(target) ? target : (stack.find(isVideoElement) ?? target)
}

/** Shared hook: the bare tag is the stable address when the page has one video. */
function uniqueVideoSelector(element: Element): string | null {
  return isVideoElement(element) && document.querySelectorAll('video').length === 1 ? 'video' : null
}

function stripWww(hostname: string): string {
  return hostname.replace(/^www\./, '')
}

function toUrl(pageUrl: string): URL | undefined {
  try {
    return new URL(pageUrl)
  } catch {
    return undefined
  }
}
