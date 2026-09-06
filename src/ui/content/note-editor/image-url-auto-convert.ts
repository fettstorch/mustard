import { Extension, nodePasteRule, nodeInputRule } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { TextSelection } from '@tiptap/pm/state'
import { IMAGE_URL_PATTERN } from '@/shared/image-url'

/**
 * Matches bare image URLs supported by the shared note renderer, including
 * extensionless Bluesky CDN image routes.
 */
const IMAGE_URL_PASTE_REGEX = new RegExp(IMAGE_URL_PATTERN, 'gi')

const IMAGE_URL_INPUT_REGEX = new RegExp(String.raw`${IMAGE_URL_PATTERN}\s$`, 'i')

/**
 * Auto-converts bare image URLs to Image nodes.
 * - Paste: immediate conversion
 * - Input: converts when URL is followed by a space
 *
 * Includes a ProseMirror plugin that ensures a paragraph exists after the last
 * image so the cursor has somewhere to land (otherwise typing/pasting after an
 * image replaces or ignores it).
 */
export const ImageUrlAutoConvert = Extension.create({
  name: 'imageUrlAutoConvert',

  addPasteRules() {
    return [
      nodePasteRule({
        find: IMAGE_URL_PASTE_REGEX,
        type: this.editor.schema.nodes.image!,
        getAttributes: (match) => ({ src: match[0] }),
      }),
    ]
  },

  addInputRules() {
    return [
      nodeInputRule({
        find: IMAGE_URL_INPUT_REGEX,
        type: this.editor.schema.nodes.image!,
        getAttributes: (match) => ({ src: match[0].trim() }),
      }),
    ]
  },

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: new PluginKey('ensureParagraphAfterImage'),
        appendTransaction(transactions, _oldState, newState) {
          if (!transactions.some((tr) => tr.docChanged)) return null

          const { doc, schema } = newState
          const lastChild = doc.lastChild
          if (!lastChild || lastChild.type.name !== 'image') return null

          const pos = doc.content.size
          const tr = newState.tr
          tr.insert(pos, schema.nodes.paragraph!.create())
          tr.setSelection(TextSelection.create(tr.doc, pos + 1))
          return tr
        },
      }),
    ]
  },
})
