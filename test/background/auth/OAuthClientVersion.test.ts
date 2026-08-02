import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fakeBrowser } from 'wxt/testing/fake-browser'
import { authBridgePost } from '../../../src/background/auth/AuthBridge'

vi.mock('../../../src/background/auth/AuthBridge', () => ({ authBridgePost: vi.fn() }))

const mockedAuthBridgePost = vi.mocked(authBridgePost)

describe('OAuth callback client version', () => {
  beforeEach(() => {
    fakeBrowser.reset()
    mockedAuthBridgePost.mockReset()
    vi.spyOn(browser.identity, 'getRedirectURL').mockReturnValue(
      'https://callback.example/callback',
    )
    vi.spyOn(browser.runtime, 'getManifest').mockReturnValue({
      version: '2.9.0',
    } as ReturnType<typeof browser.runtime.getManifest>)
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('sends the manifest version with the atproto callback', async () => {
    const { login: loginWithAtproto } = await import('../../../src/background/auth/AtprotoAuth')
    mockedAuthBridgePost
      .mockResolvedValueOnce({ authUrl: 'https://auth.example', state: 'state-1' })
      .mockResolvedValueOnce({
        userId: '11111111-1111-4111-8111-111111111111',
        did: 'did:plc:test',
        jwt: 'jwt-1',
        expiresAt: 123,
        refreshToken: 'refresh-1',
      })
    vi.spyOn(browser.identity, 'launchWebAuthFlow').mockResolvedValue(
      'https://callback.example/?code=code-1&iss=https%3A%2F%2Fissuer.example&state=state-1',
    )

    await loginWithAtproto('alice.test')

    expect(mockedAuthBridgePost).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        action: 'callback',
        provider: 'atproto',
        clientVersion: '2.9.0',
      }),
    )
  })

  it('sends the manifest version with the github callback', async () => {
    const { loginWithGithub } = await import('../../../src/background/auth/GithubAuth')
    mockedAuthBridgePost
      .mockResolvedValueOnce({ authUrl: 'https://github.example', state: 'state-2' })
      .mockResolvedValueOnce({
        userId: '11111111-1111-4111-8111-111111111111',
        jwt: 'jwt-2',
        expiresAt: 456,
        refreshToken: 'refresh-2',
      })
    vi.spyOn(browser.identity, 'launchWebAuthFlow').mockResolvedValue(
      'https://callback.example/?code=code-2&state=state-2',
    )

    await loginWithGithub()

    expect(mockedAuthBridgePost).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        action: 'callback',
        provider: 'github',
        clientVersion: '2.9.0',
      }),
    )
  })
})
