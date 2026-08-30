import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fakeBrowser } from 'wxt/testing/fake-browser'
import { ExtensionUpdateService } from '@/background/business/service/extension-update/ExtensionUpdateService'
import type { ExtensionUpdateProvider } from '@/background/business/service/extension-update/ExtensionUpdateProvider'
import type { ExtensionUpdateState } from '@/shared/extension-update'

class StubProvider implements ExtensionUpdateProvider {
  state: ExtensionUpdateState = { status: 'current', currentVersion: '2.11.0' }
  apply = vi.fn()
  listener: ((latestVersion: string) => void) | null = null
  checkCalls = 0

  async check(): Promise<ExtensionUpdateState> {
    this.checkCalls++
    return this.state
  }

  subscribe(listener: (latestVersion: string) => void): () => void {
    this.listener = listener
    return () => {
      this.listener = null
    }
  }
}

describe('ExtensionUpdateService contract', () => {
  beforeEach(() => {
    fakeBrowser.reset()
    vi.restoreAllMocks()
    vi.spyOn(browser.runtime, 'getManifest').mockReturnValue({ version: '2.11.0' } as never)
  })

  it('exposes the provider result through the browser-neutral state', async () => {
    const provider = new StubProvider()
    provider.state = {
      status: 'action-required',
      currentVersion: '2.11.0',
      latestVersion: '2.12.0',
      action: { type: 'manual', label: 'How to update', instructions: ['Check Firefox.'] },
    }

    await expect(new ExtensionUpdateService(provider).check()).resolves.toEqual(provider.state)
  })

  it('changes to ready when the browser reports a downloaded update', async () => {
    const provider = new StubProvider()
    const service = new ExtensionUpdateService(provider)
    const listener = vi.fn()
    service.subscribe(listener)

    provider.listener?.('2.12.0')
    await vi.waitFor(() => expect(listener).toHaveBeenCalled())

    await expect(service.getState()).resolves.toMatchObject({
      status: 'ready',
      latestVersion: '2.12.0',
    })
  })

  it('applies an update only after the browser reports it ready', async () => {
    const provider = new StubProvider()
    const service = new ExtensionUpdateService(provider)

    service.apply()
    expect(provider.apply).not.toHaveBeenCalled()

    provider.listener?.('2.12.0')
    await vi.waitFor(async () => expect((await service.getState()).status).toBe('ready'))
    service.apply()

    expect(provider.apply).toHaveBeenCalledOnce()
  })

  it('reuses a recent store check across service-worker restarts', async () => {
    const checkedAt = Date.now()
    await fakeBrowser.storage.local.set({
      'mustard-extension-update-state': {
        state: { status: 'current', currentVersion: '2.11.0' },
        checkedAt,
      },
    })
    const provider = new StubProvider()

    await expect(new ExtensionUpdateService(provider).check()).resolves.toEqual({
      status: 'current',
      currentVersion: '2.11.0',
    })
    expect(provider.checkCalls).toBe(0)
  })

  it('shares in-progress state restoration between concurrent checks', async () => {
    const storedState = {
      state: { status: 'current', currentVersion: '2.11.0' } as const,
      checkedAt: Date.now(),
    }
    let releaseStorageRead!: () => void
    const storageReadBlocked = new Promise<void>((resolve) => {
      releaseStorageRead = resolve
    })
    const getStorage = vi.spyOn(browser.storage.local, 'get').mockImplementation(async () => {
      await storageReadBlocked
      return { 'mustard-extension-update-state': storedState }
    })
    const provider = new StubProvider()
    const service = new ExtensionUpdateService(provider)

    const firstCheck = service.check()
    const secondCheck = service.check()
    await vi.waitFor(() => expect(getStorage).toHaveBeenCalledOnce())
    releaseStorageRead()

    await expect(Promise.all([firstCheck, secondCheck])).resolves.toEqual([
      storedState.state,
      storedState.state,
    ])
    expect(provider.checkCalls).toBe(0)
  })

  it('retries a retryable provider failure immediately', async () => {
    const provider = new StubProvider()
    provider.state = {
      status: 'failed',
      message: 'Temporary store failure.',
      retryable: true,
    }
    const service = new ExtensionUpdateService(provider)

    await service.check()
    provider.state = { status: 'current', currentVersion: '2.11.0' }

    await expect(service.check()).resolves.toEqual(provider.state)
    expect(provider.checkCalls).toBe(2)
  })

  it('retries a recent persisted retryable failure after a service-worker restart', async () => {
    await fakeBrowser.storage.local.set({
      'mustard-extension-update-state': {
        state: {
          status: 'failed',
          message: 'Temporary store failure.',
          retryable: true,
        },
        checkedAt: Date.now(),
      },
    })
    const provider = new StubProvider()

    await expect(new ExtensionUpdateService(provider).check()).resolves.toEqual(provider.state)
    expect(provider.checkCalls).toBe(1)
  })

  it('discards persisted update state after the installed version changes', async () => {
    await fakeBrowser.storage.local.set({
      'mustard-extension-update-state': {
        state: {
          status: 'ready',
          currentVersion: '2.10.0',
          latestVersion: '2.11.0',
          action: { type: 'apply', label: 'Restart and update' },
        },
        checkedAt: Date.now(),
      },
    })

    const state = await new ExtensionUpdateService(new StubProvider()).getState()

    expect(state).toEqual({ status: 'current', currentVersion: '2.11.0' })
  })
})
