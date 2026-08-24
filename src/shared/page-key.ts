import { siteStrategyFor } from './site-strategies'

/** Resolves the canonical key used to address notes for a page. */
export function getPageKey(pageUrl: string): string {
  return siteStrategyFor(pageUrl).getPageKey()
}
