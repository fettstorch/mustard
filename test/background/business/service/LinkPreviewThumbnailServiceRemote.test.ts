import { describe, expect, it, vi } from 'vitest'

const { exists, upload } = vi.hoisted(() => ({
  exists: vi.fn().mockResolvedValue({ data: false, error: null }),
  upload: vi.fn().mockResolvedValue({ error: null }),
}))

vi.mock('@/background/supabase-client', () => ({
  supabase: { storage: { from: () => ({ exists, upload }) } },
}))

import {
  ensureLinkPreviewThumbnailStored,
  isLinkPreviewThumbnailPath,
  isLinkPreviewThumbnailPathForAuthor,
  prepareLinkPreviewThumbnail,
} from '../../../../src/background/business/service/LinkPreviewThumbnailServiceRemote'

describe('LinkPreviewThumbnailServiceRemote paths', () => {
  const owner = '11111111-1111-4111-8111-111111111111'
  const hash = '8950abfda7b727630760dd35bcf5c3daa7631aff223a90f7728c0d2521dde10c'

  it('accepts only a bounded owner/content-hash bitmap path', () => {
    const path = `${owner}/${hash}.webp`
    expect(isLinkPreviewThumbnailPath(path)).toBe(true)
    expect(isLinkPreviewThumbnailPathForAuthor(path, owner)).toBe(true)
    expect(isLinkPreviewThumbnailPathForAuthor(path, '33333333-3333-4333-8333-333333333333')).toBe(
      false,
    )
  })

  it('rejects nested, traversal, non-hash, and executable paths', () => {
    expect(isLinkPreviewThumbnailPath(`${owner}/nested/${hash}.webp`)).toBe(false)
    expect(isLinkPreviewThumbnailPath(`${owner}/../${hash}.webp`)).toBe(false)
    expect(isLinkPreviewThumbnailPath(`${owner}/not-a-hash.webp`)).toBe(false)
    expect(isLinkPreviewThumbnailPath(`${owner}/${hash}.png`)).toBe(false)
  })

  it('derives the immutable path from the bounded WebP content', async () => {
    const imageDataUrl = `data:image/webp;base64,${btoa('tiny')}`

    await expect(
      prepareLinkPreviewThumbnail({ url: 'https://mustardnotes.com/', imageDataUrl }, owner),
    ).resolves.toEqual({
      preview: {
        url: 'https://mustardnotes.com/',
        thumbnailPath: `${owner}/${hash}.webp`,
        imageDataUrl,
      },
      thumbnail: {
        path: `${owner}/${hash}.webp`,
        blob: expect.any(Blob),
      },
    })
  })

  it('stores a new immutable thumbnail without upsert', async () => {
    exists.mockResolvedValueOnce({ data: false, error: null })

    await expect(
      ensureLinkPreviewThumbnailStored({
        path: `${owner}/${hash}.webp`,
        blob: new Blob(['tiny'], { type: 'image/webp' }),
      }),
    ).resolves.toBe(true)
    expect(upload).toHaveBeenCalledWith(
      `${owner}/${hash}.webp`,
      expect.any(Blob),
      expect.objectContaining({ contentType: 'image/webp', upsert: false }),
    )
  })

  it('reuses an existing thumbnail without uploading its bytes again', async () => {
    exists.mockResolvedValueOnce({ data: true, error: null })
    upload.mockClear()

    await expect(
      ensureLinkPreviewThumbnailStored({
        path: `${owner}/${hash}.webp`,
        blob: new Blob(['tiny'], { type: 'image/webp' }),
      }),
    ).resolves.toBe(true)
    expect(upload).not.toHaveBeenCalled()
  })

  it('treats a concurrent immutable upload as successful reuse', async () => {
    exists.mockResolvedValueOnce({ data: false, error: null })
    upload.mockResolvedValueOnce({
      error: { status: 409, statusCode: 'ResourceAlreadyExists', message: 'already exists' },
    })

    await expect(
      ensureLinkPreviewThumbnailStored({
        path: `${owner}/${hash}.webp`,
        blob: new Blob(['tiny'], { type: 'image/webp' }),
      }),
    ).resolves.toBe(true)
  })

  it('does not upload another image type', async () => {
    upload.mockClear()

    await expect(
      prepareLinkPreviewThumbnail(
        { url: 'https://mustardnotes.com/', imageDataUrl: 'data:image/png;base64,dGlueQ==' },
        owner,
      ),
    ).resolves.toEqual({ preview: { url: 'https://mustardnotes.com/' } })
    expect(upload).not.toHaveBeenCalled()
  })
})
