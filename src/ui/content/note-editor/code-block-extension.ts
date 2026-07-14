import { InputRule } from '@tiptap/core'
import { CodeBlockLowlight } from '@tiptap/extension-code-block-lowlight'
import { Fragment } from '@tiptap/pm/model'
import { TextSelection } from '@tiptap/pm/state'

const fenceAfterHardBreakRegex = /\n(```|~~~)([a-z0-9_+#.-]+)?[\t \n]$/i

/**
 * TipTap's built-in fence rule is anchored to the start of a paragraph. A
 * Shift+Enter hard break keeps the following fence in the same paragraph, so
 * split that paragraph and replace the fence with a real code-block node.
 */
export const CodeBlockLowlightWithHardBreakFence = CodeBlockLowlight.extend({
  addInputRules() {
    const hardBreakFenceRule = new InputRule({
      find: (text) => {
        const match = fenceAfterHardBreakRegex.exec(text)
        if (!match || !text.slice(0, match.index).trim()) return null

        return {
          text: match[0].slice(1),
          index: match.index + 1,
          data: { language: match[2] || null },
        }
      },
      handler: ({ state, range, match }) => {
        const $fence = state.doc.resolve(range.from)
        const $fenceEnd = state.doc.resolve(range.to)
        const paragraph = $fence.parent

        if (!paragraph.isTextblock || paragraph.type.spec.code || $fenceEnd.parent !== paragraph) {
          return null
        }

        let hardBreakOffset: number | undefined
        paragraph.forEach((node, offset) => {
          if (node.type.name === 'hardBreak' && offset + node.nodeSize === $fence.parentOffset) {
            hardBreakOffset = offset
          }
        })

        if (hardBreakOffset === undefined) return null

        const precedingContent = paragraph.content.cut(0, hardBreakOffset)
        if (!precedingContent.size) return null

        const precedingParagraph = paragraph.type.create(paragraph.attrs, precedingContent)
        const codeBlock = this.type.create({ language: match.data?.language ?? null })
        const replacementNodes = [precedingParagraph, codeBlock]
        const trailingContent = paragraph.content.cut($fenceEnd.parentOffset)
        if (trailingContent.size) {
          replacementNodes.push(paragraph.type.create(paragraph.attrs, trailingContent))
        }
        const replacement = Fragment.fromArray(replacementNodes)
        const paragraphPosition = $fence.before()
        const container = $fence.node(-1)
        const paragraphIndex = $fence.index(-1)

        if (!container.canReplace(paragraphIndex, paragraphIndex + 1, replacement)) return null

        const transaction = state.tr.replaceWith(
          paragraphPosition,
          paragraphPosition + paragraph.nodeSize,
          replacement,
        )
        transaction.setSelection(
          TextSelection.create(
            transaction.doc,
            paragraphPosition + precedingParagraph.nodeSize + 1,
          ),
        )
      },
    })

    return [...(this.parent?.() ?? []), hardBreakFenceRule]
  },
})
