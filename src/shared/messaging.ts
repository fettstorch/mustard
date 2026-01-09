import type { MustardNote } from './model/MustardNote'
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
  }
>

// Message to create or update a mustard note
export type UpsertNoteMessage = Satisfies<
  BaseMessage,
  {
    type: 'UPSERT_NOTE'
    service: 'local' | 'remote'
    data: Omit<MustardNote, 'id' | 'authorId'>
  }
>

// Message to query notes for a page (response via sendResponse callback)
export type QueryNotesMessage = Satisfies<
  BaseMessage,
  {
    type: 'QUERY_NOTES'
    pageUrl: string
  }
>

// Discriminated union of all messages - enables type narrowing
export type Message = OpenNoteEditorMessage | UpsertNoteMessage | QueryNotesMessage

export function createOpenNoteEditorMessage(): OpenNoteEditorMessage {
  return {
    type: 'OPEN_NOTE_EDITOR',
  }
}

export function createUpsertNoteMessage(
  service: 'local' | 'remote',
  data: Omit<MustardNote, 'id' | 'authorId'>,
): UpsertNoteMessage {
  return {
    type: 'UPSERT_NOTE',
    service,
    data,
  }
}

export function createQueryNotesMessage(pageUrl: string): QueryNotesMessage {
  return {
    type: 'QUERY_NOTES',
    pageUrl,
  }
}
