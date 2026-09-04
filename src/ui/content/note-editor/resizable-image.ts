import { Image } from '@tiptap/extension-image'
import { ResizableNodeView } from '@tiptap/core'

const SIZE_TITLE_PREFIX = 'mustard:image-width='
const MIN_IMAGE_WIDTH = 48
const MAX_IMAGE_WIDTH = 2_000

/**
 * Store image width in the existing Markdown image title slot. Old clients
 * still render a valid image (with an admittedly technical tooltip), while new
 * clients restore the width without a database or DTO change.
 */
export function parseImageWidth(title: unknown): number | undefined {
  if (typeof title !== 'string' || !title.startsWith(SIZE_TITLE_PREFIX)) return undefined

  const width = Number(title.slice(SIZE_TITLE_PREFIX.length))
  if (!Number.isInteger(width) || width < MIN_IMAGE_WIDTH || width > MAX_IMAGE_WIDTH) {
    return undefined
  }
  return width
}

export function serializeImageWidth(width: unknown): string | undefined {
  if (typeof width !== 'number' || !Number.isFinite(width)) return undefined
  const rounded = Math.round(width)
  if (rounded < MIN_IMAGE_WIDTH || rounded > MAX_IMAGE_WIDTH) return undefined
  return `${SIZE_TITLE_PREFIX}${rounded}`
}

/** Tiptap's Image node with resize dimensions preserved by Markdown. */
export const ResizableImage = Image.extend({
  parseMarkdown: (token, helpers) => {
    const width = parseImageWidth(token.title)
    return helpers.createNode('image', {
      src: token.href,
      alt: token.text,
      title: width === undefined ? token.title : null,
      width: width ?? null,
    })
  },

  renderMarkdown: (node) => {
    const src = node.attrs?.src ?? ''
    const alt = node.attrs?.alt ?? ''
    const sizeTitle = serializeImageWidth(node.attrs?.width)
    const title = sizeTitle ?? node.attrs?.title ?? ''

    return title ? `![${alt}](${src} "${title}")` : `![${alt}](${src})`
  },

  addNodeView() {
    if (!this.options.resize || !this.options.resize.enabled || typeof document === 'undefined') {
      return null
    }

    const { directions, minWidth, minHeight, alwaysPreserveAspectRatio } = this.options.resize

    return ({ node, getPos, HTMLAttributes, editor }) => {
      const image = document.createElement('img')
      const imageAttributes = { ...this.options.HTMLAttributes, ...HTMLAttributes }
      Object.entries(imageAttributes).forEach(([key, value]) => {
        if (value != null && key !== 'width' && key !== 'height') {
          image.setAttribute(key, String(value))
        }
      })
      image.src = String(imageAttributes.src)
      const configuredMaxWidth = Number.parseFloat(getComputedStyle(editor.view.dom).maxWidth)
      const maxWidth = Number.isFinite(configuredMaxWidth)
        ? configuredMaxWidth
        : editor.view.dom.clientWidth

      const nodeView = new ResizableNodeView({
        element: image,
        editor,
        node,
        getPos,
        onResize: (width, height) => {
          image.style.width = `${width}px`
          image.style.height = `${height}px`
        },
        onCommit: (width, height) => {
          const pos = getPos()
          if (pos === undefined) return

          editor.chain().setNodeSelection(pos).updateAttributes(this.name, { width, height }).run()
        },
        onUpdate: (updatedNode) => updatedNode.type === node.type,
        options: {
          directions,
          min: { width: minWidth, height: minHeight },
          // The stock Image extension leaves this unbounded. Use the CSS cap,
          // not the editor's narrower initial width, so it can grow up to it.
          max: { width: Math.max(MIN_IMAGE_WIDTH, maxWidth) },
          preserveAspectRatio: alwaysPreserveAspectRatio === true,
        },
      })

      const dom = nodeView.dom as HTMLElement
      dom.style.visibility = 'hidden'
      dom.style.pointerEvents = 'none'
      const revealNodeView = () => {
        dom.style.visibility = ''
        dom.style.pointerEvents = ''
      }
      image.onload = revealNodeView
      image.onerror = revealNodeView

      return nodeView
    }
  },
})
