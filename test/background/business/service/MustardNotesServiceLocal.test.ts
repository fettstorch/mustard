import { beforeEach, describe, expect, it } from 'vitest'
import { fakeBrowser } from 'wxt/testing/fake-browser'
import { MustardNotesServiceLocal } from '../../../../src/background/business/service/MustardNotesServiceLocal'
import type { MustardNote } from '../../../../src/shared/model/MustardNote'

function makeNote(overrides: Partial<MustardNote> = {}): MustardNote {
  return {
    id: 'note-1',
    authorId: 'local',
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

describe('MustardNotesServiceLocal', () => {
  let service: MustardNotesServiceLocal

  beforeEach(() => {
    fakeBrowser.reset()
    service = new MustardNotesServiceLocal()
  })

  it('returns empty array when no notes exist for a page', async () => {
    const notes = await service.queryNotes('https://example.com/page')
    expect(notes).toEqual([])
  })

  it('returns empty index when storage is empty', async () => {
    const index = await service.queryIndex()
    expect(index.entries()).toHaveLength(0)
  })

  it('creates a note and retrieves it', async () => {
    const note = makeNote()
    await service.upsertNote(note)

    const notes = await service.queryNotes(note.anchorData.pageUrl)
    expect(notes).toHaveLength(1)
    expect(notes[0]?.content).toBe('Hello world')
    expect(notes[0]?.id).toBe('note-1')
  })

  it('persists an explicitly dismissed link preview', async () => {
    const note = makeNote({
      content: 'https://example.com/article',
      linkPreviewDismissed: true,
    })
    await service.upsertNote(note)

    const notes = await service.queryNotes(note.anchorData.pageUrl)
    expect(notes[0]?.linkPreview).toBeUndefined()
    expect(notes[0]?.linkPreviewDismissed).toBe(true)
  })

  it('updates an existing note (same id)', async () => {
    const note = makeNote()
    await service.upsertNote(note)
    await service.upsertNote({ ...note, content: 'Updated content' })

    const notes = await service.queryNotes(note.anchorData.pageUrl)
    expect(notes).toHaveLength(1)
    expect(notes[0]?.content).toBe('Updated content')
  })

  it('adds the page to the index after upsert', async () => {
    const note = makeNote()
    await service.upsertNote(note)

    const index = await service.queryIndex()
    const pages = index.getPagesForUser('local')
    expect(pages).toContain('https://example.com/page')
  })

  it('deletes a note and removes it from the page', async () => {
    const note = makeNote()
    await service.upsertNote(note)
    await service.deleteNote('note-1', note.anchorData.pageUrl)

    const notes = await service.queryNotes(note.anchorData.pageUrl)
    expect(notes).toHaveLength(0)
  })

  it('removes the page from the index when the last note is deleted', async () => {
    const note = makeNote()
    await service.upsertNote(note)
    await service.deleteNote('note-1', note.anchorData.pageUrl)

    const index = await service.queryIndex()
    const pages = index.getPagesForUser('local')
    expect(pages).toHaveLength(0)
  })

  it('keeps remaining notes after deleting one', async () => {
    const page = 'https://example.com/page'
    await service.upsertNote(makeNote({ id: 'note-1' }))
    await service.upsertNote(makeNote({ id: 'note-2', content: 'Second note' }))

    await service.deleteNote('note-1', page)

    const notes = await service.queryNotes(page)
    expect(notes).toHaveLength(1)
    expect(notes[0]?.id).toBe('note-2')
  })
})
