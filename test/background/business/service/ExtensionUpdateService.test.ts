import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fakeBrowser } from 'wxt/testing/fake-browser'
import { ExtensionUpdateService } from '@/background/business/service/extension-update/ExtensionUpdateService'
import type { ExtensionUpdateProvider } from '@/background/business/service/extension-update/ExtensionUpdateProvider'
import type { ExtensionUpdateAction, ExtensionUpdateState } from '@/shared/extension-update'

class StubProvider implements ExtensionUpdateProvider {
  state: ExtensionUpdateState = { status: 'current', currentVersion: '2.11.0' }
  perform = vi.fn(async (_action: ExtensionUpdateAction) => {})
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
      action: { type: 'manual', label: 'Update in Firefox', instructions: ['Check Firefox.'] },
    }

    await expect(new ExtensionUpdateService(provider).check()).resolves.toEqual(provider.state)
  })

  it('delegates the current browser-neutral action to the provider', async () => {
    const provider = new StubProvider()
    provider.state = {
      status: 'action-required',
      currentVersion: '2.11.0',
      latestVersion: '2.12.0',
      action: {
        type: 'manual',
        label: 'Update in Firefox',
        instructions: ['Check Firefox.'],
      },
    }
    const service = new ExtensionUpdateService(provider)

    await service.check()
    await service.performAction()

    expect(provider.perform).toHaveBeenCalledWith(provider.state.action)
  })

  it('changes to ready when the browser reports a downloaded update', async () => {
    const provider = new StubProvider()
    const service = new ExtensionUpdateService(provider)
    const listener = vi.fn()
    service.subscribe(listener)

    provider.listener?.('2.12.0')
    await vi.waitFor(() => expect(listener).toHaveBeenCalled())

    await expect(service.check()).resolves.toMatchObject({
      status: 'ready',
      latestVersion: '2.12.0',
    })
  })

  it('does not overwrite readiness when the update event wins the check race', async () => {
    const provider = new StubProvider()
    let finishCheck!: (state: ExtensionUpdateState) => void
    vi.spyOn(provider, 'check').mockImplementation(
      () =>
        new Promise<ExtensionUpdateState>((resolve) => {
          finishCheck = resolve
        }),
    )
    const service = new ExtensionUpdateService(provider)
    const listener = vi.fn()
    service.subscribe(listener)

    const check = service.check()
    await vi.waitFor(() => expect(provider.check).toHaveBeenCalledOnce())
    provider.listener?.('2.12.0')
    await vi.waitFor(() =>
      expect(listener).toHaveBeenCalledWith(expect.objectContaining({ status: 'ready' })),
    )
    finishCheck({
      status: 'downloading',
      currentVersion: '2.11.0',
      latestVersion: '2.12.0',
    })

    await expect(check).resolves.toMatchObject({ status: 'ready', latestVersion: '2.12.0' })
    await expect(service.check()).resolves.toMatchObject({ status: 'ready' })
  })

  it('applies an update only after the browser reports it ready', async () => {
    const provider = new StubProvider()
    const service = new ExtensionUpdateService(provider)

    await service.performAction()
    expect(provider.perform).not.toHaveBeenCalled()

    const listener = vi.fn()
    service.subscribe(listener)
    provider.listener?.('2.12.0')
    await vi.waitFor(() =>
      expect(listener).toHaveBeenCalledWith(expect.objectContaining({ status: 'ready' })),
    )
    await service.performAction()

    expect(provider.perform).toHaveBeenCalledWith({ type: 'apply', label: 'Restart and update' })
  })

  it('restores a ready update before applying after a service-worker restart', async () => {
    await fakeBrowser.storage.local.set({
      'mustard-extension-update-state': {
        state: {
          status: 'ready',
          currentVersion: '2.11.0',
          latestVersion: '2.12.0',
          action: { type: 'apply', label: 'Restart and update' },
        },
        checkedAt: Date.now(),
      },
    })
    const provider = new StubProvider()

    await new ExtensionUpdateService(provider).performAction()

    expect(provider.perform).toHaveBeenCalledWith({ type: 'apply', label: 'Restart and update' })
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

  it('does not expire a ready update into another store check', async () => {
    await fakeBrowser.storage.local.set({
      'mustard-extension-update-state': {
        state: {
          status: 'ready',
          currentVersion: '2.11.0',
          latestVersion: '2.12.0',
          action: { type: 'apply', label: 'Restart and update' },
        },
        checkedAt: Date.now() - 7 * 60 * 60 * 1000,
      },
    })
    const provider = new StubProvider()

    await expect(new ExtensionUpdateService(provider).check()).resolves.toMatchObject({
      status: 'ready',
      latestVersion: '2.12.0',
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

  it('does not let stale restoration overwrite an update-ready event', async () => {
    let releaseStorageRead!: () => void
    const storageReadBlocked = new Promise<void>((resolve) => {
      releaseStorageRead = resolve
    })
    const getStorage = vi.spyOn(browser.storage.local, 'get').mockImplementation(async () => {
      await storageReadBlocked
      return {
        'mustard-extension-update-state': {
          state: { status: 'current', currentVersion: '2.11.0' },
          checkedAt: Date.now(),
        },
      }
    })
    const provider = new StubProvider()
    const service = new ExtensionUpdateService(provider)
    const listener = vi.fn()
    service.subscribe(listener)

    const check = service.check()
    await vi.waitFor(() => expect(getStorage).toHaveBeenCalledOnce())
    provider.listener?.('2.12.0')
    await vi.waitFor(() => expect(listener).toHaveBeenCalledOnce())
    releaseStorageRead()

    await expect(check).resolves.toMatchObject({ status: 'ready', latestVersion: '2.12.0' })
    await expect(service.check()).resolves.toMatchObject({ status: 'ready' })
    expect(provider.checkCalls).toBe(0)
  })

  it('does not clear readiness while replacing state from a previous version', async () => {
    let releaseStorageRead!: () => void
    const storageReadBlocked = new Promise<void>((resolve) => {
      releaseStorageRead = resolve
    })
    vi.spyOn(browser.storage.local, 'get').mockImplementationOnce(async () => {
      await storageReadBlocked
      return {
        'mustard-extension-update-state': {
          state: { status: 'current', currentVersion: '2.10.0' },
          checkedAt: Date.now(),
        },
      }
    })
    const provider = new StubProvider()
    const service = new ExtensionUpdateService(provider)

    const check = service.check()
    provider.listener?.('2.12.0')
    releaseStorageRead()

    await expect(check).resolves.toMatchObject({ status: 'ready', latestVersion: '2.12.0' })
    await expect(browser.storage.local.get('mustard-extension-update-state')).resolves.toEqual({
      'mustard-extension-update-state': expect.objectContaining({
        state: expect.objectContaining({ status: 'ready', latestVersion: '2.12.0' }),
      }),
    })
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

    const state = await new ExtensionUpdateService(new StubProvider()).check()

    expect(state).toEqual({ status: 'current', currentVersion: '2.11.0' })
  })
})
