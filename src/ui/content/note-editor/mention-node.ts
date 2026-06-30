import { mergeAttributes } from '@tiptap/core'
import type { JSONContent } from '@tiptap/core'
import Mention from '@tiptap/extension-mention'
import type { MentionNodeAttrs } from '@tiptap/extension-mention'
import { VueRenderer } from '@tiptap/vue-3'
import type { SuggestionProps } from '@tiptap/suggestion'
import { PluginKey } from '@tiptap/pm/state'
import MentionPicker from './MentionPicker.vue'
import type { MentionCandidate } from '@/shared/model/MentionCandidate'
import type { UserProfileType } from '@/shared/model/UserProfile'

const pluginKey = new PluginKey('mustardMention')

type PickerInstance = InstanceType<typeof MentionPicker> & {
  onKeyDown?: (event: KeyboardEvent) => boolean
}

/**
 * Our mention node's attributes. Extends Mention's native `id`/`label` with a
 * `provider` so serialization knows which sentinel to emit. tiptap's Mention is
 * hard-typed to `MentionNodeAttrs` (no custom attrs), so the command boundary
 * asserts to this richer type in exactly one place.
 *   - `id`       → the mentioned account's provider id (DID for atproto, numeric
 *                  id for github) — the stable, persisted identifier.
 *   - `label`    → the current handle (display-only; never persisted).
 *   - `provider` → which network the mention targets, encoded into the
 *                  `@[p:<provider>:<id>]` sentinel (e.g. atproto vs github).
 */
type MustardMentionAttrs = {
  id: string
  label: string
  provider: UserProfileType
}

const toPickerProps = (props: SuggestionProps<MentionCandidate, MentionNodeAttrs>) => ({
  items: props.items,
  query: props.query,
  clientRect: props.clientRect,
  onSelect: (candidate: MentionCandidate) => {
    // MustardMentionAttrs is assignable to MentionNodeAttrs (extra `provider`),
    // so this passes through `command` without a cast and lands in `command` below.
    const attrs: MustardMentionAttrs = {
      id: candidate.accountId,
      label: candidate.handle,
      provider: candidate.provider,
    }
    props.command(attrs)
  },
})

// `renderMarkdown` is read at runtime by @tiptap/markdown (via getExtensionField)
// but isn't part of NodeConfig's public types in this version, so it's spread in
// as an untyped field to avoid an excess-property type error.
const markdownSerialization = {
  renderMarkdown: (node: JSONContent) => {
    const id = node.attrs?.id ?? ''
    // Unified multi-provider sentinel for every provider (see shared/mentions).
    const provider = node.attrs?.provider ?? 'atproto'
    return `@[p:${provider}:${id}]`
  },
} as Record<string, unknown>

/**
 * Builds the @-mention node + its `@`-triggered autocomplete over the current
 * user's mutuals. Mirrors the GiphySlash suggestion pattern: the picker is a
 * Vue component appended to `document.body`, keyboard nav is forwarded, and
 * mouse interactions `preventDefault` so the editor never blurs.
 *
 * @param getCandidates lazily reads the latest candidate list (it loads async
 *   after the editor mounts), so each keystroke filters against fresh data.
 */
export function createMentionExtension(getCandidates: () => MentionCandidate[]) {
  return Mention.extend({
    addAttributes() {
      return {
        ...this.parent?.(),
        // Persisted on the node so `renderMarkdown` can pick the right sentinel.
        // Defaults to atproto so legacy/bsky mentions are unaffected.
        provider: {
          default: 'atproto',
          parseHTML: (el) => el.getAttribute('data-provider') ?? 'atproto',
          renderHTML: (attrs) => (attrs.provider ? { 'data-provider': attrs.provider } : {}),
        },
      }
    },

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
      items: ({ query }): MentionCandidate[] => {
        const q = query.trim().toLowerCase()
        const candidates = getCandidates()
        const matches = q
          ? candidates.filter(
              (m) => m.handle.toLowerCase().includes(q) || m.displayName.toLowerCase().includes(q),
            )
          : candidates
        return matches.slice(0, 8)
      },
      command: ({ editor, range, props }) => {
        // tiptap types these as MentionNodeAttrs; our picker always sends the
        // richer shape (see toPickerProps), so assert it once here.
        const { id, label, provider } = props as MustardMentionAttrs
        // Absorb a trailing space if the suggestion sits right before one, so we
        // don't end up with a double space after inserting.
        const nodeAfter = editor.view.state.selection.$to.nodeAfter
        const overrideSpace = nodeAfter?.text?.startsWith(' ')
        if (overrideSpace) range.to += 1

        editor
          .chain()
          .focus()
          .insertContentAt(range, [
            { type: 'mention', attrs: { id, label, provider } },
            { type: 'text', text: ' ' },
          ])
          .run()
      },
      render: () => {
        let renderer: VueRenderer | null = null
        let pickerEl: HTMLElement | null = null

        return {
          onStart(props: SuggestionProps<MentionCandidate, MentionNodeAttrs>) {
            renderer = new VueRenderer(MentionPicker, {
              editor: props.editor,
              props: toPickerProps(props),
            })
            pickerEl = renderer.element as HTMLElement
            document.body.appendChild(pickerEl)
          },
          onUpdate(props: SuggestionProps<MentionCandidate, MentionNodeAttrs>) {
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
