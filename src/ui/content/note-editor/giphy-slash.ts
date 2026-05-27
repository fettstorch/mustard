import { Extension } from '@tiptap/core'
import { VueRenderer } from '@tiptap/vue-3'
import Suggestion from '@tiptap/suggestion'
import type { SuggestionProps } from '@tiptap/suggestion'
import { PluginKey } from '@tiptap/pm/state'
import GiphyPicker from './GiphyPicker.vue'

const pluginKey = new PluginKey('giphySlash')

type Selection = { src: string }

type PickerInstance = InstanceType<typeof GiphyPicker> & {
  onKeyDown?: (event: KeyboardEvent) => boolean
}

const toPickerProps = (props: SuggestionProps<unknown, Selection>) => ({
  query: props.query.trim(),
  clientRect: props.clientRect,
  onSelect: (gif: Selection) => props.command(gif),
})

/**
 * Slash command that opens a Giphy picker. Trigger: `/<search>`.
 *
 * Uses `@tiptap/suggestion` to track the query; the popup is a Vue component
 * appended directly to `document.body` (so it isn't clipped by note overflow).
 *
 * Focus stays in the editor the whole time:
 * - Keyboard nav is forwarded from suggestion's `onKeyDown` to the picker.
 * - Mouse clicks call `preventDefault` on mousedown so the editor never blurs.
 */
export const GiphySlash = Extension.create({
  name: 'giphySlash',

  addProseMirrorPlugins() {
    return [
      Suggestion<unknown, Selection>({
        editor: this.editor,
        char: '/',
        allowSpaces: true,
        pluginKey,
        items: () => [],
        command: ({ editor, range, props }) => {
          editor.chain().focus().deleteRange(range).setImage({ src: props.src }).run()
        },
        render: () => {
          let renderer: VueRenderer | null = null
          let pickerEl: HTMLElement | null = null

          return {
            onStart(props) {
              renderer = new VueRenderer(GiphyPicker, {
                editor: props.editor,
                props: toPickerProps(props),
              })
              pickerEl = renderer.element as HTMLElement
              document.body.appendChild(pickerEl)
            },
            onUpdate(props) {
              renderer?.updateProps(toPickerProps(props))
            },
            onKeyDown({ event }) {
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
      }),
    ]
  },
})
