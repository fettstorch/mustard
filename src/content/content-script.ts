// Content script
import { createApp, type App } from 'vue'
import MustardNoteEditor from '@/ui/note-editor/MustardNoteEditor.vue'
import styles from '@/styles/main.css?inline'
import type { Message } from '@/shared/messaging'

console.log('Mustard content script loaded')

let editorApp: App | null = null
let editorHost: HTMLElement | null = null

chrome.runtime.onMessage.addListener((message: Message) => {
  if (message.type === 'OPEN_NOTE_EDITOR') {
    showNoteEditor()
  }
})

function showNoteEditor() {
  if (editorHost) return

  // Create host element with shadow DOM for style isolation
  editorHost = document.createElement('div')
  editorHost.id = 'mustard-note-editor-host'
  document.body.appendChild(editorHost)

  const shadow = editorHost.attachShadow({ mode: 'open' })

  // Inject styles inside shadow DOM only
  const styleElement = document.createElement('style')
  styleElement.textContent = styles
  shadow.appendChild(styleElement)

  // Mount point inside shadow
  const mountPoint = document.createElement('div')
  shadow.appendChild(mountPoint)

  editorApp = createApp(MustardNoteEditor)
  editorApp.mount(mountPoint)
}
