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
- `assetsInlineLimit` only applies to production builds — in dev mode Vite serves assets as URLs, which with crxjs become `chrome-extension://` URLs and fail CSP the same way
- Fix: a Vite `transform` plugin that converts PNG imports from `src/assets/icons/` to `data:image/png;base64,...` strings at transform time — works in both dev and prod, no `web_accessible_resources` needed, no runtime fetch needed

## Content Script Styling

- **Shadow DOM**: Don't use for Vue components - Vue injects `<style>` tags into `document.head`, not the shadow root, so styles won't apply to the template
- **Tailwind CSS**: Don't use for content script components - CRXJS + Tailwind JIT has horrible DX (requires dev server restart for new classes, or styles leak to host page)
- **CRXJS HMR**: Works for template/script changes, but broken for ALL styles (Tailwind, Vue `<style>` tags, AND imported CSS files) - any style change requires dev server restart. Only inline styles in template work with HMR.
- **Solution**: Use Vue `<style scoped>` for isolation; accept poor DX or use a standalone dev playground for iterating on styles

## AT Protocol OAuth in Chrome Extensions

- **ATProto access tokens are opaque**: The JWKS endpoint (`bsky.social/oauth/jwks`) returns `{"keys":[]}` — third parties cannot verify access token signatures. This rules out "pass the access token to your backend for verification" approaches.
- **BFF (Backend For Frontend) pattern required**: Since tokens can't be independently verified, the server must be the OAuth client. The auth-bridge Edge Function handles PAR, DPoP, PKCE, and token exchange; the extension only opens the auth page and forwards the callback.
- **`@atproto/oauth-client-browser` not needed with BFF**: The library is designed for client-side OAuth. With BFF, the extension just makes fetch calls to auth-bridge and uses `chrome.identity.launchWebAuthFlow()` for the browser redirect — no client-side OAuth SDK required.
- **Identity verification after token exchange**: The `sub` (DID) from the token response must be independently resolved (DID→PDS→AS) to confirm the Authorization Server is actually authoritative for that identity. Without this, a malicious AS could claim to authenticate any DID.
- **DPoP nonce retry**: Authorization Servers reject the first DPoP-signed request with `use_dpop_nonce` error and provide the nonce in the response header. Standard pattern: send with empty nonce, retry with the server-provided nonce.
- **client-metadata.json**: Must be hosted on public HTTPS (GitHub Pages works). The `redirect_uris` must include the chromiumapp.org URL.
- **Extension ID**: Changes when unpacked extension is removed/re-added. For stable ID, pack the extension or publish to Chrome Web Store.
- **GitHub Pages + Jekyll**: Add empty `.nojekyll` file to serve static files without Jekyll build.
- **Popup closes during OAuth**: Extension popups close when `launchWebAuthFlow` opens (loses focus). Run OAuth in the service worker (persists) and communicate via messaging.
