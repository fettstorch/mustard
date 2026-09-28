import { Extension, InputRule } from '@tiptap/core'

// Support the ordinary Markdown link form while typing in the rich-text editor.
// The final capture deliberately allows one level of balanced parentheses so
// common destinations such as Wikipedia URLs are not truncated.
const MARKDOWN_LINK_INPUT_REGEX =
  /(?:^|\s)\[([^\]\n]+)\]\((https?:\/\/(?:[^\s()<>]|\\[()]|\([^\s()<>]*\))+?)\)$/

export const MarkdownLinkInput = Extension.create({
  name: 'markdownLinkInput',

  addInputRules() {
    return [
      new InputRule({
        find: MARKDOWN_LINK_INPUT_REGEX,
        handler: ({ state, range, match }) => {
          const label = match[1]
          const href = match[2]
          const link = state.schema.marks.link
          if (!label || !href || !link) return null

          const leadingWhitespace = match[0].search(/\S/)
          const from = range.from + leadingWhitespace
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
