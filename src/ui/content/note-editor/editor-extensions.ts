import StarterKit from '@tiptap/starter-kit'
import { Image } from '@tiptap/extension-image'
import { Placeholder } from '@tiptap/extensions'
import { Markdown } from '@tiptap/markdown'
import type { Extensions } from '@tiptap/core'
import { CodeBlockLowlightWithHardBreakFence } from './code-block-extension'
import { ImageUrlAutoConvert } from './image-url-auto-convert'
import { GiphySlash } from './giphy-slash'
import { createMentionExtension } from './mention-node'
import { lowlight } from '../note/code-highlighting'
import type { MentionCandidate } from '@/shared/model/MentionCandidate'

/**
 * Shared TipTap extension bundle used by BOTH the note editor and the comment
 * editor, so they stay in lockstep (mentions, Giphy slash command, inline gif
 * previews, image-URL auto-convert, markdown serialization).
 *
 * @param placeholder the editor's empty-state placeholder text.
 * @param getCandidates lazily reads the current user's mention candidates.
 */
export function createEditorExtensions(opts: {
  placeholder: string
  getCandidates: () => MentionCandidate[]
}): Extensions {
  return [
    StarterKit.configure({
      // Replaced with the syntax-highlighting variant below.
      codeBlock: false,
    }),
    CodeBlockLowlightWithHardBreakFence.configure({
      lowlight,
      enableTabIndentation: true,
    }),
    Image.configure({
      inline: false,
      HTMLAttributes: {
        class: 'mustard-note-image',
        draggable: 'false',
        referrerpolicy: 'no-referrer',
      },
    }),
    Placeholder.configure({
      placeholder: opts.placeholder,
    }),
    Markdown,
    ImageUrlAutoConvert,
    GiphySlash,
    createMentionExtension(opts.getCandidates),
  ]
}
