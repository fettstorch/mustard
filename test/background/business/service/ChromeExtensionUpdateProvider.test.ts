import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fakeBrowser } from 'wxt/testing/fake-browser'
import { ChromeExtensionUpdateProvider } from '@/background/business/service/extension-update/ChromeExtensionUpdateProvider'

describe('ChromeExtensionUpdateProvider contract', () => {
  beforeEach(() => {
    fakeBrowser.reset()
    vi.restoreAllMocks()
  })

  it('reports current when Chrome reports no store update', async () => {
    vi.spyOn(browser.runtime, 'requestUpdateCheck').mockResolvedValue({ status: 'no_update' })

    await expect(new ChromeExtensionUpdateProvider().check('2.11.0')).resolves.toEqual({
      status: 'current',
      currentVersion: '2.11.0',
    })
  })

  it('reports downloading instead of reloading when Chrome finds an update', async () => {
    vi.spyOn(browser.runtime, 'requestUpdateCheck').mockResolvedValue({
      status: 'update_available',
      version: '2.12.0',
    })
    const reload = vi.spyOn(browser.runtime, 'reload').mockImplementation(() => {})

    await expect(new ChromeExtensionUpdateProvider().check('2.11.0')).resolves.toEqual({
      status: 'downloading',
      currentVersion: '2.11.0',
      latestVersion: '2.12.0',
    })
    expect(reload).not.toHaveBeenCalled()
  })

  it('reports the downloaded version from onUpdateAvailable', async () => {
    const listener = vi.fn()
    new ChromeExtensionUpdateProvider().subscribe(listener)

    await fakeBrowser.runtime.onUpdateAvailable.trigger({ version: '2.12.0' })

    expect(listener).toHaveBeenCalledWith('2.12.0')
  })

  it('does not surface Chrome throttling as a user-facing failure', async () => {
    vi.spyOn(browser.runtime, 'requestUpdateCheck').mockResolvedValue({ status: 'throttled' })

    await expect(new ChromeExtensionUpdateProvider().check('2.11.0')).resolves.toEqual({
      status: 'current',
      currentVersion: '2.11.0',
    })
  })
})
