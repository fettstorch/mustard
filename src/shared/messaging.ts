import type { DtoMustardNote } from './dto/DtoMustardNote'
import type { DtoMustardComment } from './dto/DtoMustardComment'
import type { DtoMyPagesOverview } from './dto/DtoMyPagesOverview'
import type { DtoMustardMention } from './dto/DtoMustardMention'
import type { Satisfies } from './Satisfies'
import type { UserProfile, UserId, LinkedIdentity } from './model/UserProfile'
import type { MentionTarget } from './mentions'
import type { BskyProfile } from './model/BskyProfile'
import type { MentionCandidate } from './model/MentionCandidate'

type BaseMessage = {
  type: string
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
    // When present, link this Bluesky identity to the already-logged-in account
    // ("Connect Bluesky" from Options) instead of creating a separate one.
    currentJwt?: string
  }
>

// GitHub OAuth login — handled by service worker for the same reason as ATProto.
// `currentJwt` is optional: when present, the GitHub identity is linked to the
// already-logged-in Mustard account instead of creating a new one.
export type GithubLoginMessage = Satisfies<
  BaseMessage,
  {
    type: 'GITHUB_LOGIN'
    currentJwt?: string
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
    userId: string
  }
>

// Options page → service worker: unlink one provider from the current account.
// Removing the last identity deletes the account entirely (see auth-bridge).
export type DisconnectProviderMessage = Satisfies<
  BaseMessage,
  {
    type: 'DISCONNECT_PROVIDER'
    provider: string
  }
>

// Batch profile fetch. Two explicitly-separated id spaces so the resolver never
// has to guess an id's kind from its string shape:
//   - userIds: opaque Mustard UUIDs (note/comment authors, reposters, self).
//   - mentions: provider-tagged account ids from @-mention sentinels.
// The response keys profiles by the same id you asked for (UUID or accountId).
export type GetProfilesMessage = Satisfies<
  BaseMessage,
  {
    type: 'GET_PROFILES'
    userIds: UserId[]
    mentions: MentionTarget[]
  }
>

// Content script → service worker: the current user's mutuals (people they
// follow who also follow them back). Powers the @-mention autocomplete.
// Response: BskyProfile[] (handle guaranteed).
export type GetMutualsMessage = Satisfies<
  BaseMessage,
  {
    type: 'GET_MUTUALS'
  }
>

type GetMutualsResponse = BskyProfile[]

// Content script → service worker: the github accounts the caller follows who
// are also Mustard users. Combined with mutuals to power @-mention autocomplete.
// Response: GithubMentionCandidate[].
export type GetGithubMentionCandidatesMessage = Satisfies<
  BaseMessage,
  {
    type: 'GET_GITHUB_MENTION_CANDIDATES'
  }
>

type GetGithubMentionCandidatesResponse = MentionCandidate[]

