import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fakeBrowser } from 'wxt/testing/fake-browser'
import {
  createExtensionUpdateProvider,
  createNativeNotificationDelivery,
  createOAuthLoginFlow,
} from '@/background/platform/createBrowserPlatform'
import { ExtensionUpdateService } from '@/background/business/service/extension-update/ExtensionUpdateService'
import { MinimumVersionCriterion } from '@/background/business/service/extension-update/MinimumVersionCriterion'
import { getBrowserCapabilities } from '@/shared/browser-capabilities'

describe('Safari platform without Chrome-only APIs', () => {
  beforeEach(() => {
    fakeBrowser.reset()
    vi.stubEnv('BROWSER', 'safari')
    vi.spyOn(browser.runtime, 'getManifest').mockReturnValue({ version: '2.14.2' } as never)
    vi.spyOn(MinimumVersionCriterion.prototype, 'getMinimumVersion').mockResolvedValue('0.0.0')
    for (const [owner, method] of [
      [browser.identity, 'getRedirectURL'],
      [browser.identity, 'launchWebAuthFlow'],
      [browser.notifications, 'create'],
      [browser.notifications.onClicked, 'addListener'],
      [browser.runtime, 'requestUpdateCheck'],
      [browser.runtime.onUpdateAvailable, 'addListener'],
      [browser.runtime, 'reload'],
    ] as const) {
      vi.spyOn(owner, method as never).mockImplementation(() => {
        throw new Error(`Unsupported API: ${method}`)
      })
    }
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllEnvs()
  })

  it('constructs every implementation without calling unsupported APIs', async () => {
    expect(getBrowserCapabilities()).toEqual({ nativeNotifications: false })
    await expect(createOAuthLoginFlow().start({ provider: 'github' })).rejects.toThrow(
      'Tab login is not initialized',
    )
    const delivery = createNativeNotificationDelivery()
    expect(delivery.supported).toBe(false)
    delivery.onClicked(vi.fn())()
    await expect(delivery.create('id', { title: '', message: '' })).rejects.toThrow('not supported')
    await expect(delivery.clear('id')).rejects.toThrow('not supported')
    const provider = createExtensionUpdateProvider()
    provider.subscribe(vi.fn())()
    await provider.perform({ type: 'apply', label: 'Restart' })
    expect(await provider.check('2.14.2')).toMatchObject({
      status: 'unavailable',
      currentVersion: '2.14.2',
    })
  })

  it('keeps required-update protection without offering an unavailable update action', async () => {
    vi.mocked(MinimumVersionCriterion.prototype.getMinimumVersion).mockResolvedValue('3.0.0')
    const service = new ExtensionUpdateService()
    expect(await service.isClientOutdated()).toBe(true)
    expect(await service.check()).toEqual({
      status: 'unavailable',
      currentVersion: '2.14.2',
      required: true,
      minimumVersion: '3.0.0',
    })
    await service.performAction()
    expect(browser.runtime.reload).not.toHaveBeenCalled()
  })

  it('restores unavailable state and recognizes a compatible new installation', async () => {
    await new ExtensionUpdateService().check()
    expect(await new ExtensionUpdateService().check()).toMatchObject({
      status: 'unavailable',
      currentVersion: '2.14.2',
    })
    vi.mocked(browser.runtime.getManifest).mockReturnValue({ version: '3.0.0' } as never)
    const service = new ExtensionUpdateService()
    expect(await service.check()).toMatchObject({ status: 'unavailable', currentVersion: '3.0.0' })
    expect(await service.isClientOutdated()).toBe(false)
  })

  it.each(['chrome', 'firefox'])('retains existing feature availability on %s', (target) => {
    vi.stubEnv('BROWSER', target)
    expect(getBrowserCapabilities()).toEqual({ nativeNotifications: true })
  })
})
