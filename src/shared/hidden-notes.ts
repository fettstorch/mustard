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
 * Filtering happens at RENDER time, not query time (see `filterVisibleNotes` and
 * `MustardState.filterHiddenNotes`). Notes still load in full, which is what keeps
 * un-hiding instant and leaves the notification deep-link repair path working
 * untouched.
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

export async function hideNote(ref: HiddenNoteRef): Promise<void> {
  const store = await readHiddenNoteRefs()
  store[ref.noteId] = ref
  await browser.storage.local.set({ [HIDDEN_NOTES_KEY]: store })
}

export async function unhideNote(noteId: string): Promise<void> {
  const store = await readHiddenNoteRefs()
  if (!(noteId in store)) return
  delete store[noteId]
  await browser.storage.local.set({ [HIDDEN_NOTES_KEY]: store })
}

export async function unhideAll(): Promise<void> {
  await browser.storage.local.set({ [HIDDEN_NOTES_KEY]: {} })
}

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
  filterHiddenNotes: boolean,
): MustardNote[] {
  if (!filterHiddenNotes) return notes
  return notes.filter((note) => !note.id || !hiddenNoteIds[note.id])
}
