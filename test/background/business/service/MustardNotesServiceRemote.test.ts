import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { MustardNote } from '../../../../src/shared/model/MustardNote'

const {
  insert,
  update,
  prepareLinkPreviewThumbnail,
  ensureLinkPreviewThumbnailStored,
  deleteLinkPreviewThumbnail,
} = vi.hoisted(() => ({
  insert: vi.fn(),
  update: vi.fn(),
  prepareLinkPreviewThumbnail: vi.fn(),
  ensureLinkPreviewThumbnailStored: vi.fn(),
  deleteLinkPreviewThumbnail: vi.fn(),
}))

vi.mock('@/background/supabase-client', () => ({
  supabase: { from: () => ({ insert, update }) },
}))
vi.mock('@/background/business/service/LinkPreviewThumbnailServiceRemote', () => ({
  prepareLinkPreviewThumbnail,
  ensureLinkPreviewThumbnailStored,
  deleteLinkPreviewThumbnail,
  isLinkPreviewThumbnailPath: (path: string) => path.startsWith('global/'),
}))

import { mustardNotesServiceRemote } from '../../../../src/background/business/service/MustardNotesServiceRemote'

const thumbnailPath = 'global/thumbnail.webp'
const storedRow = {
  id: 'note-1',
  author_id: 'author-1',
  page_url: 'https://example.com/page',
  content: 'See https://example.com/article',
  link_preview: { url: 'https://example.com/article', thumbnailPath },
  mentions: [],
  element_selector: null,
  relative_position_x: 50,
  relative_position_y: 50,
  click_position_x: 50,
  click_position_y: 200,
  updated_at: '2024-01-01T00:00:00Z',
}

function makeNote(): MustardNote {
  return {
    id: null,
    authorId: 'author-1',
    content: storedRow.content,
    linkPreview: { url: 'https://example.com/article', thumbnailPath },
    reposterIds: [],
    anchorData: {
      pageUrl: storedRow.page_url,
      elementSelector: null,
      relativePosition: { xP: 50, yP: 50 },
      clickPosition: { xVw: 50, yPx: 200 },
    },
    updatedAt: new Date(storedRow.updated_at),
  }
}

describe('MustardNotesServiceRemote', () => {
  beforeEach(() => {
    insert.mockReset().mockReturnValue({
      select: () => ({ single: async () => ({ data: storedRow, error: null }) }),
    })
    update.mockReset().mockReturnValue({
      eq: () => ({
        select: () => ({ single: async () => ({ data: null, error: { message: 'offline' } }) }),
      }),
    })
    prepareLinkPreviewThumbnail.mockReset().mockResolvedValue({
      preview: makeNote().linkPreview,
      thumbnail: { path: thumbnailPath, blob: new Blob() },
    })
    ensureLinkPreviewThumbnailStored.mockReset().mockResolvedValue(false)
    deleteLinkPreviewThumbnail.mockReset().mockRejectedValue(new Error('offline'))
  })

  it('keeps a successfully inserted note when failed thumbnail cleanup is unavailable', async () => {
    await expect(mustardNotesServiceRemote.upsertNote(makeNote())).resolves.toMatchObject({
      id: 'note-1',
      linkPreview: { thumbnailPath },
    })
    expect(deleteLinkPreviewThumbnail).toHaveBeenCalledWith(thumbnailPath)
  })
})
