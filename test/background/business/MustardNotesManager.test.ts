import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fakeBrowser } from 'wxt/testing/fake-browser'
import type { MustardNote } from '../../../src/shared/model/MustardNote'

// The remote service is a module-scoped singleton that talks to Supabase, so it's
// mocked wholesale; the local service runs for real against fakeBrowser storage.
vi.mock('../../../src/background/business/service/MustardNotesServiceRemote', () => ({
  mustardNotesServiceRemote: {
    queryNotes: vi.fn(),
    queryNotesByIds: vi.fn(),
    queryAllNotesForPage: vi.fn(),
    queryIndex: vi.fn(),
    upsertNote: vi.fn(),
    deleteNote: vi.fn(),
    repostNote: vi.fn(),
    unrepostNote: vi.fn(),
  },
}))

const { mustardNotesManager } = await import('../../../src/background/business/MustardNotesManager')
const { mustardNotesServiceRemote } =
  await import('../../../src/background/business/service/MustardNotesServiceRemote')
const { MustardNotesServiceLocal } =
  await import('../../../src/background/business/service/MustardNotesServiceLocal')
const { HIDDEN_NOTES_KEY } = await import('../../../src/shared/hidden-notes')

const remote = vi.mocked(mustardNotesServiceRemote)

const PAGE = 'https://example.com/page'

function makeNote(overrides: Partial<MustardNote> = {}): MustardNote {
  return {
    id: 'note-1',
    authorId: 'author-1',
    content: 'Hello world',
    anchorData: {
      pageUrl: PAGE,
      elementSelector: null,
      relativePosition: { xP: 50, yP: 50 },
      clickPosition: { xVw: 50, yPx: 200 },
    },
    updatedAt: new Date('2024-01-01T00:00:00Z'),
    reposterIds: [],
    ...overrides,
  }
}

describe('MustardNotesManager.queryMustardNotesByIds', () => {
  beforeEach(() => {
    fakeBrowser.reset()
    vi.clearAllMocks()
    remote.queryNotesByIds.mockResolvedValue([])
  })

  it('resolves a published note by id for its page', async () => {
    const published = makeNote({ id: 'remote-1' })
    remote.queryNotesByIds.mockResolvedValue([published])

    const notes = await mustardNotesManager.queryMustardNotesByIds(PAGE, ['remote-1'])

    expect(notes.map((n) => n.id)).toEqual(['remote-1'])
    expect(remote.queryNotesByIds).toHaveBeenCalledWith(PAGE, ['remote-1'])
  })

  it('also resolves an unpublished local note by id, which the remote service cannot see', async () => {
    const local = new MustardNotesServiceLocal()
    await local.upsertNote(makeNote({ id: 'local-1', authorId: 'local' }))

    const notes = await mustardNotesManager.queryMustardNotesByIds(PAGE, ['local-1'])

    expect(notes.map((n) => n.id)).toEqual(['local-1'])
  })

  it('returns only the requested ids when the page holds other local notes too', async () => {
    const local = new MustardNotesServiceLocal()
    await local.upsertNote(makeNote({ id: 'local-1', authorId: 'local' }))
    await local.upsertNote(makeNote({ id: 'local-2', authorId: 'local' }))

    const notes = await mustardNotesManager.queryMustardNotesByIds(PAGE, ['local-2'])

    expect(notes.map((n) => n.id)).toEqual(['local-2'])
  })

  it('merges local and remote hits for the same page', async () => {
    const local = new MustardNotesServiceLocal()
    await local.upsertNote(makeNote({ id: 'local-1', authorId: 'local' }))
    remote.queryNotesByIds.mockResolvedValue([makeNote({ id: 'remote-1' })])

    const notes = await mustardNotesManager.queryMustardNotesByIds(PAGE, ['local-1', 'remote-1'])

    expect(notes.map((n) => n.id).sort()).toEqual(['local-1', 'remote-1'])
  })

  it('still rejects when the remote query throws, so deep-link repair can tell "gone" from "failed"', async () => {
    remote.queryNotesByIds.mockRejectedValue(new Error('network down'))

    await expect(mustardNotesManager.queryMustardNotesByIds(PAGE, ['remote-1'])).rejects.toThrow(
      'network down',
    )
  })

  it('returns an empty array without querying when given no ids', async () => {
    const notes = await mustardNotesManager.queryMustardNotesByIds(PAGE, [])

    expect(notes).toEqual([])
    expect(remote.queryNotesByIds).not.toHaveBeenCalled()
  })
})

describe('MustardNotesManager hidden notes', () => {
  beforeEach(() => {
    fakeBrowser.reset()
    vi.clearAllMocks()
    remote.queryNotes.mockResolvedValue([])
  })

  it('still returns hidden notes from a page query, because hiding is applied at render time', async () => {
    const local = new MustardNotesServiceLocal()
    await local.upsertNote(makeNote({ id: 'local-1', authorId: 'local' }))
    await fakeBrowser.storage.local.set({
      [HIDDEN_NOTES_KEY]: {
        'local-1': { noteId: 'local-1', pageUrl: PAGE, hiddenAt: 1 },
      },
    })

    const notes = await mustardNotesManager.queryMustardNotesFor(PAGE)

    expect(notes.map((n) => n.id)).toEqual(['local-1'])
  })

  it('still returns hidden notes from a local-only page query', async () => {
    const local = new MustardNotesServiceLocal()
    await local.upsertNote(makeNote({ id: 'local-1', authorId: 'local' }))
    await fakeBrowser.storage.local.set({
      [HIDDEN_NOTES_KEY]: {
        'local-1': { noteId: 'local-1', pageUrl: PAGE, hiddenAt: 1 },
      },
    })

    const notes = await mustardNotesManager.queryLocalNotesFor(PAGE)

    expect(notes.map((n) => n.id)).toEqual(['local-1'])
  })
})
