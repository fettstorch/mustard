import { describe, expect, it } from 'vitest'
import {
  extractFirstLinkUrl,
  extractLinkPreview,
  normalizeHttpUrl,
} from '../../src/shared/link-preview'

describe('extractFirstLinkUrl', () => {
  it('selects the first HTTP(S) URL and removes prose punctuation', () => {
    expect(extractFirstLinkUrl('Read https://example.com/article. Then reply.')).toBe(
      'https://example.com/article',
    )
  })

  it('keeps a balanced closing parenthesis in a URL', () => {
    expect(extractFirstLinkUrl('https://en.wikipedia.org/wiki/Foo_(bar)')).toBe(
      'https://en.wikipedia.org/wiki/Foo_(bar)',
    )
  })

  it('rejects non-web schemes', () => {
    expect(extractFirstLinkUrl('javascript:alert(1)')).toBeUndefined()
    expect(normalizeHttpUrl('ftp://example.com')).toBeUndefined()
  })
})

describe('extractLinkPreview', () => {
  it('reads and sanitizes Open Graph metadata', () => {
    const preview = extractLinkPreview(
      [
        '<meta property="og:title" content="Mustard &amp; Chips">',
        '<meta property="og:description" content="A &lt;very&gt; good read">',
        '<meta property="og:site_name" content="The Mustard Times">',
        '<meta property="og:image" content="/preview.png">',
      ].join(''),
      'https://example.com/read?via=mustard',
      'https://cdn.example.com/articles/123',
    )

    expect(preview).toEqual({
      url: 'https://example.com/read?via=mustard',
      title: 'Mustard & Chips',
      description: 'A good read',
      siteName: 'The Mustard Times',
      imageUrl: 'https://cdn.example.com/preview.png',
    })
  })

  it('falls back to the document title and ignores unsafe image URLs', () => {
    const preview = extractLinkPreview(
      '<title> An ordinary page </title><meta property="og:image" content="javascript:alert(1)">',
      'https://example.com/',
    )

    expect(preview).toEqual({ url: 'https://example.com/', title: 'An ordinary page' })
  })
})
