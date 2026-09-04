import { describe, expect, it } from 'vitest'
import { Editor } from '@tiptap/core'
import { Markdown } from '@tiptap/markdown'
import StarterKit from '@tiptap/starter-kit'
import MarkdownIt from 'markdown-it'
import {
  parseImageWidth,
  ResizableImage,
  serializeMarkdownImage,
  serializeImageWidth,
} from '../../../../src/ui/content/note-editor/resizable-image'

describe('resizable image Markdown metadata', () => {
  it('round-trips a valid image width', () => {
    const title = serializeImageWidth(247.6)

    expect(title).toBe('mustard:image-width=248')
    expect(parseImageWidth(title)).toBe(248)
  })

  it('leaves ordinary and invalid image titles alone', () => {
    expect(parseImageWidth('An ordinary title')).toBeUndefined()
    expect(parseImageWidth('mustard:image-width=0')).toBeUndefined()
    expect(parseImageWidth('mustard:image-width=not-a-number')).toBeUndefined()
  })

  it('preserves Markdown-significant image attributes', () => {
    const markdown = serializeMarkdownImage({
      src: 'https://example.com/image.png?label=<foo)>',
      alt: String.raw`a [useful] \ label`,
      title: String.raw`a "quoted" \ title`,
    })
    const image = new MarkdownIt().parse(markdown, {}).find((token) => token.type === 'inline')
      ?.children?.[0]
    const editor = new Editor({
      extensions: [StarterKit, ResizableImage, Markdown],
      content: markdown,
      contentType: 'markdown',
    })

    expect(image?.type).toBe('image')
    expect(image?.attrGet('src')).toBe('https://example.com/image.png?label=%3Cfoo)%3E')
    expect(image?.attrGet('title')).toBe(String.raw`a "quoted" \ title`)
    expect(editor.getJSON().content?.[0]?.attrs).toMatchObject({
      src: 'https://example.com/image.png?label=<foo)>',
      alt: String.raw`a [useful] \ label`,
      title: String.raw`a "quoted" \ title`,
    })
    editor.destroy()
  })

  it('keeps resize metadata attached to URLs with unmatched parentheses', () => {
    const markdown = serializeMarkdownImage({
      src: 'https://example.com/image.png?x=foo)',
      width: 248,
    })
    const children = new MarkdownIt()
      .parse(markdown, {})
      .find((token) => token.type === 'inline')?.children

    expect(children).toHaveLength(1)
    expect(children?.[0]?.attrGet('src')).toBe('https://example.com/image.png?x=foo)')
    expect(children?.[0]?.attrGet('title')).toBe('mustard:image-width=248')
  })
})
