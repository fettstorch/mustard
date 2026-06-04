import { mergeAttributes } from '@tiptap/core'
import type { JSONContent } from '@tiptap/core'
import Mention from '@tiptap/extension-mention'
import type { MentionNodeAttrs } from '@tiptap/extension-mention'
import { VueRenderer } from '@tiptap/vue-3'
import type { SuggestionProps } from '@tiptap/suggestion'
import { PluginKey } from '@tiptap/pm/state'
import MentionPicker from './MentionPicker.vue'
import type { BskyProfile } from '@/shared/model/BskyProfile'

const pluginKey = new PluginKey('mustardMention')

type PickerInstance = InstanceType<typeof MentionPicker> & {
  onKeyDown?: (event: KeyboardEvent) => boolean
}

/**
 * We reuse Mention's native attributes:
 *   - `id`    → the mentioned user's DID (the stable, persisted identifier)
 *   - `label` → the current handle (display-only; never persisted)
 */
const toPickerProps = (props: SuggestionProps<BskyProfile, MentionNodeAttrs>) => ({
  items: props.items,
  query: props.query,
  clientRect: props.clientRect,
  onSelect: (profile: BskyProfile) => props.command({ id: profile.id, label: profile.handle }),
})

// `renderMarkdown` is read at runtime by @tiptap/markdown (via getExtensionField)
// but isn't part of NodeConfig's public types in this version, so it's spread in
// as an untyped field to avoid an excess-property type error.
const markdownSerialization = {
  renderMarkdown: (node: JSONContent) => `@[${node.attrs?.id ?? ''}]`,
} as Record<string, unknown>

/**
 * Builds the @-mention node + its `@`-triggered autocomplete over the current
 * user's mutuals. Mirrors the GiphySlash suggestion pattern: the picker is a
 * Vue component appended to `document.body`, keyboard nav is forwarded, and
 * mouse interactions `preventDefault` so the editor never blurs.
 *
 * @param getMutuals lazily reads the latest mutuals list (it loads async after
 *   the editor mounts), so each keystroke filters against fresh data.
 */
export function createMentionExtension(getMutuals: () => BskyProfile[]) {
  return Mention.extend({
    renderHTML({ node, HTMLAttributes }) {
      return [
        'span',
        mergeAttributes({ class: 'mustard-note-mention' }, HTMLAttributes),
        `@${node.attrs.label ?? node.attrs.id}`,
      ]
    },

    renderText({ node }) {
      return `@${node.attrs.label ?? node.attrs.id}`
    },

    ...markdownSerialization,
  }).configure({
    suggestion: {
      char: '@',
      pluginKey,
      items: ({ query }): BskyProfile[] => {
        const q = query.trim().toLowerCase()
        const mutuals = getMutuals()
        const matches = q
          ? mutuals.filter(
              (m) => m.handle.toLowerCase().includes(q) || m.displayName.toLowerCase().includes(q),
            )
          : mutuals
        return matches.slice(0, 8)
      },
      command: ({ editor, range, props }) => {
        // Absorb a trailing space if the suggestion sits right before one, so we
        // don't end up with a double space after inserting.
        const nodeAfter = editor.view.state.selection.$to.nodeAfter
        const overrideSpace = nodeAfter?.text?.startsWith(' ')
        if (overrideSpace) range.to += 1

        editor
          .chain()
          .focus()
          .insertContentAt(range, [
            { type: 'mention', attrs: { id: props.id, label: props.label } },
            { type: 'text', text: ' ' },
          ])
          .run()
      },
      render: () => {
        let renderer: VueRenderer | null = null
        let pickerEl: HTMLElement | null = null

        return {
          onStart(props: SuggestionProps<BskyProfile, MentionNodeAttrs>) {
            renderer = new VueRenderer(MentionPicker, {
              editor: props.editor,
              props: toPickerProps(props),
            })
            pickerEl = renderer.element as HTMLElement
            document.body.appendChild(pickerEl)
          },
          onUpdate(props: SuggestionProps<BskyProfile, MentionNodeAttrs>) {
            renderer?.updateProps(toPickerProps(props))
          },
          onKeyDown({ event }: { event: KeyboardEvent }) {
            // Let Escape bubble to close the editor; the picker just closes via onExit.
            if (event.key === 'Escape') return false
            const ref = renderer?.ref as PickerInstance | null
            return ref?.onKeyDown?.(event) ?? false
          },
          onExit() {
            renderer?.destroy()
            pickerEl?.remove()
            renderer = null
            pickerEl = null
          },
        }
      },
    },
  })
}
