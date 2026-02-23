import type { DtoMustardNote } from './dto/DtoMustardNote'
import type { Satisfies } from './Satisfies'
import type { UserProfile, UserId } from './model/UserProfile'

type BaseMessage = {
  type: string
}

/**
 * Data about where a mustard note is anchored on the page.
 *
 * Anchor resolution strategy:
 * 1. Try to find element using `elementSelector` (e.g., "#myId" or "div.class > span")
 * 2. If found and has dimensions, position using `relativePosition` (% within element)
 * 3. If not found or zero dimensions, fall back to `clickPosition` (absolute viewport position)
 *
 * Both position types are ALWAYS stored because we can't predict at storage time whether
 * the element will exist or have valid dimensions when the note is later rendered.
 * The `clickPosition` serves as a runtime fallback, not a storage-time decision.
 */
export type MustardNoteAnchorData = {
  pageUrl: string
  /** CSS selector to find the anchored element (e.g., "#myId" or "div > span:nth-child(2)") */
  elementSelector: string | null
  /** Position as percentage (0-100) relative to the anchored element's dimensions */
  relativePosition: {
    xP: number // 0-100 percentage relative to element
    yP: number // 0-100 percentage relative to element
  }
  /** Absolute position as fallback when element can't be found or has zero dimensions */
  clickPosition: {
    xVw: number // viewport width percentage (0-100)
    yPx: number // pixels from top (includes scroll offset)
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
    data: Omit<DtoMustardNote, 'id' | 'authorId'>
    target: 'local' | 'remote'
    /** When publishing, the local note ID to delete after successful remote publish */
    localNoteIdToDelete?: string
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
    authorId: string // 'local' for local notes, DID for remote notes
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

// Message to get profiles for multiple users (batch fetch)
export type GetProfilesMessage = Satisfies<
  BaseMessage,
  {
    type: 'GET_PROFILES'
    userIds: UserId[]
  }
>

// Response types for AT Protocol auth messages
export type AtprotoSessionResponse = {
  did: string
} | null

// Response type for GET_PROFILES - map of userId to profile (null if not found)
export type GetProfilesResponse = Record<string, UserProfile | null>

// Message broadcast to content scripts when session changes (login/logout)
export type SessionChangedMessage = Satisfies<
  BaseMessage,
  {
    type: 'SESSION_CHANGED'
    did: string | null // null means logged out
  }
>

// Discriminated union of all messages - enables type narrowing
export type Message =
  | OpenNoteEditorMessage
  | UpsertNoteMessage
  | QueryNotesMessage
  | DeleteNoteMessage
  | AtprotoLoginMessage
  | GetAtprotoSessionMessage
  | AtprotoLogoutMessage
  | GetProfilesMessage
  | SessionChangedMessage

export function createOpenNoteEditorMessage(): OpenNoteEditorMessage {
  return {
    type: 'OPEN_NOTE_EDITOR',
  }
}

export function createUpsertNoteMessage(
  data: Omit<DtoMustardNote, 'id' | 'authorId'>,
  target: 'local' | 'remote',
  localNoteIdToDelete?: string,
): UpsertNoteMessage {
  return {
    type: 'UPSERT_NOTE',
    data,
    target,
    localNoteIdToDelete,
  }
}

export function createQueryNotesMessage(pageUrl: string): QueryNotesMessage {
  return {
    type: 'QUERY_NOTES',
    pageUrl,
  }
}

export function createDeleteNoteMessage(noteId: string, pageUrl: string, authorId: string): DeleteNoteMessage {
  return {
    type: 'DELETE_NOTE',
    noteId,
    pageUrl,
    authorId,
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

export function createGetProfilesMessage(userIds: UserId[]): GetProfilesMessage {
  return {
    type: 'GET_PROFILES',
    userIds,
  }
}
