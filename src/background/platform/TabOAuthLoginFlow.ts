import { authBridgePost } from '../auth/AuthBridge'
import { synchronize } from '@fettstorch/jule'
import { getSession } from '../auth/SessionStore'
import { TAB_CALLBACK_URI, type OAuthLoginStatus, type PendingLogin } from '@/shared/oauth-login'
import type { OAuthLoginFlow, OAuthLoginRequest, OAuthSessionResult } from './OAuthLoginFlow'

const STORAGE_KEY = 'mustard_tab_login'
const MAX_AGE_MS = 10 * 60 * 1000
type Pending = {
  tabId: number
  state: string
  request: OAuthLoginRequest
  owner: string | null
  expiresAt: number
  phase: 'waiting' | 'completing'
  session?: OAuthSessionResult
}
type Stored = { pending?: Pending; status: OAuthLoginStatus }

/** Normal-tab OAuth for Safari, which does not implement browser.identity.
 * Session storage survives background suspension, but never a browser restart.
 * Only our tracked tab and exact HTTPS callback can complete the login.
 */
export class TabOAuthLoginFlow implements OAuthLoginFlow {
  private serial = synchronize(<T>(operation: () => Promise<T>) => operation())
  private cancellation = 0
  private finishing = false
  private complete?: (result: OAuthSessionResult) => Promise<void>

  initialize(complete: (result: OAuthSessionResult) => Promise<void>): void {
    this.complete = complete
    // Register synchronously at background startup so Safari can wake us.
    browser.tabs.onUpdated.addListener((tabId, change) => {
      if (change.url) void this.serial(() => this.visit(tabId, change.url!)).catch(() => {})
    })
    browser.tabs.onRemoved.addListener((tabId) => {
      void this.read()
        .then(async ({ pending }) => {
          if (pending?.tabId !== tabId || pending.session || this.finishing) return
          this.cancellation++
          await this.serial(async () => {
            if ((await this.read()).pending?.tabId === tabId) {
              await this.fail('Login was cancelled. Please try again.')
            }
          })
        })
        .catch(() => {})
    })
    void this.getStatus().catch(() => {})
  }

  private async read(): Promise<Stored> {
    const values = await browser.storage.session.get(STORAGE_KEY)
    return (values[STORAGE_KEY] as Stored | undefined) ?? { status: { status: 'idle' } }
  }

  private async write(value: Stored): Promise<void> {
    await browser.storage.session.set({ [STORAGE_KEY]: value })
  }

  private async fail(message: string): Promise<void> {
    await this.write({ status: { status: 'failed', message } })
  }

  async start(request: OAuthLoginRequest): Promise<PendingLogin> {
    return this.serial<PendingLogin>(async () => {
      if (!this.complete) throw new Error('Tab login is not initialized')
      await this.resume()
      if ((await this.read()).pending) throw new Error('A login is already open in another tab')
      let tabId: number | undefined
      try {
        const owner = (await getSession())?.userId ?? null
        const result = await authBridgePost({
          action: 'initiate',
          provider: request.provider,
          ...(request.provider === 'atproto' ? { handle: request.handle } : {}),
          redirect_uri: TAB_CALLBACK_URI,
        })
        if (
          typeof result.state !== 'string' ||
          !result.state ||
          typeof result.authUrl !== 'string'
        ) {
          throw new Error('Invalid login response')
        }
        const authUrl = new URL(result.authUrl)
        if (authUrl.protocol !== 'https:') throw new Error('Invalid authorization URL')
        // Save the tab identity before navigating; even an immediate redirect is observed.
        tabId = (await browser.tabs.create({ url: 'about:blank', active: true })).id
        if (tabId === undefined) throw new Error('Could not open the login tab')
        await this.write({
          pending: {
            tabId,
            state: result.state,
            request,
            owner,
            expiresAt: Date.now() + MAX_AGE_MS,
            phase: 'waiting',
          },
          status: { status: 'pending' },
        })
        await browser.tabs.update(tabId, { url: authUrl.href })
        return { pending: true }
      } catch (error) {
        await this.fail('Could not start sign-in. Please try again.')
        if (tabId !== undefined) await browser.tabs.remove(tabId).catch(() => {})
        throw error
      }
    })
  }

  async getStatus(): Promise<OAuthLoginStatus> {
    // Reconcile in order, but let the UI read status while network/storage work runs.
    void this.serial(() => this.resume()).catch(() => {})
    const { status } = await this.read()
    return this.finishing ? { status: 'finishing' } : status
  }

