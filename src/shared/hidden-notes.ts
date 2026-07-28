import { synchronize } from '@fettstorch/jule'
import type { MustardNote } from './model/MustardNote'

/**
 * Per-note "hide this for good" list.
 *
 * Stored locally in `browser.storage.local` rather than in a Supabase table —
 * hiding is a viewer-side preference, so it needs no schema, no edge function and
 * no write permission. Like all note loading, the feature otherwise assumes a
 * logged-in user.
 *
 * Only ids are persisted, never a copy of the note: the Options gallery re-loads
 * the real notes on demand so previews always show current content. The cost is
 * that a note deleted by its author can only be reported, not rendered.
 *
 * Filtering happens at RENDER time, not query time (see `filterVisibleNotes`).
 * Notes still load in full, which keeps un-hiding instant and lets notification
 * focus temporarily reveal only the intended hidden note.
 */

export const HIDDEN_NOTES_KEY = 'mustard-hidden-notes'

/** A pointer to a hidden note. No content snapshot — see the module comment. */
export type HiddenNoteRef = {
  noteId: string
  /**
   * Addressing key, not decoration: `queryMustardNotesByIds` is per-page, and
   * local notes are stored per-page in `browser.storage.local`.
   */
  pageUrl: string
  /** Unix ms — sorts the Options gallery "most recently hidden first". */
  hiddenAt: number
}

/** Persisted shape at `browser.storage.local[HIDDEN_NOTES_KEY]`, keyed by note id. */
export type HiddenNotesStore = Record<string, HiddenNoteRef>

export async function readHiddenNoteRefs(): Promise<HiddenNotesStore> {
  const result = await browser.storage.local.get(HIDDEN_NOTES_KEY)
  return (result[HIDDEN_NOTES_KEY] ?? {}) as HiddenNotesStore
}

/** Note ids as a map, for O(1) reads in the render gate. */
export async function readHiddenNoteIds(): Promise<Record<string, boolean>> {
  return toHiddenNoteIds(await readHiddenNoteRefs())
}

export function toHiddenNoteIds(store: HiddenNotesStore): Record<string, boolean> {
  const ids: Record<string, boolean> = {}
  for (const noteId of Object.keys(store)) ids[noteId] = true
  return ids
}

/**
 * One lock shared by every hidden-set mutation, so hide / un-hide / un-hide-all
 * run one at a time and can't read-modify-write over each other — a rapid burst
 * of hides in a tab, or un-hides in the options gallery, would otherwise let a
 * later write clobber an earlier one.
 *
 * The queue is per-JS-realm (content script, options page and background each
 * get their own), which is all a viewer-side preference needs: the only race
 * left is two *separate* tabs mutating inside a single storage round-trip, which
 * isn't a real usage pattern here, and storage.local offers no atomic
 * compare-and-swap to close it without funnelling writes through one context.
 */
const storeMutationLock = {}

export const hideNote = synchronize(async (ref: HiddenNoteRef): Promise<void> => {
  const store = await readHiddenNoteRefs()
  store[ref.noteId] = ref
  await browser.storage.local.set({ [HIDDEN_NOTES_KEY]: store })
}, storeMutationLock)

export const unhideNote = synchronize(async (noteId: string): Promise<void> => {
  const store = await readHiddenNoteRefs()
  if (!(noteId in store)) return
  delete store[noteId]
  await browser.storage.local.set({ [HIDDEN_NOTES_KEY]: store })
}, storeMutationLock)

export const unhideAll = synchronize(async (): Promise<void> => {
  await browser.storage.local.set({ [HIDDEN_NOTES_KEY]: {} })
}, storeMutationLock)

/**
 * Build a ref for a note. Returns null for a note with no id yet — an optimistic
 * `optimistic-…` placeholder has no stable id to record, so it can't be hidden.
 */
export function makeHiddenNoteRef(note: MustardNote, hiddenAt: number): HiddenNoteRef | null {
  if (!note.id) return null
  return {
    noteId: note.id,
    pageUrl: note.anchorData.pageUrl,
    hiddenAt,
  }
}

/**
 * Collapse refs into the per-page shape `QUERY_NOTES_BY_IDS` takes, so the Options
 * gallery issues one query per distinct page rather than one per note.
 */
export function groupRefsByPage(refs: HiddenNoteRef[]): { pageUrl: string; noteIds: string[] }[] {
  const byPage = new Map<string, string[]>()
  for (const ref of refs) {
    const ids = byPage.get(ref.pageUrl)
    if (ids) {
      ids.push(ref.noteId)
    } else {
      byPage.set(ref.pageUrl, [ref.noteId])
    }
  }
  return [...byPage].map(([pageUrl, noteIds]) => ({ pageUrl, noteIds }))
}

/**
 * The render gate. Kept as a pure function (rather than inline in the Vue computed
 * that calls it) so it's unit-testable — the project has no component test setup.
 *
 * Notes without an id are always kept: they're unsaved drafts, which can't be in
 * the hidden set anyway.
 */
export function filterVisibleNotes(
  notes: MustardNote[],
  hiddenNoteIds: Record<string, boolean>,
  revealedHiddenNoteIds: Record<string, boolean>,
): MustardNote[] {
  return notes.filter(
    (note) => !note.id || !hiddenNoteIds[note.id] || revealedHiddenNoteIds[note.id],
  )
}
