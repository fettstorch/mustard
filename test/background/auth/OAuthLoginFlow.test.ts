import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fakeBrowser } from 'wxt/testing/fake-browser'
import { authBridgePost } from '../../../src/background/auth/AuthBridge'
import { login } from '../../../src/background/auth/AtprotoAuth'
import { loginWithGithub } from '../../../src/background/auth/GithubAuth'

vi.mock('../../../src/background/auth/AuthBridge', () => ({ authBridgePost: vi.fn() }))

const post = vi.mocked(authBridgePost)
const session = {
  userId: '11111111-1111-4111-8111-111111111111',
  jwt: 'new-jwt',
  expiresAt: 123,
  refreshToken: 'refresh-token',
}
const providers = ['atproto', 'github'] as const

describe('existing identity login contract', () => {
  beforeEach(() => {
    fakeBrowser.reset()
    post.mockReset()
    vi.spyOn(browser.identity, 'getRedirectURL').mockReturnValue(
      'https://callback.example/callback',
    )
    vi.spyOn(browser.runtime, 'getManifest').mockReturnValue({ version: '2.14.2' } as ReturnType<
      typeof browser.runtime.getManifest
    >)
    post.mockResolvedValueOnce({ authUrl: 'https://auth.example', state: 'expected' })
  })

  afterEach(() => vi.restoreAllMocks())

  it('imports provider modules and creates the flow without accessing identity', async () => {
    vi.mocked(browser.identity.getRedirectURL).mockImplementation(() => {
      throw new Error('identity unavailable')
    })
    vi.resetModules()
    await import('../../../src/background/auth/AtprotoAuth')
    await import('../../../src/background/auth/GithubAuth')
    const { createOAuthLoginFlow } =
      await import('../../../src/background/platform/createBrowserPlatform')
    createOAuthLoginFlow()
    expect(browser.identity.getRedirectURL).not.toHaveBeenCalled()
  })

  it.each(providers)('preserves %s linking payloads and session ownership', async (provider) => {
    post.mockResolvedValueOnce({
      ...session,
      ...(provider === 'atproto' ? { did: 'did:plc:alice' } : {}),
    })
    vi.spyOn(browser.identity, 'launchWebAuthFlow').mockResolvedValue(
      'https://callback.example/callback?code=code&state=expected&iss=https%3A%2F%2Fissuer.example',
    )
    const result =
      provider === 'atproto'
        ? await login('alice.test', 'existing-jwt')
        : await loginWithGithub('existing-jwt')

    expect(browser.identity.getRedirectURL).toHaveBeenCalledWith('callback')
    expect(browser.identity.launchWebAuthFlow).toHaveBeenCalledWith({
      url: 'https://auth.example',
      interactive: true,
    })
    expect(post).toHaveBeenNthCalledWith(1, {
      action: 'initiate',
      provider,
      redirect_uri: 'https://callback.example/callback',
      ...(provider === 'atproto' ? { handle: 'alice.test' } : {}),
    })
    expect(post).toHaveBeenNthCalledWith(2, {
      action: 'callback',
      provider,
      code: 'code',
      state: 'expected',
      ...(provider === 'atproto' ? { iss: 'https://issuer.example' } : {}),
      clientVersion: '2.14.2',
      currentJwt: 'existing-jwt',
    })
    expect(result).toEqual({
      ...session,
      ...(provider === 'atproto' ? { did: 'did:plc:alice' } : {}),
    })
    expect(await browser.storage.local.get('mustard_session')).toEqual(
      provider === 'atproto'
        ? {
            mustard_session: {
              userId: session.userId,
              identities: [{ provider, providerAccountId: 'did:plc:alice', handle: 'alice.test' }],
            },
          }
        : {},
    )
  })

  it.each(providers)('omits linking credentials for a new %s login', async (provider) => {
    post.mockResolvedValueOnce({ ...session, did: 'did:plc:alice' })
    vi.spyOn(browser.identity, 'launchWebAuthFlow').mockResolvedValue(
      'https://callback.example/callback?code=code&state=expected&iss=issuer',
    )
    if (provider === 'atproto') await login('alice.test')
    else await loginWithGithub()
    expect(post.mock.calls[1]?.[0]).not.toHaveProperty('currentJwt')
  })

  it.each(
    providers.flatMap((provider) => [
      { provider, callback: '', error: 'Login was cancelled' },
      { provider, callback: '?code=code&state=wrong&iss=issuer', error: 'State mismatch' },
      { provider, callback: '?state=expected&iss=issuer', error: 'Missing callback parameters' },
      { provider, callback: '?code=code&iss=issuer', error: 'Missing callback parameters' },
    ]),
  )(
    'rejects $provider: $error ($callback) before callback or storage writes',
    async ({ provider, callback, error }) => {
      vi.spyOn(browser.identity, 'launchWebAuthFlow').mockResolvedValue(
        callback ? `https://callback.example/${callback}` : '',
      )
      const attempt = provider === 'atproto' ? login('alice.test') : loginWithGithub()
      await expect(attempt).rejects.toThrow(error)
      expect(post).toHaveBeenCalledTimes(1)
      expect(await browser.storage.local.get(null)).toEqual({})
    },
  )

  it('requires an issuer for atproto callbacks', async () => {
    vi.spyOn(browser.identity, 'launchWebAuthFlow').mockResolvedValue(
      'https://callback.example/?code=code&state=expected',
    )
    await expect(login('alice.test')).rejects.toThrow('Missing callback parameters')
    expect(post).toHaveBeenCalledTimes(1)
    expect(await browser.storage.local.get(null)).toEqual({})
  })
})