  async cancel(): Promise<boolean> {
    // Installation has committed to finishing. Still wait for it so logout callers
    // cannot clear credentials before the completion callback writes them again.
    if (this.finishing) return this.serial(async () => false)
    // Signal immediately, even while a callback exchange owns the serial queue.
    this.cancellation++
    return this.serial(async () => {
      const { pending } = await this.read()
      if (!pending) return false
      if (pending.session) {
        await this.finish(pending, pending.session)
        return false
      }
      await this.write({ status: { status: 'idle' } })
      await browser.tabs.remove(pending.tabId).catch(() => {})
      return true
    })
  }

  private async resume(): Promise<void> {
    const { pending } = await this.read()
    if (!pending) return
    if (pending.session) {
      await this.finish(pending, pending.session)
      return
    }
    if (pending.expiresAt <= Date.now()) {
      await this.fail('Login expired. Please try again.')
      return
    }
    if (pending.phase === 'completing') {
      // A suspended exchange may already have consumed its one-time code.
      await this.fail('Login was interrupted. Please start a new login.')
      return
    }
    const tab = await browser.tabs.get(pending.tabId).catch(() => null)
    if (!tab) await this.fail('Login was cancelled. Please try again.')
    else if (tab.url) await this.visit(pending.tabId, tab.url)
  }

  private async visit(tabId: number, href: string): Promise<void> {
    const { pending } = await this.read()
    if (!pending || pending.tabId !== tabId || pending.phase !== 'waiting') return
    const cancellation = this.cancellation
    const url = new URL(href)
    const callback = new URL(TAB_CALLBACK_URI)
    if (url.origin !== callback.origin || url.pathname !== callback.pathname) return
    try {
      if (pending.expiresAt <= Date.now()) throw new Error('Expired login')
      const params = url.searchParams
      const code = params.get('code')
      const state = params.get('state')
      const iss = params.get('iss')
      if (
        params.has('error') ||
        url.hash ||
        !code ||
        state !== pending.state ||
        params.getAll('code').length !== 1 ||
        params.getAll('state').length !== 1 ||
        (pending.request.provider === 'atproto' && (!iss || params.getAll('iss').length !== 1))
      ) {
        throw new Error('Invalid callback')
      }
      if (((await getSession())?.userId ?? null) !== pending.owner)
        throw new Error('Account changed')
      await this.write({
        pending: { ...pending, phase: 'completing' },
        status: { status: 'pending' },
      })
      const result = await authBridgePost({
        action: 'callback',
        provider: pending.request.provider,
        code,
        state,
        ...(pending.request.provider === 'atproto' ? { iss } : {}),
        clientVersion: browser.runtime.getManifest().version,
        ...(pending.request.currentJwt !== undefined
          ? { currentJwt: pending.request.currentJwt }
          : {}),
      })
      if (
        typeof result.userId !== 'string' ||
        typeof result.jwt !== 'string' ||
        typeof result.expiresAt !== 'number' ||
        typeof result.refreshToken !== 'string'
      ) {
        throw new Error('Invalid session response')
      }
      if (this.cancellation !== cancellation) {
        // Consent may already have minted a session; revoke it without installing it.
        await authBridgePost({ action: 'logout', refreshToken: result.refreshToken }).catch(
          () => {},
        )
        return
      }
      await this.finish(pending, {
        userId: result.userId,
        jwt: result.jwt,
        expiresAt: result.expiresAt,
        refreshToken: result.refreshToken,
        ...(typeof result.did === 'string' ? { did: result.did } : {}),
      })
    } catch {
      // Never expose codes or backend response bodies in UI/logs.
      await this.fail('Sign-in failed or was cancelled. Please try again.')
    }
  }

  private async finish(pending: Pending, session: OAuthSessionResult): Promise<void> {
    this.finishing = true
    try {
      // Retain the exchanged result until both credentials and identities are saved.
      // A fresh background can repeat installation without reusing the OAuth code.
      await this.write({
        pending: { ...pending, phase: 'completing', session },
        status: { status: 'finishing' },
      })
      await this.complete!(session)
      await this.write({ status: { status: 'idle' } })
      await browser.tabs.remove(pending.tabId).catch(() => {})
    } catch {
      await this.fail('Sign-in failed. Please try again.')
    } finally {
      this.finishing = false
    }
  }
}
