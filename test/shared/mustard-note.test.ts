import { describe, expect, it } from 'vitest'
import { DtoMustardNote } from '../../src/shared/dto/DtoMustardNote'
import type { MustardNote } from '../../src/shared/model/MustardNote'

const anchorData = {
  pageUrl: 'https://example.com/page',
  elementSelector: '#video',
  relativePosition: { xP: 25, yP: 75 },
  clickPosition: { xVw: 40, yPx: 300 },
}

const videoElementAnchorData = {
  type: 'video' as const,
  startAt: 12.5,
  duration: 8,
}

describe('DtoMustardNote element anchor data', () => {
  it('round-trips optional element metadata without changing the positional anchor', () => {
    const note: MustardNote = {
      id: 'note-1',
      authorId: 'author-1',
      content: 'A note',
      anchorData: { ...anchorData, elementAnchorData: videoElementAnchorData },
      updatedAt: new Date('2024-01-01T00:00:00Z'),
      reposterIds: [],
    }

    const dto = DtoMustardNote.toDto(note)
    const restored = DtoMustardNote.fromDto(dto)

    expect(dto.anchorData.elementAnchorData).toEqual(videoElementAnchorData)
    expect(restored.anchorData.elementAnchorData).toEqual(videoElementAnchorData)
    expect(restored.anchorData).toEqual({
      ...anchorData,
      elementAnchorData: videoElementAnchorData,
    })
  })

  it('keeps element metadata absent for legacy DTOs', () => {
    const restored = DtoMustardNote.fromDto({
      id: 'note-1',
      authorId: 'author-1',
      content: 'A legacy note',
      anchorData,
      updatedAt: 0,
    })

    expect(restored.anchorData.elementAnchorData).toBeUndefined()
  })
})
