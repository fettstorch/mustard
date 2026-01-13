// AT Protocol OAuth client wrapper
import { BrowserOAuthClient, type OAuthSession } from '@atproto/oauth-client-browser'
import { once } from '@fettstorch/jule'

// The client_id is the URL to our hosted client-metadata.json (GitHub Pages)
const CLIENT_ID = 'https://fettstorch.github.io/mustard/client-metadata.json'

// Chrome extension redirect URI - must match client-metadata.json
// The type assertion is needed because the library expects specific URL patterns
const REDIRECT_URI = chrome.identity.getRedirectURL('callback') as `https://${string}`

const getOAuthClient = once(() =>
  BrowserOAuthClient.load({
    clientId: CLIENT_ID,
    handleResolver: 'https://bsky.social',
  }),
)

/**
 * Start login flow using chrome.identity for proper extension OAuth handling
 * @param handle - Bluesky handle like "alice.bsky.social"
 */
export async function login(handle: string): Promise<OAuthSession> {
  const client = await getOAuthClient()

  // Step 1: Get the authorization URL (this stores PKCE/DPoP keys in IndexedDB)
  const authUrl = await client.authorize(handle, { redirect_uri: REDIRECT_URI })

  // Step 2: Use Chrome's identity API to handle the OAuth popup
  const callbackUrl = await chrome.identity.launchWebAuthFlow({
    url: authUrl.href,
    interactive: true,
  })

  if (!callbackUrl) {
    throw new Error('Login was cancelled')
  }

  // Step 3: Extract params from callback URL (they're in the hash fragment)
  const hashParams = new URLSearchParams(new URL(callbackUrl).hash.slice(1))

  // Step 4: Complete the token exchange (uses stored PKCE/DPoP keys)
  const result = await client.callback(hashParams, { redirect_uri: REDIRECT_URI })

  // Store the session ID so init() can find it later
  // The library normally does this in initCallback(), but we're using callback() directly
  localStorage.setItem('@@atproto/oauth-client-browser(sub)', result.session.sub)

  return result.session
}

/**
 * Check if user is already logged in (restores previous session)
 * @returns Session if logged in, undefined otherwise
 */
export async function getSession(): Promise<OAuthSession | undefined> {
  const client = await getOAuthClient()
  const result = await client.init()
  return result?.session
}

/**
 * Logout - revokes the session
 * @param did - The user's DID to revoke
 */
export async function logout(did: string): Promise<void> {
  const client = await getOAuthClient()
  localStorage.removeItem('@@atproto/oauth-client-browser(sub)')
  await client.revoke(did)
}
