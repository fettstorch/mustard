import { Extension, InputRule } from '@tiptap/core'

// Support the ordinary Markdown link form while typing in the rich-text editor.
// Destinations may be explicit HTTP(S) URLs or bare public domains. The final
// capture deliberately allows one level of balanced parentheses so common
// destinations such as Wikipedia URLs are not truncated.
const MARKDOWN_LINK_INPUT_REGEX =
  /(?:^|([^!\\]))\[([^\]\n]+)\]\((https?:\/\/(?:\\[()]|[^\s()<>\\]|\([^\s()<>]*\))+|(?:[a-z\d](?:[a-z\d-]*[a-z\d])?\.)+[a-z][a-z\d-]{1,62}(?::\d+)?(?:[/?#](?:\\[()]|[^\s()<>\\]|\([^\s()<>]*\))*)?)\)$/i

function normalizeDestination(destination: string): string {
  const unescaped = destination.replace(/\\([()])/g, '$1')
  return /^https?:\/\//i.test(unescaped) ? unescaped : `https://${unescaped}`
}

export const MarkdownLinkInput = Extension.create({
  name: 'markdownLinkInput',

  addInputRules() {
    return [
      new InputRule({
        find: MARKDOWN_LINK_INPUT_REGEX,
        handler: ({ state, range, match }) => {
          const prefix = match[1] ?? ''
          const label = match[2]
          const destination = match[3]
          const link = state.schema.marks.link
          if (!label || !destination || !link) return null
          const href = normalizeDestination(destination)

          const from = range.from + prefix.length
          const { tr } = state

          tr.insertText(label, from, range.to)
          tr.addMark(from, from + label.length, link.create({ href }))
          tr.removeStoredMark(link)
          // The built-in URL autolinker sees the destination while the rule is
          // replacing the Markdown source. Keep it from undoing the explicit mark.
          tr.setMeta('preventAutolink', true)
        },
      }),
    ]
  },
})
