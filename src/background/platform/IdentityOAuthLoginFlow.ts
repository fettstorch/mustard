import { authBridgePost } from '../auth/AuthBridge'
import type { OAuthLoginFlow, OAuthLoginRequest, OAuthSessionResult } from './OAuthLoginFlow'

/** Existing Chrome/Firefox initiate → identity → callback transport. */
export class IdentityOAuthLoginFlow implements OAuthLoginFlow {
  async start(request: OAuthLoginRequest): Promise<OAuthSessionResult> {
    // Resolve only when login starts; importing auth must not require identity.
    const redirectUri = browser.identity.getRedirectURL('callback')
    const { authUrl, state } = await authBridgePost({
      action: 'initiate',
      provider: request.provider,
      ...(request.provider === 'atproto' ? { handle: request.handle } : {}),
      redirect_uri: redirectUri,
    })

    const callbackUrl = await browser.identity.launchWebAuthFlow({
      url: authUrl as string,
      interactive: true,
    })
    if (!callbackUrl) throw new Error('Login was cancelled')

    const url = new URL(callbackUrl)
    const code = url.searchParams.get('code')
    const returnedState = url.searchParams.get('state')
    const iss = url.searchParams.get('iss')
    if (!code || !returnedState || (request.provider === 'atproto' && !iss)) {
      throw new Error('Missing callback parameters')
    }
    if (returnedState !== (state as string)) throw new Error('State mismatch')

    const result = await authBridgePost({
      action: 'callback',
      provider: request.provider,
      code,
      state,
      ...(request.provider === 'atproto' ? { iss } : {}),
      clientVersion: browser.runtime.getManifest().version,
      ...(request.currentJwt !== undefined ? { currentJwt: request.currentJwt } : {}),
    })

    return {
      userId: result.userId as string,
      jwt: result.jwt as string,
      expiresAt: result.expiresAt as number,
      refreshToken: result.refreshToken as string,
      ...(request.provider === 'atproto' ? { did: result.did as string } : {}),
    }
  }
}
