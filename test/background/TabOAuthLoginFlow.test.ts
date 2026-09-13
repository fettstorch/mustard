import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fakeBrowser } from 'wxt/testing/fake-browser'
import { awaitable } from '@fettstorch/jule'
import { TabOAuthLoginFlow } from '@/background/platform/TabOAuthLoginFlow'
import { authBridgePost } from '@/background/auth/AuthBridge'
import { getSession } from '@/background/auth/SessionStore'
import { TAB_CALLBACK_URI } from '@/shared/oauth-login'

vi.mock('@/background/auth/AuthBridge', () => ({ authBridgePost: vi.fn() }))
vi.mock('@/background/auth/SessionStore', () => ({ getSession: vi.fn() }))

const result = { userId: 'user', jwt: 'jwt', expiresAt: 9999999999, refreshToken: 'refresh' }
const callback = `${TAB_CALLBACK_URI}?code=code&state=state&iss=https%3A%2F%2Fprovider.example`
let url = 'https://provider.example/authorize'

beforeEach(() => {
  fakeBrowser.reset()
  url = 'https://provider.example/authorize'
  vi.mocked(getSession).mockResolvedValue(null)
  vi.mocked(authBridgePost).mockImplementation(async (request) =>
    request.action === 'initiate' ? { state: 'state', authUrl: url } : result,
  )
  vi.spyOn(browser.tabs.onUpdated, 'addListener').mockImplementation(() => {})
  vi.spyOn(browser.tabs.onRemoved, 'addListener').mockImplementation(() => {})
  vi.spyOn(browser.tabs, 'create').mockResolvedValue({ id: 7 } as never)
  vi.spyOn(browser.tabs, 'update').mockResolvedValue({ id: 7 } as never)
  vi.spyOn(browser.tabs, 'get').mockImplementation(async () => ({ id: 7, url }) as never)
  vi.spyOn(browser.tabs, 'remove').mockResolvedValue(undefined)
  vi.spyOn(browser.runtime, 'getManifest').mockReturnValue({ version: '2.14.2' } as never)
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.clearAllMocks()
})

async function begin() {
  const flow = new TabOAuthLoginFlow()
  const complete = vi.fn().mockResolvedValue(undefined)
  flow.initialize(complete)
  expect(await flow.start({ provider: 'atproto', handle: 'test.example' })).toEqual({
    pending: true,
  })
  return { flow, complete }
}

describe('tab login background recovery', () => {
  it.each(['reading storage', 'waiting in the queue'])(
    'honors cancellation while a callback is %s',
    async (position) => {
      const queued = position === 'waiting in the queue'
      const { flow, complete } = await begin()
      const reading = awaitable()
      const release = awaitable()
      const get = browser.storage.session.get.bind(browser.storage.session)
      vi.spyOn(browser.storage.session, 'get').mockImplementationOnce(async (...args) => {
        reading.resolve()
        await release
        return get(...args)
      })
      const update = vi.mocked(browser.tabs.onUpdated.addListener).mock.calls[0]![0]
      update(7, { url: queued ? url : callback }, {} as never)
      await reading
      if (queued) update(7, { url: callback }, {} as never)
      const cancelled = flow.cancel()
      release.resolve()
      expect(await cancelled).toBe(true)
      expect(complete).not.toHaveBeenCalled()
      expect(authBridgePost).toHaveBeenCalledTimes(1)
      expect(await flow.getStatus()).toEqual({ status: 'idle' })
    },
  )

  it('finishes a persisted session in a fresh background without repeating OAuth', async () => {
    await begin()
    const stored = (await browser.storage.session.get('mustard_tab_login')).mustard_tab_login
    stored.pending.phase = 'completing'
    stored.pending.session = result
    // The provider exchange is already complete; its old login deadline no longer applies.
    stored.pending.expiresAt = 0
    await browser.storage.session.set({ mustard_tab_login: stored })
    const resumed = new TabOAuthLoginFlow()
    const complete = vi.fn().mockResolvedValue(undefined)
    resumed.initialize(complete)
    await expect.poll(() => resumed.getStatus()).toEqual({ status: 'idle' })
    expect(complete).toHaveBeenCalledExactlyOnceWith(result)
    expect(authBridgePost).toHaveBeenCalledTimes(1)
    expect((await browser.storage.session.get('mustard_tab_login')).mustard_tab_login).toEqual({
      status: { status: 'idle' },
    })
  })

  it('resumes a callback from persisted tab state in a fresh background instance', async () => {
    await begin()
    url = callback
    const resumed = new TabOAuthLoginFlow()
    const complete = vi.fn().mockResolvedValue(undefined)
    resumed.initialize(complete)
    await expect.poll(() => resumed.getStatus()).toEqual({ status: 'idle' })
    expect(complete).toHaveBeenCalledExactlyOnceWith(result)
    expect(browser.tabs.remove).toHaveBeenCalledExactlyOnceWith(7)
    expect((await browser.storage.session.get('mustard_tab_login')).mustard_tab_login).toEqual({
      status: { status: 'idle' },
    })
  })

  it('does not retry a possibly consumed exchange after background interruption', async () => {
    await begin()
    const stored = (await browser.storage.session.get('mustard_tab_login')).mustard_tab_login
    stored.pending.phase = 'completing'
    await browser.storage.session.set({ mustard_tab_login: stored })
    const resumed = new TabOAuthLoginFlow()
    resumed.initialize(vi.fn())
    await expect
      .poll(() => resumed.getStatus())
      .toEqual({
        status: 'failed',
        message: 'Login was interrupted. Please start a new login.',
      })
    expect(authBridgePost).toHaveBeenCalledTimes(1)
  })

  it('expires pending state instead of exchanging an old callback', async () => {
    const { flow, complete } = await begin()
    vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 11 * 60 * 1000)
    url = callback
    await expect
      .poll(() => flow.getStatus())
      .toEqual({
        status: 'failed',
        message: 'Login expired. Please try again.',
      })
    expect(complete).not.toHaveBeenCalled()
    expect(authBridgePost).toHaveBeenCalledTimes(1)
  })

  it('rejects completion when the local account changed', async () => {
    const { flow, complete } = await begin()
    vi.mocked(getSession).mockResolvedValue({ userId: 'other-user', identities: [] })
    url = callback
    await expect.poll(() => flow.getStatus()).toMatchObject({ status: 'failed' })
    expect(complete).not.toHaveBeenCalled()
    expect(authBridgePost).toHaveBeenCalledTimes(1)
  })

  it('serializes duplicate callback events into one exchange and persistence', async () => {
    const { flow, complete } = await begin()
    const update = vi.mocked(browser.tabs.onUpdated.addListener).mock.calls[0]![0]
    update(7, { url: callback }, {} as never)
    update(7, { url: callback }, {} as never)
    await expect.poll(() => flow.getStatus()).toEqual({ status: 'idle' })
    expect(complete).toHaveBeenCalledExactlyOnceWith(result)
    expect(authBridgePost).toHaveBeenCalledTimes(2)
  })

  it('retains the first pending login when another sign-in is requested', async () => {
    const { flow } = await begin()
    await expect(flow.start({ provider: 'github' })).rejects.toThrow('already open')
    await expect.poll(() => flow.getStatus()).toEqual({ status: 'pending' })
    expect(authBridgePost).toHaveBeenCalledTimes(1)
  })
})
