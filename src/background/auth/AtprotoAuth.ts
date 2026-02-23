// AT Protocol OAuth client wrapper
import { BrowserOAuthClient, type OAuthSession } from '@atproto/oauth-client-browser'
import { once } from '@fettstorch/jule'

// The client_id is the URL to our hosted client-metadata.json (GitHub Pages)
const CLIENT_ID = 'https://fettstorch.github.io/mustard/client-metadata.json'

// Chrome extension redirect URI - must match client-metadata.json
// The type assertion is needed because the library expects specific URL patterns
const REDIRECT_URI = chrome.identity.getRedirectURL('callback') as `https://${string}`

// Storage key for persisting session info
// NOTE: We use chrome.storage.local instead of localStorage because service workers
// don't have localStorage access. The BrowserOAuthClient's init() uses localStorage
// internally, so we bypass it and manage session state ourselves.
const STORAGE_KEY = 'atproto_session'

type StoredSession = { did: string; sub: string }

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

  // Store session info in chrome.storage.local (works in service workers, unlike localStorage)
  const storedSession: StoredSession = { did: result.session.did, sub: result.session.sub }
  await chrome.storage.local.set({ [STORAGE_KEY]: storedSession })

  return result.session
}

/**
 * Check if user is already logged in.
 *
 * WARNING: This only reads stored session info - it does NOT validate if tokens are expired.
 * Currently sufficient because we only use `did` for public API calls (no auth needed).
 *
 * TODO: When authenticated API calls are needed (posting, following, etc.), replace this with
 * `client.init()` which properly validates/refreshes tokens and returns a full OAuthSession.
 * See: https://github.com/bluesky-social/atproto/tree/main/packages/oauth/oauth-client-browser
 *
 * @returns Session info if logged in, undefined otherwise
 */
export async function getSession(): Promise<StoredSession | undefined> {
  const result = await chrome.storage.local.get(STORAGE_KEY)
  return result[STORAGE_KEY] as StoredSession | undefined
}

/**
 * Logout - clears stored state
 * @param _did - The user's DID (unused, kept for API compatibility)
 *
 * NOTE: We don't call client.revoke() because BrowserOAuthClient uses localStorage
 * internally, which isn't available in service workers. Our tokens will simply expire.
 */
export async function logout(_did: string): Promise<void> {
  await chrome.storage.local.remove(STORAGE_KEY)
}
