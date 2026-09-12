import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { fakeBrowser } from 'wxt/testing/fake-browser'
import { MinimumVersionCriterion } from '@/background/business/service/extension-update/MinimumVersionCriterion'

// Use WXT's supported test browser with the APIs absent on Safari removed.
vi.mock('wxt/browser', async () => {
  const { fakeBrowser } = await import('wxt/testing/fake-browser')
  const runtime = new Proxy(fakeBrowser.runtime, {
    get(target, key) {
      if (key === 'requestUpdateCheck' || key === 'onUpdateAvailable') return undefined
      return Reflect.get(target, key)
    },
  })
  return {
    browser: new Proxy(fakeBrowser, {
      get(target, key) {
        if (key === 'identity' || key === 'notifications') return undefined
        if (key === 'runtime') return runtime
        return Reflect.get(target, key)
      },
    }),
  }
})

beforeEach(() => {
  fakeBrowser.reset()
  vi.stubEnv('BROWSER', 'safari')
  vi.spyOn(fakeBrowser.runtime, 'getManifest').mockReturnValue({ version: '2.14.2' } as never)
  vi.spyOn(fakeBrowser.runtime, 'sendMessage').mockResolvedValue(undefined)
  vi.spyOn(fakeBrowser.tabs, 'query').mockResolvedValue([])
  vi.spyOn(fakeBrowser.contextMenus, 'removeAll').mockResolvedValue(undefined)
  vi.spyOn(fakeBrowser.contextMenus, 'create').mockReturnValue('mustard-add-note')
  vi.spyOn(fakeBrowser.contextMenus.onClicked, 'addListener').mockImplementation(() => {})
  vi.spyOn(fakeBrowser.commands.onCommand, 'addListener').mockImplementation(() => {})
  vi.spyOn(fakeBrowser.action, 'setBadgeText').mockResolvedValue(undefined)
  vi.spyOn(MinimumVersionCriterion.prototype, 'getMinimumVersion').mockResolvedValue('0.0.0')
  vi.spyOn(console, 'log').mockImplementation(() => {})
  vi.spyOn(console, 'debug').mockImplementation(() => {})
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllEnvs()
})

it('starts the real background and handles local-note/status messages without Safari-absent APIs', async () => {
  const listen = vi.spyOn(fakeBrowser.runtime.onMessage, 'addListener')
  const { default: background } = await import('@/entrypoints/background')
  background.main()
  expect(listen).toHaveBeenCalledOnce()
  const receive = listen.mock.calls[0]![0]
  const send = (message: unknown) => receive(message, {}, () => {})
  expect(await send({ type: 'GET_ATPROTO_SESSION' })).toBeNull()
  expect(await send({ type: 'CHECK_EXTENSION_UPDATE' })).toMatchObject({ status: 'unavailable' })
  const anchorData = {
    pageUrl: 'https://example.com/safari-test',
    elementSelector: 'p',
    relativePosition: { xP: 50, yP: 50 },
    clickPosition: { xVw: 50, yPx: 100 },
  }
  const saved = await send({
    type: 'UPSERT_NOTE',
    target: 'local',
    data: {
      content: 'Safari local note',
      anchorData,
      updatedAt: Date.now(),
      linkPreviewDismissed: true,
    },
  })
  expect(saved).toEqual({
    ok: true,
    data: [expect.objectContaining({ authorId: 'local', content: 'Safari local note' })],
  })
  expect(saved).toEqual({
    ok: true,
    data: await send({ type: 'QUERY_NOTES', pageUrl: anchorData.pageUrl }),
  })
  expect(fakeBrowser.contextMenus.create).toHaveBeenCalledWith({
    id: 'mustard-add-note',
    title: 'Add Mustard',
    contexts: ['all'],
  })
})
