import { describe, expect, it } from 'vitest'
import { displayUrl, pageFaviconUrl } from '@/shared/display-url'

describe('displayUrl', () => {
  it('renders a compact page URL', () => {
    expect(displayUrl('https://example.com/article')).toBe('example.com/article')
  })
})

describe('pageFaviconUrl', () => {
  it('uses the page origin for the conventional favicon path', () => {
    expect(pageFaviconUrl('https://example.com:8443/article?id=1')).toBe(
      'https://example.com:8443/favicon.ico',
    )
  })

  it('rejects unsupported and invalid page keys', () => {
    expect(pageFaviconUrl('at://did:plc:test/app.bsky.feed.post/123')).toBeNull()
    expect(pageFaviconUrl('not a URL')).toBeNull()
  })
})
