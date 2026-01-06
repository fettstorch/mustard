import type { Satisfies } from './Satisfies'

type BaseMessage = {
  type: string
}

// Data about where the note is anchored on the page
export type MustardNoteAnchorData = {
  pageUrl: string
  elementId: string | null
  elementSelector: string | null
  relativePosition: {
    xP: number // 0-100 percentage relative to element
    yP: number // 0-100 percentage relative to element
  }
  clickPosition: {
    xVw: number
    yPx: number
  }
}

// Message to trigger opening the note editor (anchor data captured in content script)
export type OpenNoteEditorMessage = Satisfies<
  BaseMessage,
  {
    type: 'OPEN_NOTE_EDITOR'
    data: Record<string, never>
  }
>

// Discriminated union of all messages - enables type narrowing
export type Message = OpenNoteEditorMessage

export function createOpenNoteEditorMessage(): OpenNoteEditorMessage {
  return {
    type: 'OPEN_NOTE_EDITOR',
    data: {},
  }
}
