/**
 * Compact, human-friendly rendering of a page URL for popup rows: drops the
 * scheme and collapses a root-only path. Falls back to the raw string if the
 * URL can't be parsed.
 */
export function displayUrl(pageUrl: string): string {
  try {
    const u = new URL(pageUrl)
    const path = u.pathname === '/' ? '' : u.pathname
    return `${u.host}${path}`
  } catch {
    return pageUrl
  }
}
