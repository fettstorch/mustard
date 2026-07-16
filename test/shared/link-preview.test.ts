import { describe, expect, it } from 'vitest'
import {
  extractFirstLinkUrl,
  extractLinkPreview,
  normalizeHttpUrl,
} from '../../src/shared/link-preview'

describe('extractFirstLinkUrl', () => {
  it('selects the first link and removes prose punctuation', () => {
    expect(extractFirstLinkUrl('Read https://example.com/article. Then reply.')).toBe(
      'https://example.com/article',
    )
  })

  it('keeps a balanced closing parenthesis in a URL', () => {
    expect(extractFirstLinkUrl('https://en.wikipedia.org/wiki/Foo_(bar)')).toBe(
      'https://en.wikipedia.org/wiki/Foo_(bar)',
    )
  })

  it('normalizes bare domains to HTTPS without mistaking email domains for links', () => {
    expect(extractFirstLinkUrl('Read github.com/fettstorch/mustard.')).toBe(
      'https://github.com/fettstorch/mustard',
    )
    expect(extractFirstLinkUrl('Email julian@github.com, then visit github.com.')).toBe(
      'https://github.com/',
    )
  })

  it('skips every bare-domain match inside an email address', () => {
    expect(extractFirstLinkUrl('Email first.last@example.com.')).toBeUndefined()
    expect(extractFirstLinkUrl('Email first.last@example.com, then visit mustardnotes.com.')).toBe(
      'https://mustardnotes.com/',
    )
  })

  it('skips URLs and bare domains inside fenced and inline code', () => {
    expect(
      extractFirstLinkUrl(
        ['```ts', 'foo.bar', '```', 'https://preview.example/after-code'].join('\n'),
      ),
    ).toBe('https://preview.example/after-code')
    expect(extractFirstLinkUrl('Call `client.invoke()` then preview.example/article.')).toBe(
      'https://preview.example/article',
    )
  })

  it('skips Markdown image sources but keeps later prose links previewable', () => {
    expect(
      extractFirstLinkUrl(
        '![Giphy GIF](https://media.giphy.com/media/reaction/giphy.gif) https://example.com/article',
      ),
    ).toBe('https://example.com/article')
    expect(
      extractFirstLinkUrl('![](https://media.giphy.com/media/reaction/giphy.gif)'),
    ).toBeUndefined()
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

  it('preserves a long signed Open Graph image URL', () => {
    const imageUrl = `https://cdn.example.com/preview.webp?signature=${'a'.repeat(400)}`
    const preview = extractLinkPreview(
      `<meta property="og:image" content="${imageUrl}">`,
      'https://example.com/',
    )

    expect(preview).toEqual({ url: 'https://example.com/', imageUrl })
  })
})
