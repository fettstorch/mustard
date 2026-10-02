import { Extension } from '@tiptap/core'
import { Decoration, DecorationSet } from '@tiptap/pm/view'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { visibleEmojiMatches } from '@/shared/emoji-presentation'

/** Contrast treatment in the editable view; saved Markdown remains plain Unicode. */
export const EmojiDecoration = Extension.create({
  name: 'emojiDecoration',
  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: new PluginKey('emojiDecoration'),
        props: {
          decorations(state) {
            const decorations: Decoration[] = []
            state.doc.descendants((node, pos) => {
              if (node.type.spec.code) return false
              if (!node.isText || node.marks.some((mark) => mark.type.name === 'code')) return
              for (const match of visibleEmojiMatches(node.text ?? '')) {
                decorations.push(
                  Decoration.inline(pos + match.index!, pos + match.index! + match[0].length, {
                    class: 'mustard-emoji',
                  }),
                )
              }
            })
            return DecorationSet.create(state.doc, decorations)
          },
        },
      }),
    ]
  },
})
