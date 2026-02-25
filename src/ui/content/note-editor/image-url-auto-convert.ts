import { Extension, nodePasteRule, nodeInputRule } from '@tiptap/core'

/**
 * Matches bare image URLs by file extension.
 * Supports: .png, .jpg, .jpeg, .gif, .webp
 * Optionally followed by Twitter/X size suffix, query params, or fragments.
 */
const IMAGE_URL_PASTE_REGEX =
  /https?:\/\/[^\s]+\.(?:png|jpe?g|gif|webp)(?::(?:large|medium|small|orig|thumb))?(?:\?[^\s]*)?(?:#[^\s]*)?/gi

const IMAGE_URL_INPUT_REGEX =
  /https?:\/\/[^\s]+\.(?:png|jpe?g|gif|webp)(?::(?:large|medium|small|orig|thumb))?(?:\?[^\s]*)?(?:#[^\s]*)?\s$/

/**
 * Auto-converts bare image URLs to Image nodes.
 * - Paste: immediate conversion
 * - Input: converts when URL is followed by a space
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
})
