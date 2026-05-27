import { Extension } from '@tiptap/core'
import { VueRenderer } from '@tiptap/vue-3'
import Suggestion from '@tiptap/suggestion'
import type { SuggestionProps, SuggestionKeyDownProps } from '@tiptap/suggestion'
import { PluginKey } from '@tiptap/pm/state'
import GiphyPicker from './GiphyPicker.vue'

export const GiphyPluginKey = new PluginKey('giphySlash')

export type GiphyPickerSelection = { src: string }

type PickerInstance = InstanceType<typeof GiphyPicker> & {
  onKeyDown?: (event: KeyboardEvent) => boolean
}

/**
 * Slash command that opens a Giphy picker. Trigger: `/giphy <search>`.
 *
 * Uses `@tiptap/suggestion` to track the query; the popup is a Vue component
 * appended to `document.body` (so it isn't clipped by note overflow).
 *
 * Focus stays in the editor the whole time:
 * - Keyboard nav is forwarded from suggestion's `onKeyDown` to the picker.
 * - Mouse clicks call `preventDefault` on mousedown so the editor never blurs.
 */
export const GiphySlash = Extension.create({
  name: 'giphySlash',

  addProseMirrorPlugins() {
    return [
      Suggestion<unknown, GiphyPickerSelection>({
        editor: this.editor,
        char: '/',
        allowSpaces: true,
        pluginKey: GiphyPluginKey,
        items: () => [],
        command: ({ editor, range, props }) => {
          editor.chain().focus().deleteRange(range).setImage({ src: props.src }).run()
        },
        render: () => {
          let renderer: VueRenderer | null = null
          let container: HTMLElement | null = null

          const mount = (props: SuggestionProps<unknown, GiphyPickerSelection>) => {
            renderer = new VueRenderer(GiphyPicker, {
              editor: props.editor,
              props: {
                query: props.query.trim(),
                clientRect: props.clientRect,
                onSelect: (gif: GiphyPickerSelection) => props.command(gif),
              },
            })
            container = document.createElement('div')
            container.className = 'mustard-giphy-picker-host'
            container.appendChild(renderer.element as HTMLElement)
            document.body.appendChild(container)
          }

          const unmount = () => {
            renderer?.destroy()
            container?.remove()
            renderer = null
            container = null
          }

          return {
            onStart(props) {
              mount(props)
            },

            onUpdate(props) {
              if (!renderer) {
                mount(props)
                return
              }
              renderer.updateProps({
                query: props.query.trim(),
                clientRect: props.clientRect,
                onSelect: (gif: GiphyPickerSelection) => props.command(gif),
              })
            },

            onKeyDown(props: SuggestionKeyDownProps): boolean {
              if (!renderer) return false
              const ref = renderer.ref as PickerInstance | null
              return ref?.onKeyDown?.(props.event) ?? false
            },

            onExit() {
              unmount()
            },
          }
        },
      }),
    ]
  },
})
