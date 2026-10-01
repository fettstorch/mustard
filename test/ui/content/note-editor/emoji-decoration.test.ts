// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { Editor } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import { EmojiDecoration } from '../../../../src/ui/content/note-editor/emoji-decoration'

describe('emoji decoration in the editor', () => {
  it('outlines editable emoji without modifying text or code', () => {
    const editor = new Editor({
      element: document.createElement('div'),
      extensions: [StarterKit, EmojiDecoration],
      content: '<p>Look 🇩🇪 and <code>🔥</code></p><pre><code>🫣</code></pre>',
    })
    try {
      expect(editor.view.dom.querySelectorAll('.mustard-emoji')).toHaveLength(1)
      expect(editor.view.dom.querySelector('.mustard-emoji')?.textContent).toBe('🇩🇪')
      expect(editor.getText()).toContain('Look 🇩🇪 and 🔥')
      editor.commands.insertContentAt(1, '🤷‍♂️')
      expect(editor.view.dom.querySelectorAll('.mustard-emoji')).toHaveLength(2)
      expect(editor.getText()).toContain('🤷‍♂️')
    } finally {
      editor.destroy()
    }
  })
})
