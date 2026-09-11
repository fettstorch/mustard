import { INCLUDE_PATCH_UPDATES_KEY, type ExtensionUpdateState } from '@/shared/extension-update'
import { isOptionalUpdate, isOutdated } from '@/shared/version'
import { cached, Observable } from '@fettstorch/jule'
import { ChromeExtensionUpdateProvider } from './ChromeExtensionUpdateProvider'
import type { ExtensionUpdateProvider } from './ExtensionUpdateProvider'
import { FirefoxExtensionUpdateProvider } from './FirefoxExtensionUpdateProvider'
import { MinimumVersionCriterion } from './MinimumVersionCriterion'

const STORAGE_KEY = 'mustard-extension-update-state'
const SEEN_TOAST_VERSION_KEY = 'mustard-extension-update-toast-version'
const CHECK_TTL_MS = 30 * 60 * 1000

type UpdateToastStatus = Extract<ExtensionUpdateState, { latestVersion: string }>['status']

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
  private toastClaimQueue = Promise.resolve()
  private minimumVersion = '0.0.0'

  constructor(
    private readonly provider: ExtensionUpdateProvider = createProvider(),
    private readonly minimumVersionCriterion = new MinimumVersionCriterion(),
  ) {
    provider.subscribe((latestVersion) => {
      void this.handleAvailableUpdate(latestVersion)
    })
  }

  async check(): Promise<ExtensionUpdateState> {
    await this.prepareState()
    // A downloaded update remains actionable until the extension reloads into
    // the new version. Its readiness event may be one-shot, so never expire it
    // into another store check for this installed version.
    if (this.state.status === 'ready') return this.state
    const isRetryableFailure = this.state.status === 'failed' && this.state.retryable
    if (!isRetryableFailure && Date.now() - this.checkedAt < CHECK_TTL_MS) return this.state

    return this.runProviderCheck()
  }

  async performAction(): Promise<void> {
    await this.prepareState()
    if (this.state.status !== 'ready') return
    await this.provider.perform(this.state.action)
  }

  subscribe(listener: (state: ExtensionUpdateState) => void): () => void {
    return this.stateChanges.subscribe(listener)
  }

  async isClientOutdated(): Promise<boolean> {
    await this.refreshMinimumVersion()
    return this.isRequired()
  }

  claimToast(version: string, status: UpdateToastStatus): Promise<boolean> {
    const claimKey = `${version}:${status}`
    const claim = this.toastClaimQueue.then(async () => {
      const stored = await browser.storage.local.get(SEEN_TOAST_VERSION_KEY)
      const storedClaims = stored[SEEN_TOAST_VERSION_KEY]
      const claims = Array.isArray(storedClaims)
        ? (storedClaims as string[])
        : typeof storedClaims === 'string'
          ? [`${storedClaims}:action-required`]
          : []
      if (claims.includes(claimKey)) return false
      await browser.storage.local.set({
        [SEEN_TOAST_VERSION_KEY]: [...claims, claimKey],
      })
      return true
    })
    this.toastClaimQueue = claim.then(
      () => undefined,
      () => undefined,
    )
    return claim
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
    const required = this.isRequired()
    const { required: _required, minimumVersion: _minimumVersion, ...baseState } = state
    state = required
      ? { ...baseState, required: true, minimumVersion: this.minimumVersion }
      : (baseState as ExtensionUpdateState)
    let filteredUpdate = false
    if (
      'latestVersion' in state &&
      !state.required &&
      !(await this.isOptionalUpdateEnabled(state))
    ) {
      filteredUpdate = true
      state = { status: 'current', currentVersion: state.currentVersion }
    }

    // Ready is terminal for the installed version: neither an older provider
    // result nor a stale storage snapshot may replace its restart action.
    if (this.state.status === 'ready' && state.status !== 'ready') return this.state

    const suppressFilteredNotification = filteredUpdate && this.state.status === 'current'
    const { checkedAt = this.checkedAt, persist = true, notify = true } = options
    this.state = state
    this.checkedAt = checkedAt
    if (persist) {
      const stored: StoredUpdateState = { state, checkedAt: this.checkedAt }
      await browser.storage.local.set({ [STORAGE_KEY]: stored })
    }
    if (notify && !suppressFilteredNotification) this.stateChanges.emit(state)
    return state
  }

  private async reconcileUpdatePreference(): Promise<void> {
    if (
      this.state.required ||
      !('latestVersion' in this.state) ||
      (await this.isOptionalUpdateEnabled(this.state))
    )
      return
    await this.transitionTo({ status: 'current', currentVersion: this.state.currentVersion })
  }

  private async reconcileRequirement(): Promise<void> {
    const required = this.isRequired()
    const wasRequired = this.state.required === true
    if (wasRequired === required) return

    // A newly mandatory update must not wait behind a recent optional store
    // check. Re-evaluate the provider immediately once, then cache that result.
    const checkedAt = required && this.state.status !== 'ready' ? 0 : this.checkedAt
    await this.transitionTo(this.state, { checkedAt })
  }

  private async isOptionalUpdateEnabled(
    state: Extract<ExtensionUpdateState, { latestVersion: string }>,
  ): Promise<boolean> {
    const stored = await browser.storage.local.get(INCLUDE_PATCH_UPDATES_KEY)
    const includePatches = stored[INCLUDE_PATCH_UPDATES_KEY] !== false
    return isOptionalUpdate(state.currentVersion, state.latestVersion, includePatches)
  }

  private async handleAvailableUpdate(latestVersion: string): Promise<void> {
    await this.refreshMinimumVersion()
    const installedVersion = currentVersion()
    await this.transitionTo(
      {
        status: 'ready',
        currentVersion: installedVersion,
        latestVersion,
        action: { type: 'apply', label: 'Restart and update' },
      },
      { checkedAt: Date.now() },
    )
  }

  private async refreshMinimumVersion(): Promise<void> {
    this.minimumVersion = await this.minimumVersionCriterion.getMinimumVersion()
  }

  private async prepareState(): Promise<void> {
    await this.refreshMinimumVersion()
    await this.restore()
    await this.reconcileRequirement()
    await this.reconcileUpdatePreference()
  }

  private isRequired(): boolean {
    return isOutdated(currentVersion(), this.minimumVersion)
  }
}
