import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fakeBrowser } from 'wxt/testing/fake-browser'
import { FirefoxExtensionUpdateProvider } from '@/background/business/service/extension-update/FirefoxExtensionUpdateProvider'

function amoResponse(version: string): Response {
  return new Response(JSON.stringify({ current_version: { version } }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })
}

describe('FirefoxExtensionUpdateProvider contract', () => {
  beforeEach(() => {
    fakeBrowser.reset()
    vi.restoreAllMocks()
  })

  it('reports current when AMO matches the installed version', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(amoResponse('2.11.0')))

    await expect(new FirefoxExtensionUpdateProvider().check('2.11.0')).resolves.toEqual({
      status: 'current',
      currentVersion: '2.11.0',
    })
  })

  it('requires manual action when AMO is newer but Firefox has not downloaded it', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(amoResponse('2.12.0')))

    await expect(new FirefoxExtensionUpdateProvider().check('2.11.0')).resolves.toMatchObject({
      status: 'action-required',
      currentVersion: '2.11.0',
      latestVersion: '2.12.0',
      action: { type: 'manual' },
    })
  })

  it('reports the downloaded version when Firefox later emits onUpdateAvailable', async () => {
    const listener = vi.fn()
    new FirefoxExtensionUpdateProvider().subscribe(listener)

    await fakeBrowser.runtime.onUpdateAvailable.trigger({ version: '2.12.0' })

    expect(listener).toHaveBeenCalledWith('2.12.0')
  })

  it('does not subscribe when Firefox does not expose onUpdateAvailable', () => {
    const listener = vi.fn()
    fakeBrowser.runtime.onUpdateAvailable = undefined

    const unsubscribe = new FirefoxExtensionUpdateProvider().subscribe(listener)

    expect(unsubscribe).not.toThrow()
    expect(listener).not.toHaveBeenCalled()
  })

  it('does not send users to the AMO listing for a manual update action', async () => {
    const createTab = vi.spyOn(browser.tabs, 'create')
    await new FirefoxExtensionUpdateProvider().perform({
      type: 'manual',
      instructions: ['Check Firefox.'],
    })

    expect(createTab).not.toHaveBeenCalled()
  })

  it('reports a retryable failure when AMO cannot be queried', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')))

    await expect(new FirefoxExtensionUpdateProvider().check('2.11.0')).resolves.toMatchObject({
      status: 'failed',
      retryable: true,
    })
  })
})
