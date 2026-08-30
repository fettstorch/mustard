import type { ExtensionUpdateState } from '@/shared/extension-update'
import { cached } from '@fettstorch/jule'
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
    // A downloaded update remains actionable until the extension reloads into
    // the new version. Its readiness event may be one-shot, so never expire it
    // into another store check for this installed version.
    if (this.state.status === 'ready') return this.state
    const isRetryableFailure = this.state.status === 'failed' && this.state.retryable
    if (!isRetryableFailure && Date.now() - this.checkedAt < CHECK_TTL_MS) return this.state

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
    // onUpdateAvailable can report readiness while the explicit store check is
    // still pending. Never let that older check result replace the newer,
    // actionable state; the readiness event may not fire a second time.
    if (this.state.status === 'ready') return this.state
    this.checkedAt = state.status === 'failed' && state.retryable ? 0 : Date.now()
    return this.setState(state)
  }

  async getState(): Promise<ExtensionUpdateState> {
    await this.restore()
    return this.state
  }

  async apply(): Promise<void> {
    await this.restore()
    if (this.state.status !== 'ready') return
    this.provider.apply()
  }

  subscribe(listener: (state: ExtensionUpdateState) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  private readonly restore = cached(async (): Promise<void> => {
    try {
      const stored = await browser.storage.local.get(STORAGE_KEY)
      const storedValue = stored[STORAGE_KEY] as
        | StoredUpdateState
        | ExtensionUpdateState
        | undefined
      const state = storedValue && 'state' in storedValue ? storedValue.state : storedValue
      this.checkedAt = storedValue && 'state' in storedValue ? storedValue.checkedAt : 0
      if (!state || state.status === 'checking' || state.status === 'downloading') return

      if ('currentVersion' in state && state.currentVersion !== currentVersion()) {
        await browser.storage.local.remove(STORAGE_KEY)
        return
      }
      this.state = state
    } catch (error) {
      // Do not retain a rejected restoration promise: a later check should be
      // able to retry a transient browser-storage failure.
      this.restore.evict()
      throw error
    }
  })

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
