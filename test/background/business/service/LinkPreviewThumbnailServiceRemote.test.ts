import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { exists, getSupabaseJwt } = vi.hoisted(() => ({
  exists: vi.fn().mockResolvedValue({ data: false, error: null }),
  getSupabaseJwt: vi.fn().mockResolvedValue('test-jwt'),
}))

vi.mock('@/background/auth/SupabaseAuth', () => ({ getSupabaseJwt }))
vi.mock('@/background/supabase-client', () => ({
  supabase: { storage: { from: () => ({ exists }) } },
}))

import {
  deleteLinkPreviewThumbnail,
  ensureLinkPreviewThumbnailStored,
  isLinkPreviewThumbnailPath,
  prepareLinkPreviewThumbnail,
} from '../../../../src/background/business/service/LinkPreviewThumbnailServiceRemote'

const webpBytes = new Uint8Array([82, 73, 70, 70, 4, 0, 0, 0, 87, 69, 66, 80, 116, 105, 110, 121])
const imageBase64 = btoa(String.fromCharCode(...webpBytes))
const imageDataUrl = `data:image/webp;base64,${imageBase64}`
const hash = 'ef517384f3ee8db7ec04e394b828f8efd5227111baafa61bae3bb19995ec3f28'
const path = `global/${hash}.webp`

describe('LinkPreviewThumbnailServiceRemote paths', () => {
  beforeEach(() => {
    exists.mockReset().mockResolvedValue({ data: false, error: null })
    getSupabaseJwt.mockReset().mockResolvedValue('test-jwt')
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ stored: true }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      ),
    )
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('accepts only a bounded global content-hash bitmap path', () => {
    expect(isLinkPreviewThumbnailPath(path)).toBe(true)
    expect(isLinkPreviewThumbnailPath(`${hash}.webp`)).toBe(false)
    expect(isLinkPreviewThumbnailPath(`global/nested/${hash}.webp`)).toBe(false)
    expect(isLinkPreviewThumbnailPath(`global/../${hash}.webp`)).toBe(false)
    expect(isLinkPreviewThumbnailPath('global/not-a-hash.webp')).toBe(false)
    expect(isLinkPreviewThumbnailPath(`global/${hash}.png`)).toBe(false)
  })

  it('derives the immutable global path from the bounded WebP content', async () => {
    await expect(
      prepareLinkPreviewThumbnail({ url: 'https://mustardnotes.com/', imageDataUrl }),
    ).resolves.toEqual({
      preview: {
        url: 'https://mustardnotes.com/',
        thumbnailPath: path,
        imageDataUrl,
      },
      thumbnail: {
        path,
        blob: expect.any(Blob),
      },
    })
  })

  it('uses the authenticated remote service to store a new global thumbnail', async () => {
    await expect(
      ensureLinkPreviewThumbnailStored({
        path,
        blob: new Blob([webpBytes], { type: 'image/webp' }),
      }),
    ).resolves.toBe(true)

    expect(fetch).toHaveBeenCalledWith(
      expect.stringContaining('/functions/v1/link-preview-thumbnail'),
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ Authorization: 'Bearer test-jwt' }),
      }),
    )
    const request = vi.mocked(fetch).mock.calls[0]?.[1]
    expect(JSON.parse(String(request?.body))).toEqual({
      action: 'ensure',
      path,
      imageBase64,
    })
  })

  it('reuses an existing global thumbnail without invoking a write', async () => {
    exists.mockResolvedValueOnce({ data: true, error: null })

    await expect(
      ensureLinkPreviewThumbnailStored({
        path,
        blob: new Blob([webpBytes], { type: 'image/webp' }),
      }),
    ).resolves.toBe(true)
    expect(fetch).not.toHaveBeenCalled()
  })

  it('delegates reference-safe cleanup to the authenticated remote service', async () => {
    await expect(deleteLinkPreviewThumbnail(path)).resolves.toBeUndefined()
    const request = vi.mocked(fetch).mock.calls[0]?.[1]
    expect(JSON.parse(String(request?.body))).toEqual({ action: 'cleanup', path })
    expect(request?.headers).toMatchObject({ Authorization: 'Bearer test-jwt' })
  })

  it('does not accept another image type or fake WebP bytes', async () => {
    await expect(
      prepareLinkPreviewThumbnail({
        url: 'https://mustardnotes.com/',
        imageDataUrl: 'data:image/png;base64,dGlueQ==',
      }),
    ).resolves.toEqual({ preview: { url: 'https://mustardnotes.com/' } })
    await expect(
      prepareLinkPreviewThumbnail({
        url: 'https://mustardnotes.com/',
        imageDataUrl: `data:image/webp;base64,${btoa('tiny')}`,
      }),
    ).resolves.toEqual({ preview: { url: 'https://mustardnotes.com/' } })
    expect(fetch).not.toHaveBeenCalled()
  })
})
