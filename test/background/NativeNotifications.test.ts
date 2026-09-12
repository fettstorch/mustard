import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fakeBrowser } from 'wxt/testing/fake-browser'
import { createNativeNotifications } from '@/background/native-notifications'
import { WebExtensionNotificationDelivery } from '@/background/platform/WebExtensionNotificationDelivery'
import type { NativeNotificationDelivery } from '@/background/platform/NativeNotificationDelivery'
import type { DtoMustardNotification } from '@/shared/dto/DtoMustardMention'

const SEEN = 'mustard-native-notified-ids'
const TARGETS = 'mustard-native-notif-targets'
function notification(id: string): DtoMustardNotification {
  return {
    id,
    noteId: `note-${id}`,
    pageUrl: 'https://example.com/',
    actorId: 'actor',
    actorHandle: 'alice.test',
    actorDisplayName: 'Alice',
    actorAvatarUrl: null,
    source: 'note',
    snippet: 'Hello',
    createdAt: 1,
    type: 'mention',
  }
}
function setup(supported = true, createSpacingMs = 0) {
  const delivery = {
    supported,
    createSpacingMs,
    create: vi.fn().mockResolvedValue(undefined),
    clear: vi.fn().mockResolvedValue(undefined),
    onClicked: vi.fn<(listener: (id: string) => void) => () => void>().mockReturnValue(vi.fn()),
  } satisfies NativeNotificationDelivery
  const deps = {
    fetchUnread: vi
      .fn<() => Promise<DtoMustardNotification[] | null>>()
      .mockResolvedValue([notification('a'), notification('b')]),
    acknowledge: vi.fn().mockResolvedValue(undefined),
    openDeepLink: vi.fn().mockResolvedValue(undefined),
  }
  return { delivery, deps, dispatcher: createNativeNotifications(deps, delivery) }
}

describe('notification delivery boundary', () => {
  beforeEach(() => {
    fakeBrowser.reset()
    vi.useFakeTimers()
    vi.setSystemTime(1_000_000)
  })
  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllEnvs()
    vi.useRealTimers()
  })

  it('does not fetch or seed notifications when delivery is unavailable', async () => {
    const { deps, delivery, dispatcher } = setup(false)
    await dispatcher.dispatch()
    expect(deps.fetchUnread).not.toHaveBeenCalled()
    expect(delivery.create).not.toHaveBeenCalled()
    expect(await browser.storage.local.get(null)).toEqual({})
  })

  it('seeds existing unread without toasting and honors the opt-out preference', async () => {
    const { delivery, deps, dispatcher } = setup()
    await dispatcher.dispatch()
    expect(await browser.storage.local.get(SEEN)).toEqual({ [SEEN]: ['a', 'b'] })
    expect(delivery.create).not.toHaveBeenCalled()
    await browser.storage.local.set({ 'mustard-browser-notifications-enabled': false })
    vi.advanceTimersByTime(15_000)
    await dispatcher.dispatch()
    expect(deps.fetchUnread).toHaveBeenCalledTimes(1)
  })

  it('does not seed until a session provides unread data', async () => {
    const { deps, dispatcher } = setup()
    deps.fetchUnread.mockResolvedValue(null)
    await dispatcher.dispatch()
    expect(await browser.storage.local.get(SEEN)).toEqual({})
  })

  it('records successful delivery only and retries failed toasts after throttling', async () => {
    const { delivery, dispatcher } = setup()
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    await browser.storage.local.set({ [SEEN]: [] })
    delivery.create.mockRejectedValueOnce(new Error('delivery failed'))
    await dispatcher.dispatch()
    expect(await browser.storage.local.get(SEEN)).toEqual({ [SEEN]: ['b'] })
    expect(delivery.create).toHaveBeenCalledWith('b', {
      title: 'Alice mentioned you',
      message: 'Hello',
    })
    await dispatcher.dispatch()
    expect(delivery.create).toHaveBeenCalledTimes(2)
    vi.advanceTimersByTime(15_000)
    await dispatcher.dispatch()
    expect(delivery.create).toHaveBeenCalledTimes(3)
    expect(await browser.storage.local.get(SEEN)).toEqual({ [SEEN]: ['a', 'b'] })
  })

  it('spaces successive attempts within a batch, including after a failure', async () => {
    const { delivery, dispatcher } = setup(true, 500)
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    await browser.storage.local.set({ [SEEN]: [] })
    delivery.create.mockRejectedValueOnce(new Error('delivery failed'))
    const pending = dispatcher.dispatch()
    await vi.advanceTimersByTimeAsync(0)
    expect(delivery.create).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(499)
    expect(delivery.create).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(1)
    await pending
    expect(delivery.create).toHaveBeenCalledTimes(2)
  })

  it('acknowledges and opens the persisted click target and disposes its listener', async () => {
    const { delivery, deps, dispatcher } = setup()
    await browser.storage.local.set({
      [TARGETS]: { a: { pageUrl: 'https://example.com/', noteId: 'note-a' } },
    })
    await delivery.onClicked.mock.calls[0]![0]('a')
    expect(deps.acknowledge).toHaveBeenCalledWith('a')
    expect(delivery.clear).toHaveBeenCalledWith('a')
    expect(deps.openDeepLink).toHaveBeenCalledWith('https://example.com/', 'note-a')
    dispatcher.dispose()
    expect(delivery.onClicked.mock.results[0]!.value).toHaveBeenCalledOnce()
  })

  it.each([false, true])(
    'keeps native payload and browser pacing (Firefox: %s)',
    async (firefox) => {
      vi.stubEnv('FIREFOX', firefox ? 'true' : '')
      const create = vi.spyOn(browser.notifications, 'create').mockResolvedValue('a')
      const delivery = new WebExtensionNotificationDelivery()
      expect(delivery.createSpacingMs).toBe(firefox ? 500 : 0)
      await delivery.create('a', { title: 'Title', message: 'Message' })
      expect(create).toHaveBeenCalledWith('a', {
        type: 'basic',
        iconUrl: expect.any(String),
        title: 'Title',
        message: 'Message',
      })
      const callback = vi.fn()
      const remove = vi.spyOn(browser.notifications.onClicked, 'removeListener')
      delivery.onClicked(callback)()
      expect(remove).toHaveBeenCalledWith(callback)
    },
  )
})
