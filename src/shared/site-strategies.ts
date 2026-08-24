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
  isVideoNotePage(): boolean
  resolveTargetElement(target: Element, stack: Element[]): Element
  createSelector(element: Element): string | null
}

/** Any page without site-specific needs: origin+path key, no video notes. */
const defaultStrategy: Required<SiteStrategy> = {
  matches: () => true,
  getPageKey: (url) => `${url.origin}${url.pathname}`,
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
  resolveTargetElement: (target, stack) =>
    isVideoElement(target) ? target : (stack.find(isVideoElement) ?? target),
  createSelector: (element) =>
    isVideoElement(element) && document.querySelectorAll('video').length === 1 ? 'video' : null,
}

/** Ordered by specificity; the catch-all default closes the table. */
const SITE_STRATEGIES: SiteStrategy[] = [youtubeWatch, streamPlaceVod, defaultStrategy]

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
    isVideoNotePage: () => !!url && strategy.isVideoNotePage(url),
    resolveTargetElement: (target, stack) => strategy.resolveTargetElement(target, stack),
    createSelector: (element) => strategy.createSelector(element),
  }
}

//--- module private utility

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
