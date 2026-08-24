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
  /**
   * Canonical keys of atproto posts currently rendered inside this page
   * (a feed shows many posts, each addressable by its own key).
   */
  collectEmbeddedPostKeys?(): string[]
  /** The element rendering the given embedded post on this page, if any. */
  resolveEmbeddedPost?(pageKey: string): Element | null
  /**
   * Post-scoped anchor for a click inside an embedded post: the post's
   * canonical key, a selector that resolves on the post's own page, and the
   * element the note's relative position is measured against. Null when the
   * click wasn't inside an embedded post.
   */
  resolveEmbeddedPostAnchor?(
    target: Element,
    stack: Element[],
  ): { pageKey: string; selector: string; anchorElement: Element } | null
}

/** A strategy resolved for one concrete page: same hooks, url already bound. */
type BoundSiteStrategy = {
  getPageKey(): string
  /** Canonical key first, then any legacy keys existing notes may live under. */
  getPageKeys(): string[]
  isVideoNotePage(): boolean
  resolveTargetElement(target: Element, stack: Element[]): Element
  createSelector(element: Element): string | null
  /** Whether this page can embed independently-keyed atproto posts (feeds). */
  supportsEmbeddedPosts(): boolean
  collectEmbeddedPostKeys(): string[]
  resolveEmbeddedPost(pageKey: string): Element | null
  resolveEmbeddedPostAnchor(
    target: Element,
    stack: Element[],
  ): { pageKey: string; selector: string; anchorElement: Element } | null
}

/** Any page without site-specific needs: origin+path key, no video notes. */
const defaultStrategy: Required<SiteStrategy> = {
  matches: () => true,
  getPageKey: (url) => `${url.origin}${url.pathname}`,
  getLegacyPageKeys: () => [],
  isVideoNotePage: () => false,
  resolveTargetElement: (target) => target,
  createSelector: () => null,
  collectEmbeddedPostKeys: () => [],
  resolveEmbeddedPost: () => null,
  resolveEmbeddedPostAnchor: () => null,
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

/** Feed entries and thread items both render a post addressable by its AT-URI. */
const ATPROTO_POST_ITEM_SELECTOR =
  '[data-testid^="feedItem-by-"], [data-testid^="postThreadItem-by-"]'

/**
 * Embedded-post handling shared by every atproto surface: feeds and thread
 * pages both render posts inside testid-marked items carrying the post's
 * permalink (the focused post of a thread page is the one item without a
 * self-permalink). The AT-URI is the anchor identity — stored selectors only
 * refine a position within the resolved post item.
 */
const atprotoEmbeddedPostHooks: Pick<
  Required<SiteStrategy>,
  'collectEmbeddedPostKeys' | 'resolveEmbeddedPost' | 'resolveEmbeddedPostAnchor'
> = {
  collectEmbeddedPostKeys: () => {
    const keys = [...document.querySelectorAll(ATPROTO_POST_ITEM_SELECTOR)]
      .map(embeddedPostKey)
      .filter((key): key is string => !!key)
    return [...new Set(keys)]
  },
  resolveEmbeddedPost: (pageKey) => {
    const items = [...document.querySelectorAll(ATPROTO_POST_ITEM_SELECTOR)]
    const byPermalink = items.filter((item) => embeddedPostKey(item) === pageKey)
    if (byPermalink.length > 0) return preferLaidOut(byPermalink)
    // A thread page's focused post carries no self-permalink — identify it by
    // its author handle among the permalink-less items.
    const atUri = AT_URI_POST.exec(pageKey)
    if (!atUri) return null
    const byHandle = items.filter(
      (item) => postItemHandle(item) === atUri[1] && !embeddedPostKey(item),
    )
    return byHandle.length > 0 ? preferLaidOut(byHandle) : null
  },
  resolveEmbeddedPostAnchor: (target, stack) => {
    // Players can be portaled outside the post item's DOM subtree — the
    // click stack still contains the item rendered underneath the video.
    const item =
      target.closest(ATPROTO_POST_ITEM_SELECTOR) ??
      stack.map((el) => el.closest(ATPROTO_POST_ITEM_SELECTOR)).find(Boolean) ??
      null
    // No permalink means the thread page's focused post: the page key already
    // IS that post's AT-URI, so no post-scoped override is needed.
    const pageKey = item && embeddedPostKey(item)
    if (!item || !pageKey) return null
    const handle = postItemHandle(item)
    const isVideo = isVideoElement(target)
    return {
      pageKey,
      // A selector that resolves on the post's own page; other surfaces
      // re-anchor via resolveEmbeddedPost instead.
      selector: `[data-testid="postThreadItem-by-${escapeAttributeValue(handle)}"]${isVideo ? ' video' : ''}`,
      anchorElement: isVideo ? target : item,
    }
  },
}

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
  ...atprotoEmbeddedPostHooks,
  createSelector: (element) => {
    if (!isVideoElement(element)) return null
    const postItem = element.closest('[data-testid]')
    const testId = postItem?.getAttribute('data-testid')
    if (testId) {
      const selector = `[data-testid="${escapeAttributeValue(testId)}"] video`
      // Same-author posts share a testid: the selector only counts as an
      // address when the clicked video is its one and only match — matching
      // first among several would re-anchor to the wrong video on reorder.
      const matches = document.querySelectorAll(selector)
      if (matches.length === 1 && matches[0] === element) return selector
    }
    return uniqueVideoSelector(element)
  },
}

