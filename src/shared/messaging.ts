import type { DtoMustardNote } from './dto/DtoMustardNote'
import type { DtoMustardComment } from './dto/DtoMustardComment'
import type { DtoMyPagesOverview } from './dto/DtoMyPagesOverview'
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

// Message to query notes for a page (response: DtoMustardNote[])
export type QueryNotesMessage = Satisfies<
  BaseMessage,
  {
    type: 'QUERY_NOTES'
    pageUrl: string
  }
>

// Message to delete a note (response: fresh DtoMustardNote[])
export type DeleteNoteMessage = Satisfies<
  BaseMessage,
  {
    type: 'DELETE_NOTE'
    noteId: string
    pageUrl: string
    authorId: string // 'local' for local notes, DID for remote notes
  }
>

// Content script → service worker: repost / un-repost a remote note. A repost is
// a visibility grant — it lets the current user's followers see the note too.
// Response: fresh DtoMustardNote[] for the page (so the avatar stack updates).
export type SetRepostMessage = Satisfies<
  BaseMessage,
  {
    type: 'SET_REPOST'
    noteId: string
    pageUrl: string
    reposted: boolean
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
type GetProfilesResponse = Record<string, UserProfile | null>

// Popup → content script: query whether notes are visible on this page
export type GetNotesVisibleMessage = Satisfies<
  BaseMessage,
  {
    type: 'GET_NOTES_VISIBLE'
  }
>

// Popup → content script: set whether notes are visible on this page
export type SetNotesVisibleMessage = Satisfies<
  BaseMessage,
  {
    type: 'SET_NOTES_VISIBLE'
    visible: boolean
  }
>

// Message broadcast to content scripts when session changes (login/logout)
export type SessionChangedMessage = Satisfies<
  BaseMessage,
  {
    type: 'SESSION_CHANGED'
    did: string | null // null means logged out
  }
>

// Message broadcast to content scripts when session expired involuntarily (not explicit logout)
export type SessionExpiredMessage = Satisfies<
  BaseMessage,
  {
    type: 'SESSION_EXPIRED'
  }
>

// Content script → service worker: open the extension popup
export type OpenPopupMessage = Satisfies<
  BaseMessage,
  {
    type: 'OPEN_POPUP'
  }
>

// Content script → service worker: query all comments for a batch of remote note ids.
// Response: Record<noteId, DtoMustardComment[]> (oldest → newest within each list).
export type QueryCommentsMessage = Satisfies<
  BaseMessage,
  {
    type: 'QUERY_COMMENTS'
    noteIds: string[]
  }
>

export type QueryCommentsResponse = Record<string, DtoMustardComment[]>

// Content script → service worker: create a new comment on a remote note.
// Response: fresh DtoMustardComment[] for that note (oldest → newest).
export type UpsertCommentMessage = Satisfies<
  BaseMessage,
  {
    type: 'UPSERT_COMMENT'
    noteId: string
    content: string
  }
>

// Content script → service worker: delete one of my own comments.
// Response: fresh DtoMustardComment[] for that note (oldest → newest).
export type DeleteCommentMessage = Satisfies<
  BaseMessage,
  {
    type: 'DELETE_COMMENT'
    commentId: string
    noteId: string
  }
>

// Content script → service worker: how many unread notifications exist
// for each of these note ids? Response: Record<noteId, number>.
export type QueryNotificationsForNotesMessage = Satisfies<
  BaseMessage,
  {
    type: 'QUERY_NOTIFICATIONS_FOR_NOTES'
    noteIds: string[]
  }
>

export type QueryNotificationsForNotesResponse = Record<string, number>

// Content script → service worker: the recipient has now seen any unread
// comments on this note (the thread was expanded on a page that owns the note).
// Backend deletes all notifications for (recipient, noteId).
// Response: void.
export type MarkNotificationsSeenForNoteMessage = Satisfies<
  BaseMessage,
  {
    type: 'MARK_NOTIFICATIONS_SEEN_FOR_NOTE'
    noteId: string
  }
>

// Popup → service worker: overview of pages where the user has notes, with
// per-page unread counts. Response: DtoMyPagesOverview.
export type GetMyPagesOverviewMessage = Satisfies<
  BaseMessage,
  {
    type: 'GET_MY_PAGES_OVERVIEW'
  }
>

// Broadcast: notifications state changed (mark-seen, new fetch with deltas).
// Tells the popup to re-query the overview and lets content scripts know to
// refresh their unread counters if needed.
export type NotificationsChangedMessage = Satisfies<
  BaseMessage,
  {
    type: 'NOTIFICATIONS_CHANGED'
  }
>

// Discriminated union of all messages - enables type narrowing
export type Message =
  | OpenNoteEditorMessage
  | UpsertNoteMessage
  | QueryNotesMessage
  | DeleteNoteMessage
  | SetRepostMessage
  | AtprotoLoginMessage
  | GetAtprotoSessionMessage
  | AtprotoLogoutMessage
  | GetProfilesMessage
  | GetNotesVisibleMessage
  | SetNotesVisibleMessage
  | SessionChangedMessage
  | SessionExpiredMessage
  | OpenPopupMessage
  | QueryCommentsMessage
  | UpsertCommentMessage
  | DeleteCommentMessage
  | QueryNotificationsForNotesMessage
  | MarkNotificationsSeenForNoteMessage
  | GetMyPagesOverviewMessage
  | NotificationsChangedMessage

/**
 * Maps each message type to the value its handler resolves with. Drives the
 * typed `sendMessage` / `sendTabMessage` wrappers below so call sites get a
 * precisely-typed response instead of `any` (no more per-call casts).
 *
 * `void` entries are fire-and-forget (broadcasts / one-way notifications).
 */
type MessageResponses = {
  OPEN_NOTE_EDITOR: void
  UPSERT_NOTE: DtoMustardNote[]
  QUERY_NOTES: DtoMustardNote[]
  DELETE_NOTE: DtoMustardNote[]
  SET_REPOST: DtoMustardNote[]
  ATPROTO_LOGIN: { did: string } | null
  GET_ATPROTO_SESSION: AtprotoSessionResponse
  ATPROTO_LOGOUT: null
  GET_PROFILES: GetProfilesResponse
  GET_NOTES_VISIBLE: boolean
  SET_NOTES_VISIBLE: boolean
  SESSION_CHANGED: void
  SESSION_EXPIRED: void
  OPEN_POPUP: void
  QUERY_COMMENTS: QueryCommentsResponse
  UPSERT_COMMENT: DtoMustardComment[]
  DELETE_COMMENT: DtoMustardComment[]
  QUERY_NOTIFICATIONS_FOR_NOTES: QueryNotificationsForNotesResponse
  MARK_NOTIFICATIONS_SEEN_FOR_NOTE: null
  GET_MY_PAGES_OVERVIEW: DtoMyPagesOverview
  NOTIFICATIONS_CHANGED: void
}

export type ResponseFor<T extends Message['type']> = MessageResponses[T]

/**
 * Strip Vue reactive Proxies (and any other non-cloneable wrappers) before a
 * message crosses the extension boundary. Firefox's `structuredClone` rejects
 * proxies; Chrome serializes silently. Doing it here means callers never have
 * to remember (see LEARNINGS.md → Cross-Browser Extension Messaging).
 */
function toPlainMessage<M extends Message>(message: M): M {
  return JSON.parse(JSON.stringify(message)) as M
}

/**
 * Send a message to the service worker (and any other extension pages).
 *
 * Use this from a content script or popup to talk to the background. The
 * browser routes `runtime.sendMessage` to extension contexts only — it can NOT
 * target a specific web page's content script, which is why `sendTabMessage`
 * also exists. Response type is inferred from `message.type` (no casts).
 */
export function sendMessage<M extends Message>(message: M): Promise<ResponseFor<M['type']>> {
  return browser.runtime.sendMessage(toPlainMessage(message)) as Promise<ResponseFor<M['type']>>
}

/**
 * Send a message to one specific tab's content script (background → page).
 *
 * The service worker has no `runtime` channel to a given page, so it must
 * address the content script by tab id via `tabs.sendMessage` (this is the
 * inverse direction of `sendMessage`). Used for per-tab pushes like
 * SESSION_CHANGED or asking the active tab whether notes are visible.
 */
export function sendTabMessage<M extends Message>(
  tabId: number,
  message: M,
): Promise<ResponseFor<M['type']>> {
  return browser.tabs.sendMessage(tabId, toPlainMessage(message)) as Promise<ResponseFor<M['type']>>
}

/**
 * Fire-and-forget broadcast of a message to every open tab's content script.
 * Tabs without a listening content script (e.g. opened before the extension
 * loaded) reject silently and are ignored.
 */
export async function broadcastToAllTabs<M extends Message>(message: M): Promise<void> {
  const tabs = await browser.tabs.query({})
  for (const tab of tabs) {
    if (tab.id !== undefined) {
      void sendTabMessage(tab.id, message).catch(() => {})
    }
  }
}

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

export function createDeleteNoteMessage(
  noteId: string,
  pageUrl: string,
  authorId: string,
): DeleteNoteMessage {
  return {
    type: 'DELETE_NOTE',
    noteId,
    pageUrl,
    authorId,
  }
}

export function createSetRepostMessage(
  noteId: string,
  pageUrl: string,
  reposted: boolean,
): SetRepostMessage {
  return {
    type: 'SET_REPOST',
    noteId,
    pageUrl,
    reposted,
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

export function createGetNotesVisibleMessage(): GetNotesVisibleMessage {
  return {
    type: 'GET_NOTES_VISIBLE',
  }
}

export function createSetNotesVisibleMessage(visible: boolean): SetNotesVisibleMessage {
  return {
    type: 'SET_NOTES_VISIBLE',
    visible,
  }
}

export function createQueryCommentsMessage(noteIds: string[]): QueryCommentsMessage {
  return {
    type: 'QUERY_COMMENTS',
    noteIds,
  }
}

export function createUpsertCommentMessage(noteId: string, content: string): UpsertCommentMessage {
  return {
    type: 'UPSERT_COMMENT',
    noteId,
    content,
  }
}

export function createDeleteCommentMessage(
  commentId: string,
  noteId: string,
): DeleteCommentMessage {
  return {
    type: 'DELETE_COMMENT',
    commentId,
    noteId,
  }
}

export function createQueryNotificationsForNotesMessage(
  noteIds: string[],
): QueryNotificationsForNotesMessage {
  return {
    type: 'QUERY_NOTIFICATIONS_FOR_NOTES',
    noteIds,
  }
}

export function createMarkNotificationsSeenForNoteMessage(
  noteId: string,
): MarkNotificationsSeenForNoteMessage {
  return {
    type: 'MARK_NOTIFICATIONS_SEEN_FOR_NOTE',
    noteId,
  }
}

export function createGetMyPagesOverviewMessage(): GetMyPagesOverviewMessage {
  return {
    type: 'GET_MY_PAGES_OVERVIEW',
  }
}
