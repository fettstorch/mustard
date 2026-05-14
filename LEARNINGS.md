# Learnings

Simple learnings discovered during development that document how things actually work.

## Extension Icons

- `.ico` files don't work as extension icons; use `.png` files instead

## Supabase HTML Hosting

- **Supabase Storage**: Serves `.html` files with `Content-Type: text/plain` instead of `text/html` - browsers display raw HTML source
- **Supabase Edge Functions**: Intentionally rewrites `text/html` responses to `text/plain` - designed for APIs only, not serving HTML
- **Solution**: Use GitHub Pages, Cloudflare Pages, or similar static hosting for HTML files

## Content Script Icons & CSP

- `<img src="chrome-extension://...">` injected by a content script is blocked by the host page's `img-src` CSP — `chrome.runtime.getURL()` directly as `src` won't work on strict pages
- `assetsInlineLimit` only applies to production builds — in dev mode Vite serves assets as URLs which become `chrome-extension://` URLs and fail CSP the same way (applies to both WXT and CRXJS)
- Fix: a Vite `transform` plugin that converts PNG imports from `src/assets/icons/` to `data:image/png;base64,...` strings at transform time — works in both dev and prod, no `web_accessible_resources` needed, no runtime fetch needed

## Content Script Styling

- **Shadow DOM**: Don't use for Vue components - Vue injects `<style>` tags into `document.head`, not the shadow root, so styles won't apply to the template
- **Solution**: Use Vue `<style scoped>` for isolation; host page styles can still bleed into deeply nested elements — use `:deep()` with `!important` where needed (e.g. markdown heading colors)

## WXT Build Framework

- **Default output dir** is `dist/{browser}-mv{manifestVersion}/`. For per-browser output use `outDirTemplate: '{{browser}}'` with `outDir: 'dist'` → `./dist/chrome`, `./dist/firefox`
- **Entrypoints** must live in `src/entrypoints/` (respects `srcDir`): background → `defineBackground()`, content scripts → `defineContentScript()`, unlisted scripts → `defineUnlistedScript()`
- **CSS reset**: Removing Tailwind also removes its Preflight reset. Add a minimal reset to `main.css` (`box-sizing: border-box`, `body { margin: 0 }`, `button { padding: 0 }`) to avoid broken layouts in popup/options pages
- **`browser` global is NOT webextension-polyfill**: `@wxt-dev/browser` is just `globalThis.browser ?? globalThis.chrome`. On Chrome this is the raw callback-style API, on Firefox it's the Promise-style API. Cross-browser code must not rely on polyfill behavior
- **Per-browser manifest**: use the function form `manifest: ({ browser }) => ({ ... })` to branch on browser (e.g. include `key` only on chrome, `browser_specific_settings` only on firefox)

## AT Protocol OAuth in Chrome Extensions

- **ATProto access tokens are opaque**: The JWKS endpoint (`bsky.social/oauth/jwks`) returns `{"keys":[]}` — third parties cannot verify access token signatures. This rules out "pass the access token to your backend for verification" approaches.
- **BFF (Backend For Frontend) pattern required**: Since tokens can't be independently verified, the server must be the OAuth client. The auth-bridge Edge Function handles PAR, DPoP, PKCE, and token exchange; the extension only opens the auth page and forwards the callback.
- **`@atproto/oauth-client-browser` not needed with BFF**: The library is designed for client-side OAuth. With BFF, the extension just makes fetch calls to auth-bridge and uses `browser.identity.launchWebAuthFlow()` for the browser redirect — no client-side OAuth SDK required.
- **Identity verification after token exchange**: The `sub` (DID) from the token response must be independently resolved (DID→PDS→AS) to confirm the Authorization Server is actually authoritative for that identity. Without this, a malicious AS could claim to authenticate any DID.
- **DPoP nonce retry**: Authorization Servers reject the first DPoP-signed request with `use_dpop_nonce` error and provide the nonce in the response header. Standard pattern: send with empty nonce, retry with the server-provided nonce.
- **client-metadata.json**: Must be hosted on public HTTPS (GitHub Pages works). The `redirect_uris` must include the chromiumapp.org URL.
- **Extension ID**: Changes when unpacked extension is removed/re-added. For stable ID, pack the extension or publish to Chrome Web Store.
- **GitHub Pages + Jekyll**: Add empty `.nojekyll` file to serve static files without Jekyll build.
- **Popup closes during OAuth**: Extension popups close when `launchWebAuthFlow` opens (loses focus). Run OAuth in the service worker (persists) and communicate via messaging.
- **Supabase JWT refresh 404**: auth-bridge deletes `oauth_session` row when ATProto token refresh fails (e.g. race condition consuming single-use refresh token). Extension must treat 404/4xx/502 from refresh as "needs re-login" — clear both ATProto session and Supabase JWT from storage and broadcast `SESSION_CHANGED(null)`. Do NOT clear on 5xx (transient server errors).

## Cross-Browser Extension Messaging

- **`onMessage` async response**: Chrome uses `return true + sendResponse(...)`; Firefox ignores `return true` and expects the listener to **return a Promise**. Chrome 99+ also supports Promise return — so a single Promise-returning listener works on both. Do NOT use `sendResponse` if you want firefox compatibility
- **Vue reactive Proxies fail Firefox `structuredClone`**: `runtime.sendMessage(vueReactiveObject)` throws `DOMException: Proxy object could not be cloned` on Firefox (Chrome serializes silently). Strip reactivity before sending — `JSON.parse(JSON.stringify(message))` at the relay boundary works for plain-data messages
- **Always log `.catch` on `sendMessage`**: silent catches hide cross-browser bugs (we wasted time guessing because a `.catch(() => {})` swallowed the Proxy error)

## Firefox Extension Identity & OAuth

- **Stable addon ID via `browser_specific_settings.gecko.id`**: temporary add-ons get a random ID per install. Pin it to anything in `name@something` format (no real domain required, e.g. `mustard@notes`) so the OAuth redirect URI is stable
- **Firefox OAuth redirect URI** = `https://<sha1(addonId)>.extensions.allizom.org/<path>` — predict it by SHA-1-hashing the gecko.id string before deploying client metadata
- **AMO does not assign an ID**: unlike Chrome Web Store, the AMO submission uses whatever `gecko.id` you set — so dev and prod naturally share one ID/redirect URI with no key dance

## Chrome Web Store Extension Identity

- **Pin local unpacked ID to store ID via `manifest.key`**: extension ID for unpacked loads is path-derived (or key-derived if `key` is set). Paste the Web Store listing's public key (from Developer Dashboard → Package → "View public key") into `manifest.key` to make local dev share the production extension ID — eliminates the need to register two OAuth redirect URIs
- **You cannot reproduce a path-derived ID via `key`**: the ID is a one-way hash of the public key, so without the original private key you can't recover the matching `key` value