/**
 * Every other page on an atproto appview (home, profiles, custom feeds):
 * posts embedded in these feeds are addressable by their own canonical
 * AT-URIs — notes created on a post surface wherever the post appears, and a
 * note created on an embedded post is keyed to the post, not the feed page.
 * Notes on the page itself (outside any post) keep the appview's URL key, so
 * they stay appview-specific.
 */
const atprotoFeed: SiteStrategy = {
  matches: (url) => ATPROTO_APPVIEW_HOSTS.has(stripWww(url.hostname)),
  // Feed videos are post videos, so timed notes are available here too.
  isVideoNotePage: () => true,
  resolveTargetElement: resolveVideoFromClickStack,
  ...atprotoEmbeddedPostHooks,
}

/** Ordered by specificity; the catch-all default closes the table. */
const SITE_STRATEGIES: SiteStrategy[] = [
  youtubeWatch,
  streamPlaceVod,
  twitchVod,
  twitchClip,
  atprotoPost,
  atprotoFeed,
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
    supportsEmbeddedPosts: () =>
      strategy.collectEmbeddedPostKeys !== defaultStrategy.collectEmbeddedPostKeys,
    collectEmbeddedPostKeys: () => strategy.collectEmbeddedPostKeys(),
    resolveEmbeddedPost: (pageKey) => strategy.resolveEmbeddedPost(pageKey),
    resolveEmbeddedPostAnchor: (target, stack) => strategy.resolveEmbeddedPostAnchor(target, stack),
  }
}

/**
 * Resolves the element a note is anchored to on the CURRENT page. The stored
 * selector wins; when it doesn't resolve (a post note viewed inside a feed),
 * the note's post is looked up among the page's embedded posts. Null when
 * neither resolves — such notes must not fall back to absolute positioning,
 * which belongs to the page the note was created on.
 */
export function resolveAnchoredElement(anchor: {
  pageUrl: string
  elementSelector: string | null
}): Element | null {
  const selectorElement = anchor.elementSelector
    ? document.querySelector(anchor.elementSelector)
    : null
  if (!anchor.pageUrl.startsWith('at://')) return selectorElement

  // Post-keyed notes: the AT-URI is the anchor identity. The stored selector
  // only refines the position WITHIN the resolved post item — a selector that
  // resolves outside it has mis-resolved (e.g. a same-author thread item) and
  // is ignored in favor of the item itself.
  const postItem = siteStrategyFor(window.location.href).resolveEmbeddedPost(anchor.pageUrl)
  if (!postItem) return selectorElement
  if (selectorElement && postItem.contains(selectorElement)) return selectorElement
  return anchor.elementSelector?.endsWith('video')
    ? (postItem.querySelector('video') ?? postItem)
    : postItem
}

//--- module private utility

/** Canonical AT-URI of the post an embedded feed item renders, from its permalink. */
function embeddedPostKey(item: Element): string | null {
  const links = item.querySelectorAll('a[href*="/post/"]')
  for (const link of links) {
    // Parse the href so query strings, hashes, or absolute forms can't break
    // the path match.
    const href = link.getAttribute('href')
    if (!href) continue
    let pathname: string
    try {
      pathname = new URL(href, window.location.origin).pathname
    } catch {
      continue
    }
    const match = ATPROTO_POST_PATH.exec(pathname)
    if (match) return `at://${match[1]}/app.bsky.feed.post/${match[2]}`
  }
  return null
}

/**
 * Retained navigation-stack screens can leave hidden duplicates of a post
 * item in the DOM — prefer a match that actually has layout.
 */
function preferLaidOut(candidates: Element[]): Element {
  return candidates.find((el) => el.getClientRects().length > 0) ?? candidates[0]!
}

/** The author handle a post item's testid carries. */
function postItemHandle(item: Element): string {
  return (item.getAttribute('data-testid') ?? '').replace(/^(?:feedItem|postThreadItem)-by-/, '')
}

/** Quoted attribute value: only quotes and backslashes need escaping. */
function escapeAttributeValue(value: string): string {
  return value.replace(/["\\]/g, '\\$&')
}

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