// Response types for AT Protocol auth messages.
// userId is the stable Mustard account id (opaque UUID).
// did is the linked atproto DID (if any), for atproto-specific operations.
export type AtprotoSessionResponse = {
  userId: string
  did?: string
  provider?: string
  identities?: LinkedIdentity[]
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
    userId: string | null // null means logged out
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

// Any surface → service worker: is this client still supported by the backend?
// Drives the "please update" guard (read-only mode below the server's minimum).
export type GetAppStatusMessage = Satisfies<
  BaseMessage,
  {
    type: 'GET_APP_STATUS'
  }
>

type AppStatusResponse = {
  currentVersion: string
  minVersion: string
  outdated: boolean
}

// Any surface → service worker: best-effort "update now". On Chrome this triggers
// a store update check + reload-on-download; elsewhere it opens the store listing.
export type RequestUpdateMessage = Satisfies<
  BaseMessage,
  {
    type: 'REQUEST_UPDATE'
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

// Popup → service worker: the current user's unread @-mentions (in notes or
// comments). Response: DtoMustardMention[] (newest first).
export type GetMyMentionsMessage = Satisfies<
  BaseMessage,
  {
    type: 'GET_MY_MENTIONS'
  }
>

type GetMyMentionsResponse = DtoMustardMention[]

// Popup → service worker: the user acted on a mention notification; delete it.
// Response: void.
export type MarkMentionSeenMessage = Satisfies<
  BaseMessage,
  {
    type: 'MARK_MENTION_SEEN'
    notificationId: string
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
  | GithubLoginMessage
  | GetAtprotoSessionMessage
  | AtprotoLogoutMessage
  | DisconnectProviderMessage
  | GetProfilesMessage
  | GetMutualsMessage
  | GetGithubMentionCandidatesMessage
  | GetNotesVisibleMessage
  | SetNotesVisibleMessage
  | SessionChangedMessage
  | SessionExpiredMessage
  | OpenPopupMessage
  | GetAppStatusMessage
  | RequestUpdateMessage
  | QueryCommentsMessage
  | UpsertCommentMessage
  | DeleteCommentMessage
  | QueryNotificationsForNotesMessage
  | MarkNotificationsSeenForNoteMessage
  | GetMyPagesOverviewMessage
  | GetMyMentionsMessage
  | MarkMentionSeenMessage
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
  ATPROTO_LOGIN: { userId: string; did?: string } | null
  GITHUB_LOGIN: { userId: string } | null
  GET_ATPROTO_SESSION: AtprotoSessionResponse
  ATPROTO_LOGOUT: null
  DISCONNECT_PROVIDER: { accountDeleted: boolean } | null
  GET_PROFILES: GetProfilesResponse
  GET_MUTUALS: GetMutualsResponse
  GET_GITHUB_MENTION_CANDIDATES: GetGithubMentionCandidatesResponse
  GET_NOTES_VISIBLE: boolean
  SET_NOTES_VISIBLE: boolean
  SESSION_CHANGED: void
  SESSION_EXPIRED: void
  OPEN_POPUP: void
  GET_APP_STATUS: AppStatusResponse
  REQUEST_UPDATE: void
  QUERY_COMMENTS: QueryCommentsResponse
  UPSERT_COMMENT: DtoMustardComment[]
  DELETE_COMMENT: DtoMustardComment[]
  QUERY_NOTIFICATIONS_FOR_NOTES: QueryNotificationsForNotesResponse
  MARK_NOTIFICATIONS_SEEN_FOR_NOTE: null
  GET_MY_PAGES_OVERVIEW: DtoMyPagesOverview
  GET_MY_MENTIONS: GetMyMentionsResponse
  MARK_MENTION_SEEN: null
  NOTIFICATIONS_CHANGED: void
}

export type ResponseFor<T extends Message['type']> = MessageResponses[T]

/**
 * Strip Vue reactive Proxies (and any other non-cloneable wrappers) before a
 * message crosses the extension boundary. Firefox's `structuredClone` rejects
 * proxies; Chrome serializes silently. Doing it here means callers never have
 * to remember (see the `cross-browser-webext` skill → Messaging).
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

export function createAtprotoLoginMessage(
  handle: string,
  currentJwt?: string,
): AtprotoLoginMessage {
  return {
    type: 'ATPROTO_LOGIN',
    handle,
    ...(currentJwt !== undefined ? { currentJwt } : {}),
  }
}

export function createGithubLoginMessage(currentJwt?: string): GithubLoginMessage {
  return {
    type: 'GITHUB_LOGIN',
    ...(currentJwt !== undefined ? { currentJwt } : {}),
  }
}

export function createGetAtprotoSessionMessage(): GetAtprotoSessionMessage {
  return {
    type: 'GET_ATPROTO_SESSION',
  }
}

export function createAtprotoLogoutMessage(userId: string): AtprotoLogoutMessage {
  return {
    type: 'ATPROTO_LOGOUT',
    userId,
  }
}

export function createDisconnectProviderMessage(provider: string): DisconnectProviderMessage {
  return {
    type: 'DISCONNECT_PROVIDER',
    provider,
  }
}

export function createGetProfilesMessage(
  userIds: UserId[],
  mentions: MentionTarget[] = [],
): GetProfilesMessage {
  return {
    type: 'GET_PROFILES',
    userIds,
    mentions,
  }
}

export function createGetMutualsMessage(): GetMutualsMessage {
  return {
    type: 'GET_MUTUALS',
  }
}

export function createGetGithubMentionCandidatesMessage(): GetGithubMentionCandidatesMessage {
  return {
    type: 'GET_GITHUB_MENTION_CANDIDATES',
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

export function createGetAppStatusMessage(): GetAppStatusMessage {
  return {
    type: 'GET_APP_STATUS',
  }
}

export function createRequestUpdateMessage(): RequestUpdateMessage {
  return {
    type: 'REQUEST_UPDATE',
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

export function createGetMyMentionsMessage(): GetMyMentionsMessage {
  return {
    type: 'GET_MY_MENTIONS',
  }
}

export function createMarkMentionSeenMessage(notificationId: string): MarkMentionSeenMessage {
  return {
    type: 'MARK_MENTION_SEEN',
    notificationId,
  }
}
