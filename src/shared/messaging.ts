import type { DtoMustardNote } from './dto/DtoMustardNote'
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
    data: Omit<DtoMustardNote, 'id' | 'authorId'>
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

// Message to delete a note (response returns fresh notes via sendResponse)
export type DeleteNoteMessage = Satisfies<
  BaseMessage,
  {
    type: 'DELETE_NOTE'
    noteId: string
    pageUrl: string
  }
>

// AT Protocol auth messages - handled by service worker since popup can close during OAuth flow
export type AtprotoLoginMessage = Satisfies<
  BaseMessage,
  {
    type: 'ATPROTO_LOGIN'
    handle: string
  }
>

export type GetAtprotoSessionMessage = Satisfies<
  BaseMessage,
  {
    type: 'GET_ATPROTO_SESSION'
  }
>

export type AtprotoLogoutMessage = Satisfies<
  BaseMessage,
  {
    type: 'ATPROTO_LOGOUT'
    did: string
  }
>

// Response types for AT Protocol auth messages
export type AtprotoSessionResponse = {
  did: string
} | null

// Discriminated union of all messages - enables type narrowing
export type Message =
  | OpenNoteEditorMessage
  | UpsertNoteMessage
  | QueryNotesMessage
  | DeleteNoteMessage
  | AtprotoLoginMessage
  | GetAtprotoSessionMessage
  | AtprotoLogoutMessage

export function createOpenNoteEditorMessage(): OpenNoteEditorMessage {
  return {
    type: 'OPEN_NOTE_EDITOR',
  }
}

export function createUpsertNoteMessage(
  service: 'local' | 'remote',
  data: Omit<DtoMustardNote, 'id' | 'authorId'>,
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

export function createDeleteNoteMessage(noteId: string, pageUrl: string): DeleteNoteMessage {
  return {
    type: 'DELETE_NOTE',
    noteId,
    pageUrl,
  }
}

export function createAtprotoLoginMessage(handle: string): AtprotoLoginMessage {
  return {
    type: 'ATPROTO_LOGIN',
    handle,
  }
}

export function createGetAtprotoSessionMessage(): GetAtprotoSessionMessage {
  return {
    type: 'GET_ATPROTO_SESSION',
  }
}

export function createAtprotoLogoutMessage(did: string): AtprotoLogoutMessage {
  return {
    type: 'ATPROTO_LOGOUT',
    did,
  }
}
