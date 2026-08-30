import type { ExtensionUpdateState } from '@/shared/extension-update'
import { ChromeExtensionUpdateProvider } from './ChromeExtensionUpdateProvider'
import type { ExtensionUpdateProvider } from './ExtensionUpdateProvider'
import { FirefoxExtensionUpdateProvider } from './FirefoxExtensionUpdateProvider'

const STORAGE_KEY = 'mustard-extension-update-state'
const CHECK_TTL_MS = 6 * 60 * 60 * 1000

type StoredUpdateState = {
  state: ExtensionUpdateState
  checkedAt: number
}

function currentVersion(): string {
  return browser.runtime.getManifest().version
}

function createProvider(): ExtensionUpdateProvider {
  return import.meta.env.FIREFOX
    ? new FirefoxExtensionUpdateProvider()
    : new ChromeExtensionUpdateProvider()
}

export class ExtensionUpdateService {
  private state: ExtensionUpdateState = {
    status: 'current',
    currentVersion: currentVersion(),
  }
  private restored = false
  private checkedAt = 0
  private checkInFlight: Promise<ExtensionUpdateState> | null = null
  private readonly listeners = new Set<(state: ExtensionUpdateState) => void>()

  constructor(private readonly provider: ExtensionUpdateProvider = createProvider()) {
    provider.subscribe((latestVersion) => {
      this.checkedAt = Date.now()
      void this.setState({
        status: 'ready',
        currentVersion: currentVersion(),
        latestVersion,
        action: { type: 'apply', label: 'Restart and update' },
      })
    })
  }

  async check(): Promise<ExtensionUpdateState> {
    await this.restore()
    if (Date.now() - this.checkedAt < CHECK_TTL_MS) return this.state

    if (this.checkInFlight) return this.checkInFlight

    this.checkInFlight = this.performCheck()
    try {
      return await this.checkInFlight
    } finally {
      this.checkInFlight = null
    }
  }

  private async performCheck(): Promise<ExtensionUpdateState> {
    await this.setState({ status: 'checking' }, false)
    const state = await this.provider.check(currentVersion())
    this.checkedAt = Date.now()
    return this.setState(state)
  }

  async getState(): Promise<ExtensionUpdateState> {
    await this.restore()
    return this.state
  }

  apply(): void {
    if (this.state.status !== 'ready') return
    this.provider.apply()
  }

  subscribe(listener: (state: ExtensionUpdateState) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  private async restore(): Promise<void> {
    if (this.restored) return
    this.restored = true
    const stored = await browser.storage.local.get(STORAGE_KEY)
    const storedValue = stored[STORAGE_KEY] as StoredUpdateState | ExtensionUpdateState | undefined
    const state = storedValue && 'state' in storedValue ? storedValue.state : storedValue
    this.checkedAt = storedValue && 'state' in storedValue ? storedValue.checkedAt : 0
    if (!state || state.status === 'checking' || state.status === 'downloading') return

    if ('currentVersion' in state && state.currentVersion !== currentVersion()) {
      await browser.storage.local.remove(STORAGE_KEY)
      return
    }
    this.state = state
  }

  private async setState(
    state: ExtensionUpdateState,
    persist = true,
  ): Promise<ExtensionUpdateState> {
    this.state = state
    if (persist) {
      const stored: StoredUpdateState = { state, checkedAt: this.checkedAt }
      await browser.storage.local.set({ [STORAGE_KEY]: stored })
    }
    for (const listener of this.listeners) listener(state)
    return state
  }
}
