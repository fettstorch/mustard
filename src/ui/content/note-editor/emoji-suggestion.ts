import { Extension, InputRule } from '@tiptap/core'
import { VueRenderer } from '@tiptap/vue-3'
import Suggestion from '@tiptap/suggestion'
import type { SuggestionProps } from '@tiptap/suggestion'
import { PluginKey } from '@tiptap/pm/state'
import { EMOJI, emojiMatches, type EmojiName } from '@/shared/emoji'
import EmojiPicker from './EmojiPicker.vue'

const pluginKey = new PluginKey('mustardEmoji')
type PickerInstance = InstanceType<typeof EmojiPicker> & {
  onKeyDown?: (event: KeyboardEvent) => boolean
}

const pickerProps = (props: SuggestionProps<EmojiName, EmojiName>) => ({
  items: props.items,
  clientRect: props.clientRect,
  onSelect: (name: EmojiName) => props.command(name),
})

export const EmojiSuggestion = Extension.create({
  name: 'mustardEmoji',
  addInputRules() {
    return [
      new InputRule({
        find: /:([a-z][a-z-]*):$/,
        handler: ({ state, range, match }) => {
          const emoji = EMOJI[match[1] as EmojiName]
          if (emoji) state.tr.replaceWith(range.from, range.to, state.schema.text(emoji))
        },
      }),
    ]
  },
  addProseMirrorPlugins() {
    return [
      Suggestion<EmojiName, EmojiName>({
        editor: this.editor,
        char: ':',
        pluginKey,
        allowedPrefixes: [' ', '\n', '('],
        items: ({ query }) => emojiMatches(query).slice(0, 40),
        command: ({ editor, range, props }) => {
          editor.chain().focus().insertContentAt(range, EMOJI[props]).run()
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
              document.body.appendChild(element)
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
