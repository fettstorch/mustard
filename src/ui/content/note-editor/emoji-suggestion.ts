import { Extension, InputRule } from '@tiptap/core'
import { VueRenderer } from '@tiptap/vue-3'
import Suggestion from '@tiptap/suggestion'
import type { SuggestionProps } from '@tiptap/suggestion'
import { PluginKey, type EditorState } from '@tiptap/pm/state'
import { emojiForName, emojiMatches, type EmojiEntry } from '@/shared/emoji'
import EmojiPicker from './EmojiPicker.vue'

const pluginKey = new PluginKey('mustardEmoji')
function isCodeContext(state: EditorState, position: number): boolean {
  const $position = state.doc.resolve(position)
  return (
    Boolean($position.parent.type.spec.code) ||
    $position.marks().some((mark) => mark.type.spec.code)
  )
}

type PickerInstance = InstanceType<typeof EmojiPicker> & {
  onKeyDown?: (event: KeyboardEvent) => boolean
}

const pickerProps = (props: SuggestionProps<EmojiEntry, EmojiEntry>) => ({
  items: props.items,
  clientRect: props.clientRect,
  onSelect: (item: EmojiEntry) => props.command(item),
})

export const EmojiSuggestion = Extension.create({
  name: 'mustardEmoji',
  addInputRules() {
    return [
      new InputRule({
        // Match the same trigger boundaries as the picker, not URL/path suffixes.
        find: /(?:^|[ \n(]):([a-z][a-z-]*):$/,
        handler: ({ state, range, match }) => {
          const from = range.from + match[0].indexOf(':')
          if (isCodeContext(state, from)) return
          const emoji = emojiForName(match[1]!)
          if (emoji) state.tr.replaceWith(from, range.to, state.schema.text(emoji))
        },
      }),
    ]
  },
  addProseMirrorPlugins() {
    return [
      Suggestion<EmojiEntry, EmojiEntry>({
        editor: this.editor,
        char: ':',
        pluginKey,
        allow: ({ state, range }) => !isCodeContext(state, range.from),
        allowedPrefixes: [' ', '\n', '('],
        // Keep the full catalogue browseable, including flags at the end.
        items: ({ query }) => emojiMatches(query),
        command: ({ editor, range, props }) => {
          editor.chain().focus().insertContentAt(range, props.emoji).run()
        },
        render: () => {
          let renderer: VueRenderer | null = null
          let element: HTMLElement | null = null
          return {
            onStart(props) {
              renderer = new VueRenderer(EmojiPicker, {
                editor: props.editor,
                props: pickerProps(props),
              })
              element = renderer.element as HTMLElement
              // A sibling of the note avoids clipping while inheriting the host's
              // live theme and font variables (which aren't set on document.body).
              const host = props.editor.view.dom.closest('#mustard-host') ?? document.body
              host.appendChild(element)
            },
            onUpdate(props) {
              if (props.query && props.items.length === 1) {
                // A suggestion update runs during a ProseMirror view update; dispatch
                // after it completes, and ignore a stale query if the user kept typing.
                queueMicrotask(() => {
                  if (props.editor.state.selection.from !== props.range.to) return
                  if (
                    props.editor.state.doc.textBetween(props.range.from, props.range.to) !==
                    `:${props.query}`
                  )
                    return
                  props.command(props.items[0]!)
                })
                return
              }
              renderer?.updateProps(pickerProps(props))
            },
            onKeyDown({ event }) {
              if (event.key === 'Escape') return false
              return (renderer?.ref as PickerInstance | null)?.onKeyDown?.(event) ?? false
            },
            onExit() {
              renderer?.destroy()
              element?.remove()
              renderer = null
              element = null
            },
          }
        },
      }),
    ]
  },
})
