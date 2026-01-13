# Learnings

Simple learnings discovered during development that document how things actually work.

## Extension Icons

- `.ico` files don't work as extension icons; use `.png` files instead

## Supabase HTML Hosting

- **Supabase Storage**: Serves `.html` files with `Content-Type: text/plain` instead of `text/html` - browsers display raw HTML source
- **Supabase Edge Functions**: Intentionally rewrites `text/html` responses to `text/plain` - designed for APIs only, not serving HTML
- **Solution**: Use GitHub Pages, Cloudflare Pages, or similar static hosting for HTML files

## Content Script Styling

- **Shadow DOM**: Don't use for Vue components - Vue injects `<style>` tags into `document.head`, not the shadow root, so styles won't apply to the template
- **Tailwind CSS**: Don't use for content script components - CRXJS + Tailwind JIT has horrible DX (requires dev server restart for new classes, or styles leak to host page)
- **CRXJS HMR**: Works for template/script changes, but broken for ALL styles (Tailwind, Vue `<style>` tags, AND imported CSS files) - any style change requires dev server restart. Only inline styles in template work with HMR.
- **Solution**: Use Vue `<style scoped>` for isolation; accept poor DX or use a standalone dev playground for iterating on styles

## AT Protocol OAuth in Chrome Extensions

- `**@atproto/oauth-client-browser**`: Designed for same-origin web apps. Its `signInPopup()` uses BroadcastChannel (same-origin only) and tries to read popup URL (blocked cross-origin). Won't work out-of-the-box for extensions.
- `**chrome.identity.launchWebAuthFlow**`: Chrome's OAuth API for extensions. REQUIRES redirect_uri to be `https://<extension-id>.chromiumapp.org/*` - won't intercept other URLs.
- **Solution**: Use `client.authorize()` to get auth URL (stores PKCE/DPoP in IndexedDB), then `chrome.identity.launchWebAuthFlow()` for the popup, then `client.callback()` to exchange the code.
- **client-metadata.json**: Must be hosted on public HTTPS (GitHub Pages works). The `redirect_uris` must include the chromiumapp.org URL.
- **Session persistence**: When using `callback()` directly (not `initCallback()`), you must manually set `localStorage['@@atproto/oauth-client-browser(sub)']` to the session's `sub` — otherwise `init()` won't find the session.
- **Extension ID**: Changes when unpacked extension is removed/re-added. For stable ID, pack the extension or publish to Chrome Web Store.
- **GitHub Pages + Jekyll**: Add empty `.nojekyll` file to serve static files without Jekyll build.
- **Service worker + localStorage**: Manifest V3 service workers do NOT have `localStorage` access. The `BrowserOAuthClient.init()` method uses localStorage internally, so it won't work from a service worker. Solution: store session info in `chrome.storage.local` instead and manage session state manually.
- **Popup closes during OAuth**: Extension popups close when `launchWebAuthFlow` opens (loses focus). Run OAuth in the service worker (persists) and communicate via messaging.

