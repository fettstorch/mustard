import { reactive } from 'vue'
import type { MustardNoteAnchorData } from '@/shared/model/MustardNoteAnchorData'
import type { MustardNote } from '@/shared/model/MustardNote'
import type { MustardComment } from '@/shared/model/MustardComment'
import type { UserProfile, UserProfileType } from '@/shared/model/UserProfile'

export type MustardState = {
  currentUserId: string | null
  /** Providers linked to the current account, driving provider-specific copy (e.g. the publish warning). Empty when logged out. */
  connectedProviders: UserProfileType[]
  editor: {
    isOpen: boolean
    anchor: MustardNoteAnchorData | null
  }
  notes: MustardNote[]
  /** Note IDs currently being synced (publishing, deleting) - actions should be disabled */
  pendingNoteIds: Record<string, boolean>
  /** Cached profiles for note + comment authors (authorId -> profile) */
  profiles: Record<string, UserProfile | null>
  /** Whether notes are currently shown on this page (toggled via popup, in-memory only) */
  areNotesVisible: boolean
  /** Whether notes are shown in minimized form (global preference, persisted in chrome.storage.local) */
  areNotesMinimized: boolean
  /** Whether anchor data is shown in the note editor (global preference, persisted in chrome.storage.local) */
  showAnchorInEditor: boolean
  /** True when this build is below the backend's minimum: remote writes are blocked, so the UI disables publish/comment controls. */
  clientOutdated: boolean

  // --- Comments ---
  /** noteId -> comments sorted oldest → newest. Missing means "not fetched yet". */
  comments: Record<string, MustardComment[]>
  /** noteId -> load state for that note's comments */
  commentsLoadState: Record<string, 'idle' | 'loading' | 'loaded'>
  /** noteId -> whether the comment thread is currently expanded (in-memory only) */
  expandedCommentNoteIds: Record<string, boolean>
  /** Comment IDs currently syncing (insert/delete) */
  pendingCommentIds: Record<string, boolean>
  /** Per-note pending flag for the "add comment" submit button */
  pendingCommentForNoteIds: Record<string, boolean>

  // --- Notifications ---
  /** noteId -> count of unread notifications. 0/missing == none. */
  unreadByNoteId: Record<string, number>
}

export function createMustardState(): MustardState {
  return reactive({
    currentUserId: null,
    connectedProviders: [],
    editor: {
      isOpen: false,
      anchor: null,
    },
    notes: [],
    pendingNoteIds: {},
    profiles: {},
    areNotesVisible: true,
    areNotesMinimized: false,
    showAnchorInEditor: false,
    clientOutdated: false,

    comments: {},
    commentsLoadState: {},
    expandedCommentNoteIds: {},
    pendingCommentIds: {},
    pendingCommentForNoteIds: {},

    unreadByNoteId: {},
  })
}
