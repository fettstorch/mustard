import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  resolveLinkPreviewForNote,
  unfurlLinkPreview,
} from '../../../../src/background/business/service/LinkPreviewUnfurlServiceRemote'

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('LinkPreviewUnfurlServiceRemote', () => {
  it('rejects IPv4-mapped IPv6 addresses for loopback and private networks', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>()
    vi.stubGlobal('fetch', fetch)

    await expect(unfurlLinkPreview('http://[::ffff:7f00:1]/')).resolves.toBeUndefined()
    await expect(unfurlLinkPreview('http://[::ffff:a00:1]/')).resolves.toBeUndefined()
    await expect(unfurlLinkPreview('http://[::ffff:c0a8:1]/')).resolves.toBeUndefined()

    expect(fetch).not.toHaveBeenCalled()
  })

  it('allows public DNS names beginning with IPv6 private-range prefixes', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockImplementation(async (url) => {
      const response = new Response('<meta property="og:title" content="Public">', {
        headers: { 'content-type': 'text/html' },
      })
      Object.defineProperty(response, 'url', { value: String(url) })
      return response
    })
    vi.stubGlobal('fetch', fetch)

    await expect(unfurlLinkPreview('https://fda.gov/')).resolves.toMatchObject({ title: 'Public' })
    await expect(unfurlLinkPreview('https://fcbarcelona.com/')).resolves.toMatchObject({
      title: 'Public',
    })
    expect(fetch).toHaveBeenCalledTimes(2)
  })

  it('rejects the complete IPv6 link-local range', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>()
    vi.stubGlobal('fetch', fetch)

    await expect(unfurlLinkPreview('http://[fe80::1]/')).resolves.toBeUndefined()
    await expect(unfurlLinkPreview('http://[fe81::1]/')).resolves.toBeUndefined()
    await expect(unfurlLinkPreview('http://[febf::1]/')).resolves.toBeUndefined()

    expect(fetch).not.toHaveBeenCalled()
  })

  it('fetches a direct page and keeps the authored URL on the card', async () => {
    const response = new Response(
      '<meta property="og:title" content="Mustard"><meta property="og:image" content="/og.jpg">',
      { headers: { 'content-type': 'text/html' } },
    )
    Object.defineProperty(response, 'url', { value: 'https://mustardnotes.com/' })
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(response)
    vi.stubGlobal('fetch', fetch)

    await expect(unfurlLinkPreview('Look at https://mustardnotes.com')).resolves.toEqual({
      url: 'https://mustardnotes.com/',
      title: 'Mustard',
      imageUrl: 'https://mustardnotes.com/og.jpg',
    })
    expect(fetch).toHaveBeenCalledWith(
      'https://mustardnotes.com/',
      expect.objectContaining({ credentials: 'omit', redirect: 'follow' }),
    )
  })

  it('follows redirects and keeps the authored URL on the card', async () => {
    const response = new Response(
      '<meta property="og:title" content="Canonical"><meta property="og:image" content="/og.jpg">',
      { headers: { 'content-type': 'text/html' } },
    )
    Object.defineProperty(response, 'url', { value: 'https://www.redirecting.example/article' })
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(response)
    vi.stubGlobal('fetch', fetch)

    await expect(unfurlLinkPreview('https://redirecting.example/article')).resolves.toEqual({
      url: 'https://redirecting.example/article',
      title: 'Canonical',
      imageUrl: 'https://www.redirecting.example/og.jpg',
    })
    expect(fetch).toHaveBeenCalledWith(
      'https://redirecting.example/article',
      expect.objectContaining({ redirect: 'follow' }),
    )
  })

  it('does not consume a redirect response whose final URL is private', async () => {
    const response = new Response('<meta property="og:title" content="Private">', {
      headers: { 'content-type': 'text/html' },
    })
    Object.defineProperty(response, 'url', { value: 'http://127.0.0.1/private' })
    vi.stubGlobal('fetch', vi.fn<typeof globalThis.fetch>().mockResolvedValue(response))

    await expect(
      unfurlLinkPreview('https://redirecting.example/private-redirect'),
    ).resolves.toBeUndefined()
  })

  it('parses metadata from a bounded prefix of a large HTML page', async () => {
    const response = new Response(
      `<meta property="og:title" content="Large page">${'x'.repeat(256 * 1024)}`,
      { headers: { 'content-type': 'text/html' } },
    )
    Object.defineProperty(response, 'url', { value: 'https://large.example/article' })
    vi.stubGlobal('fetch', vi.fn<typeof globalThis.fetch>().mockResolvedValue(response))

    await expect(unfurlLinkPreview('https://large.example/article')).resolves.toMatchObject({
      title: 'Large page',
    })
  })

  it('times out while a metadata response body is stalled', async () => {
    vi.useFakeTimers()
    let controller: ReadableStreamDefaultController<Uint8Array> | undefined
    const stream = new ReadableStream<Uint8Array>({
      start(streamController) {
        controller = streamController
      },
    })
    const response = new Response(stream, { headers: { 'content-type': 'text/html' } })
    Object.defineProperty(response, 'url', { value: 'https://stalled.example/article' })
    const fetch = vi.fn<typeof globalThis.fetch>().mockImplementation((_url, init) => {
      const signal = init?.signal
      signal?.addEventListener('abort', () => controller?.error(signal.reason), { once: true })
      return Promise.resolve(response)
    })
    vi.stubGlobal('fetch', fetch)

    const preview = unfurlLinkPreview('https://stalled.example/article')
    await vi.advanceTimersByTimeAsync(4_000)

    await expect(preview).resolves.toBeUndefined()
  })

  it('coalesces repeated metadata requests for the same normalized URL', async () => {
    const response = () => {
      const result = new Response('<meta property="og:title" content="Cached">', {
        headers: { 'content-type': 'text/html' },
      })
      Object.defineProperty(result, 'url', { value: 'https://cache.example/article' })
      return result
    }
    const fetch = vi.fn<typeof globalThis.fetch>().mockImplementation(async () => response())
    vi.stubGlobal('fetch', fetch)

    const [first, second] = await Promise.all([
      unfurlLinkPreview('https://cache.example/article'),
      unfurlLinkPreview('Read https://cache.example/article#comments'),
    ])

    expect(first).toEqual(second)
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it('reuses only a bounded editor preview matching the note first URL', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>()
    vi.stubGlobal('fetch', fetch)
    const imageDataUrl = `data:image/webp;base64,${btoa('tiny')}`

    await expect(
      resolveLinkPreviewForNote('See https://supplied.example/page', {
        url: 'https://supplied.example/page',
        title: 'Supplied',
        imageUrl: 'https://supplied.example/og.png',
        imageDataUrl,
      }),
    ).resolves.toEqual({
      url: 'https://supplied.example/page',
      title: 'Supplied',
      imageUrl: 'https://supplied.example/og.png',
      imageDataUrl,
    })
    expect(fetch).not.toHaveBeenCalled()
  })
})
