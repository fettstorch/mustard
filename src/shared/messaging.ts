import type { Satisfies } from './Satisfies'

type BaseMessage = {
  type: string
}

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
