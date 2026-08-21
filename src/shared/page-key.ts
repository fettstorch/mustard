import { when } from '@fettstorch/jule'

/**
 * Resolves the canonical key used to address notes for a page.
 *
 * Most pages are identified by origin and pathname. YouTube watch pages are
 * identified by their video id so that unrelated watch-query parameters do
 * not split one video's notes across multiple page keys.
 */
export function getPageKey(url: string): string {
  const pageUrl = new URL(url)
  const strategyKey = `${pageUrl.hostname.replace(/^www\./, '')}${pageUrl.pathname}`

  return when(strategyKey)({
    'youtube.com/watch': () => getYoutubePageKey(pageUrl),
    else: () => getDefaultPageKey(pageUrl),
  })
}

function getYoutubePageKey(pageUrl: URL): string {
  const videoId = pageUrl.searchParams.get('v')

  return videoId?.trim()
    ? `${pageUrl.origin}${pageUrl.pathname}?v=${encodeURIComponent(videoId)}`
    : getDefaultPageKey(pageUrl)
}

function getDefaultPageKey(pageUrl: URL): string {
  return `${pageUrl.origin}${pageUrl.pathname}`
}
