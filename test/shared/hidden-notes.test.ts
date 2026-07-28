import { beforeEach, describe, expect, it } from 'vitest'
import { fakeBrowser } from 'wxt/testing/fake-browser'
import {
  HIDDEN_NOTES_KEY,
  filterVisibleNotes,
  groupRefsByPage,
  hideNote,
  makeHiddenNoteRef,
  readHiddenNoteIds,
  readHiddenNoteRefs,
  unhideAll,
  unhideNote,
  type HiddenNoteRef,
} from '../../src/shared/hidden-notes'
import type { MustardNote } from '../../src/shared/model/MustardNote'

function makeNote(overrides: Partial<MustardNote> = {}): MustardNote {
  return {
    id: 'note-1',
    authorId: 'author-1',
    content: 'Hello world',
    anchorData: {
      pageUrl: 'https://example.com/page',
      elementSelector: null,
      relativePosition: { xP: 50, yP: 50 },
      clickPosition: { xVw: 50, yPx: 200 },
    },
    updatedAt: new Date('2024-01-01T00:00:00Z'),
    reposterIds: [],
    ...overrides,
  }
}

function makeRef(overrides: Partial<HiddenNoteRef> = {}): HiddenNoteRef {
  return {
    noteId: 'note-1',
    pageUrl: 'https://example.com/page',
    hiddenAt: 1_700_000_000_000,
    ...overrides,
  }
}

describe('hidden-notes storage', () => {
  beforeEach(() => {
    fakeBrowser.reset()
  })

  it('returns an empty record when nothing has ever been hidden', async () => {
    expect(await readHiddenNoteRefs()).toEqual({})
  })

  it('persists a hidden note ref keyed by its note id', async () => {
    const ref = makeRef()
    await hideNote(ref)

    expect(await readHiddenNoteRefs()).toEqual({ 'note-1': ref })
  })

  it('overwrites the existing ref when the same note is hidden twice', async () => {
    await hideNote(makeRef({ hiddenAt: 1 }))
    await hideNote(makeRef({ hiddenAt: 2 }))

    const store = await readHiddenNoteRefs()
    expect(Object.keys(store)).toEqual(['note-1'])
    expect(store['note-1']?.hiddenAt).toBe(2)
  })

  it('removes only the targeted ref when un-hiding one of several hidden notes', async () => {
    await hideNote(makeRef({ noteId: 'note-1' }))
    await hideNote(makeRef({ noteId: 'note-2' }))
    await hideNote(makeRef({ noteId: 'note-3' }))

    await unhideNote('note-2')

    expect(Object.keys(await readHiddenNoteRefs()).sort()).toEqual(['note-1', 'note-3'])
  })

  it('leaves the store untouched when un-hiding a note that was never hidden', async () => {
    await hideNote(makeRef())
    await unhideNote('never-hidden')

    expect(Object.keys(await readHiddenNoteRefs())).toEqual(['note-1'])
  })

  it('clears every ref when un-hiding all', async () => {
    await hideNote(makeRef({ noteId: 'note-1' }))
    await hideNote(makeRef({ noteId: 'note-2' }))

    await unhideAll()

    expect(await readHiddenNoteRefs()).toEqual({})
  })

  it('exposes hidden ids as a lookup map for the render gate', async () => {
    await hideNote(makeRef({ noteId: 'note-1' }))
    await hideNote(makeRef({ noteId: 'note-2' }))

    expect(await readHiddenNoteIds()).toEqual({ 'note-1': true, 'note-2': true })
  })

  it('reads refs written directly to the shared storage key', async () => {
    const ref = makeRef()
    await fakeBrowser.storage.local.set({ [HIDDEN_NOTES_KEY]: { 'note-1': ref } })

    expect(await readHiddenNoteRefs()).toEqual({ 'note-1': ref })
  })
})

describe('makeHiddenNoteRef', () => {
  it('returns null for a note that has no id yet', () => {
    expect(makeHiddenNoteRef(makeNote({ id: null }), 123)).toBeNull()
  })

  it('takes the page url from the note anchor data', () => {
    const note = makeNote({
      anchorData: { ...makeNote().anchorData, pageUrl: 'https://other.example/thing' },
    })

    expect(makeHiddenNoteRef(note, 123)).toEqual({
      noteId: 'note-1',
      pageUrl: 'https://other.example/thing',
      hiddenAt: 123,
    })
  })
})

describe('groupRefsByPage', () => {
  it('collapses several refs on the same page into one entry', () => {
    const refs = [
      makeRef({ noteId: 'a', pageUrl: 'https://example.com/one' }),
      makeRef({ noteId: 'b', pageUrl: 'https://example.com/one' }),
    ]

    expect(groupRefsByPage(refs)).toEqual([
      { pageUrl: 'https://example.com/one', noteIds: ['a', 'b'] },
    ])
  })

  it('keeps refs on different pages as separate entries', () => {
    const refs = [
      makeRef({ noteId: 'a', pageUrl: 'https://example.com/one' }),
      makeRef({ noteId: 'b', pageUrl: 'https://example.com/two' }),
      makeRef({ noteId: 'c', pageUrl: 'https://example.com/one' }),
    ]

    expect(groupRefsByPage(refs)).toEqual([
      { pageUrl: 'https://example.com/one', noteIds: ['a', 'c'] },
      { pageUrl: 'https://example.com/two', noteIds: ['b'] },
    ])
  })

  it('returns nothing for an empty ref list', () => {
    expect(groupRefsByPage([])).toEqual([])
  })
})

describe('filterVisibleNotes', () => {
  const visible = makeNote({ id: 'visible' })
  const hidden = makeNote({ id: 'hidden' })
  const hiddenIds = { hidden: true }

  it('removes hidden notes when filtering is enabled', () => {
    expect(filterVisibleNotes([visible, hidden], hiddenIds, true)).toEqual([visible])
  })

  it('returns every note including hidden ones when filtering is disabled', () => {
    expect(filterVisibleNotes([visible, hidden], hiddenIds, false)).toEqual([visible, hidden])
  })

  it('keeps notes that have no id, since an unsaved note cannot be hidden', () => {
    const unsaved = makeNote({ id: null })

    expect(filterVisibleNotes([unsaved, hidden], hiddenIds, true)).toEqual([unsaved])
  })

  it('preserves the incoming order of the notes it keeps', () => {
    const first = makeNote({ id: 'first' })
    const second = makeNote({ id: 'second' })

    expect(filterVisibleNotes([second, hidden, first], hiddenIds, true)).toEqual([second, first])
  })

  it('returns every note when nothing is hidden', () => {
    expect(filterVisibleNotes([visible, hidden], {}, true)).toEqual([visible, hidden])
  })
})
