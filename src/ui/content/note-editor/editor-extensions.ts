import StarterKit from '@tiptap/starter-kit'
import { Image } from '@tiptap/extension-image'
import { Placeholder } from '@tiptap/extensions'
import { Markdown } from '@tiptap/markdown'
import type { Extensions } from '@tiptap/core'
import { ImageUrlAutoConvert } from './image-url-auto-convert'
import { GiphySlash } from './giphy-slash'
import { createMentionExtension } from './mention-node'
import type { BskyProfile } from '@/shared/model/BskyProfile'

/**
 * Shared TipTap extension bundle used by BOTH the note editor and the comment
 * editor, so they stay in lockstep (mentions, Giphy slash command, inline gif
 * previews, image-URL auto-convert, markdown serialization).
 *
 * @param placeholder the editor's empty-state placeholder text.
 * @param getMutuals  lazily reads the current user's mutuals for @-mentions.
 */
export function createEditorExtensions(opts: {
  placeholder: string
  getMutuals: () => BskyProfile[]
}): Extensions {
  return [
    StarterKit.configure({}),
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
    createMentionExtension(opts.getMutuals),
  ]
}
