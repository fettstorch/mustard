import { describe, expect, it } from 'vitest'
import { renderContent } from '../../../../src/ui/content/note/render-content'

describe('renderContent code blocks', () => {
  it('highlights a TypeScript fenced block', () => {
    const markdown = ['```ts', 'const answer: number = 42', '```'].join('\n')

    const rendered = renderContent(markdown)

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
