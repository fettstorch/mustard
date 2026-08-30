import type { ExtensionUpdateState } from '@/shared/extension-update'
import { cached, Observable } from '@fettstorch/jule'
import { ChromeExtensionUpdateProvider } from './ChromeExtensionUpdateProvider'
import type { ExtensionUpdateProvider } from './ExtensionUpdateProvider'
import { FirefoxExtensionUpdateProvider } from './FirefoxExtensionUpdateProvider'

const STORAGE_KEY = 'mustard-extension-update-state'
const CHECK_TTL_MS = 6 * 60 * 60 * 1000

type StoredUpdateState = {
  state: ExtensionUpdateState
  checkedAt: number
}

type TransitionOptions = {
  checkedAt?: number
  persist?: boolean
  notify?: boolean
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
  private readonly stateChanges = new Observable<ExtensionUpdateState>()

  constructor(private readonly provider: ExtensionUpdateProvider = createProvider()) {
    provider.subscribe((latestVersion) => {
      void this.transitionTo(
        {
          status: 'ready',
          currentVersion: currentVersion(),
          latestVersion,
          action: { type: 'apply', label: 'Restart and update' },
        },
        { checkedAt: Date.now() },
      )
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

    return this.runProviderCheck()
  }

  async performAction(): Promise<void> {
    await this.restore()
    if (this.state.status !== 'ready' && this.state.status !== 'action-required') return
    await this.provider.perform(this.state.action)
  }

  subscribe(listener: (state: ExtensionUpdateState) => void): () => void {
    return this.stateChanges.subscribe(listener)
  }

  private readonly runProviderCheck = cached(async (): Promise<ExtensionUpdateState> => {
    try {
      await this.transitionTo({ status: 'checking' }, { persist: false })
      const state = await this.provider.check(currentVersion())
      const checkedAt = state.status === 'failed' && state.retryable ? 0 : Date.now()
      return await this.transitionTo(state, { checkedAt })
    } finally {
      // Jule coalesces callers on the in-flight promise; evict once settled so
      // the persisted result TTL remains the authority for later checks.
      this.runProviderCheck.evict()
    }
  })

  private readonly restore = cached(async (): Promise<void> => {
    try {
      const stored = await browser.storage.local.get(STORAGE_KEY)
      const storedValue = stored[STORAGE_KEY] as
        | StoredUpdateState
        | ExtensionUpdateState
        | undefined
      let state = storedValue && 'state' in storedValue ? storedValue.state : storedValue
      let checkedAt = storedValue && 'state' in storedValue ? storedValue.checkedAt : 0
      let replaceStoredState = false

      if (state && 'currentVersion' in state && state.currentVersion !== currentVersion()) {
        state = undefined
        checkedAt = 0
        replaceStoredState = true
      }

      const restorableState =
        !state || state.status === 'checking' || state.status === 'downloading'
          ? ({ status: 'current', currentVersion: currentVersion() } as const)
          : state
      await this.transitionTo(restorableState, {
        checkedAt,
        persist: replaceStoredState,
        notify: false,
      })
    } catch (error) {
      // Do not retain a rejected restoration promise: a later check should be
      // able to retry a transient browser-storage failure.
      this.restore.evict()
      throw error
    }
  })

  private async transitionTo(
    state: ExtensionUpdateState,
    options: TransitionOptions = {},
  ): Promise<ExtensionUpdateState> {
    // Ready is terminal for the installed version: neither an older provider
    // result nor a stale storage snapshot may replace its restart action.
    if (this.state.status === 'ready' && state.status !== 'ready') return this.state

    const { checkedAt = this.checkedAt, persist = true, notify = true } = options
    this.state = state
    this.checkedAt = checkedAt
    if (persist) {
      const stored: StoredUpdateState = { state, checkedAt: this.checkedAt }
      await browser.storage.local.set({ [STORAGE_KEY]: stored })
    }
    if (notify) this.stateChanges.emit(state)
    return state
  }
}
