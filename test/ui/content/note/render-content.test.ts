import { describe, expect, it } from 'vitest'
import { highlightCode } from '../../../../src/ui/content/note/code-highlighting'
import { renderContent } from '../../../../src/ui/content/note/render-content'

describe('highlightCode', () => {
  it.each([
    ['Rust', 'rust', 'rs', 'fn main() {}'],
    ['C++', 'cpp', 'c++', 'int main() { return 0; }'],
    ['Haskell', 'haskell', 'hs', 'module Main where'],
  ])('highlights %s with its canonical name and alias', (_name, language, alias, source) => {
    expect(highlightCode(source, language)).toContain('hljs-')
    expect(highlightCode(source, alias)).toContain('hljs-')
  })
})

describe('renderContent code blocks', () => {
  it('highlights a TypeScript fenced block', () => {
    const markdown = ['```ts', 'const answer: number = 42', '```'].join('\n')

    const rendered = renderContent(markdown)

    expect(rendered).toContain('<pre><code class="language-ts">')
    expect(rendered).toContain('hljs-keyword')
  })

  it('highlights a TypeScript fenced block following prose', () => {
    const markdown = ['Some text', '```ts', 'const answer: number = 42', '```'].join('\n')

    const rendered = renderContent(markdown)

    expect(rendered).toContain('<p>Some text</p>')
    expect(rendered).toContain('<pre><code class="language-ts">')
    expect(rendered).toContain('hljs-keyword')
  })

  it('safely renders an unsupported language without highlighting', () => {
    const markdown = ['```unknown', '<script>alert("nope")</script>', '```'].join('\n')

    const rendered = renderContent(markdown)

    expect(rendered).toContain('&lt;script&gt;')
    expect(rendered).not.toContain('<script>')
    expect(rendered).not.toContain('hljs-')
  })
})

describe('renderContent resized images', () => {
  it('renders persisted width metadata without exposing it as a tooltip', () => {
    const rendered = renderContent(
      '![](https://example.com/cat.gif "mustard:image-width=248")',
    )

    expect(rendered).toContain('width="248"')
    expect(rendered).not.toContain('mustard:image-width')
  })

  it('keeps legacy images full-width by omitting a width attribute', () => {
    const rendered = renderContent('![](https://example.com/cat.gif)')

    expect(rendered).not.toContain('width=')
  })
})
