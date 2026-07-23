---
name: cross-browser-webext
description: >-
  Cross-browser WebExtension knowledge for the Mustard extension built on WXT:
  Chrome vs Firefox API differences, background/content-script messaging quirks,
  content-script CSP constraints (icons, fonts, styling), and stable extension
  identity. Use when editing entrypoints, wxt.config/manifest, content scripts,
  background messaging, context menus, the icon badge, or debugging behavior that
  works in one browser but not the other.
---

# Cross-Browser WebExtension (WXT)

Hard-won quirks for building Mustard as a single codebase targeting Chrome (MV3)
and Firefox (MV2/MV3) with WXT. Read this before touching `wxt.config.ts`,
`src/entrypoints/**`, background messaging, or content-script injection.

## WXT build framework

- **Output dir** defaults to `dist/{browser}-mv{manifestVersion}/`. For clean
  per-browser dirs use `outDirTemplate: '{{browser}}'` with `outDir: 'dist'` →
  `./dist/chrome`, `./dist/firefox`.
- **Entrypoints** must live in `src/entrypoints/` (respects `srcDir`):
  background → `defineBackground()`, content scripts → `defineContentScript()`,
  unlisted scripts → `defineUnlistedScript()`.
- **CSS reset**: removing Tailwind also removes its Preflight reset. Add a minimal
  reset to `main.css` (`box-sizing: border-box`, `body { margin: 0 }`,
  `button { padding: 0 }`) or popup/options layouts break.
- **Per-browser manifest**: use the function form
  `manifest: ({ browser }) => ({ ... })` to branch (e.g. `key` only on chrome,
  `browser_specific_settings` only on firefox).
- **Manifest icons**: `.ico` files don't work as extension icons — use `.png`.

## Keyboard command defaults on Windows

- Treat `commands.*.suggested_key` as a best-effort default, not a guaranteed
  binding. Chrome leaves a command unassigned when another extension already
  owns the combination, and operating-system or browser shortcuts take priority.
  Read the resolved bindings with `commands.getAll()` and give users a route to
  the browser's shortcut settings.
- Avoid known Windows collisions: [NVIDIA uses `Alt+Shift+Z`](https://nvidia.custhelp.com/app/answers/detail/a_id/4825/)
  for its Highlights overlay, [Chrome reserves `Alt+Shift+A`](https://support.google.com/chrome/answer/157179)
  for inactive dialogs, and [Windows uses `Alt+Shift`](https://support.microsoft.com/en-gb/office/switch-between-languages-using-the-language-bar-1c2242c0-fe15-4bc3-99bc-535de6f4f258)
  itself for keyboard-layout switching. Mustard therefore removes `Shift` from
  its Windows bindings: `Alt+M` (popup), `Alt+N` (hide/show minimized notes),
  and `Alt+G` (get all notes).
- Express platform overrides inside each command's `suggested_key` object using
  its `windows` property; keep `default` for every other platform. Both WXT's
  Chrome MV3 and Firefox MV2 manifests preserve these keys.
- Playwright's `page.keyboard.press()` sends renderer input and does not activate
  browser-level extension commands, so it cannot functionally test a manifest
  shortcut. On a real Windows runner, load the extension and assert the resolved
  Windows values through `commands.getAll()`; use a manual OS-level keypress on
  Windows for the final command-dispatch and system-conflict smoke test.

## `browser` global is NOT webextension-polyfill

- `@wxt-dev/browser` is just `globalThis.browser ?? globalThis.chrome`. On Chrome
  it's the **raw callback-style** API; on Firefox it's the **Promise-style** API.
  Cross-browser code must not rely on polyfill behavior.
- **MV2 has no `browser.action`** (MV3 only). Fall back to `browser.browserAction`
  at runtime via a `getActionApi()` shim — WXT does not polyfill this.

## Messaging (background ↔ content/popup)

- **Async response**: Chrome uses `return true + sendResponse(...)`; Firefox
  ignores `return true` and expects the listener to **return a Promise**.
  Chrome 99+ also supports Promise return → a single Promise-returning listener
  works on both. **Do NOT use `sendResponse`** if you want Firefox compatibility.
- **Vue reactive Proxies fail Firefox `structuredClone`**:
  `runtime.sendMessage(vueReactiveObject)` throws
  `DOMException: Proxy object could not be cloned` on Firefox (Chrome serializes
  silently). Strip reactivity at the relay boundary with
  `JSON.parse(JSON.stringify(message))` for plain-data messages.
- **Always log `.catch` on `sendMessage`** — silent catches hide cross-browser
  bugs (a `.catch(() => {})` once swallowed the Proxy error and cost real time).

## Firefox context menus (MV3) lost on restart

- `browser.contextMenus.create` called **only** inside `runtime.onInstalled`
  disappears after a disable→re-enable cycle (bug
  [1817287](https://bugzilla.mozilla.org/show_bug.cgi?id=1817287), still open).
  `onInstalled` fires on install/update only — not startup or enable.
- **Fix**: extract `ensureContextMenu()` that calls `contextMenus.removeAll()`
  then `.create()`, and invoke it from `onInstalled`, `onStartup`, **and** the
  top level of the background script (Mozilla's documented workaround).

## Content-script CSP constraints

Content scripts run under the **host page's** CSP, not the extension's. This bites
in several ways:

- **Icons/images**: `<img src="chrome-extension://...">` is blocked by the host
  page's `img-src`. `chrome.runtime.getURL()` as `src` fails on strict pages.
  `assetsInlineLimit` only helps in prod builds; dev serves assets as URLs that
  fail CSP the same way. **Fix**: a Vite `transform` plugin (`inlineIcons`) that
  converts PNG imports from `src/assets/icons/` to `data:image/png;base64,...`
  at transform time — works in dev + prod, no `web_accessible_resources` or
  runtime fetch needed.
- **Web fonts**: fonts from content-script CSS (`@font-face`/`@import`/`<link>`)
  download under the host page's `font-src`/`style-src`. Strict pages (GitHub)
  block them, and **base64-inlining the font does NOT bypass this** (confirmed:
  Chrome docs + w3c/webextensions #839) — it silently falls back. **System fonts
  are CSP-proof** (referencing an installed font by name is not a network load).
  Mustard's picker offers a "System" group (always works) + a "Web" group (may
  fall back on strict pages). All text flows through one `--mustard-font` CSS var.
- **`queryLocalFonts()` is not worth it**: Chromium-only, permission-prompted, and
  restricted in content scripts. A curated cross-platform system-font list is more
  robust.
- **Styling / Shadow DOM**: don't use Shadow DOM for Vue components — Vue injects
  `<style>` into `document.head`, not the shadow root, so styles won't apply. Use
  `<style scoped>` for isolation; host page styles can still bleed into deeply
  nested elements — use `:deep()` with `!important` where needed (e.g. markdown
  heading colors).

### Link previews / Open Graph cards

- Never fetch an arbitrary preview URL from a content script: in MV3 it is
  subject to the page's CORS policy even when the extension has host
  permissions. Fetch in the background/extension context (or a backend) and
  relay only a small, sanitized metadata DTO to the content script.
- A direct `og:image` `<img>` in the injected note UI is also subject to the
  host page's `img-src` CSP, so it will fail on strict sites. Render a
  CSP-independent asset (for example, a bounded data URI produced by the
  extension, or an image served through a permitted/proxied path) and always
  provide a no-image card fallback.
- A backend unfurler accepts attacker-controlled URLs. It needs strict `http` /
  `https` parsing, a small timeout/body cap, redirect-by-redirect validation,
  private/link-local/loopback address blocking, and rate limiting; metadata and
  images are untrusted display data, never HTML to inject. Browser `fetch()`
  cannot implement redirect-by-redirect validation: `redirect: 'manual'`
  produces an opaque redirect with no exposed status or `Location`. An
  author-initiated extension fetch may use `follow` with omitted credentials and
  validate the final URL; use a backend with controlled egress when strict
  redirect-chain enforcement is required.
- Published previews must not make a follower's extension fetch the author's
  stored `og:image` URL. Mustard resizes the source in the author's background,
  uploads a WebP of at most 20 KB to the `link-preview-thumbnails` Supabase
  Storage bucket, and stores only its validated `thumbnailPath`. The path is
  immutable and globally content-addressed (`global/sha256.webp`), so all
  authors share identical thumbnail bytes. Clients cannot write or delete
  global objects directly: an authenticated Edge Function verifies the caller's
  exact owned-note reference and recomputes the content hash before a privileged
  upload. The same service prevents deletion while any author's note references
  the object. Cards progressively request the trusted path from the background
  when visible; note queries return metadata immediately and never wait for
  image downloads.
- For editor URL unfurling, debounce the **normalized first URL**, not the whole
  note body. Use jule `getDebouncer()` when Vue unmount must cancel the pending
  timer; `debounced()` has no `clear()` handle. A short-TTL jule `cached()` async
  loader coalesces editor/save requests for the same URL.
- Link-preview dismissal is an authoring decision, not merely hidden UI state.
  Carry `linkPreviewDismissed` across the content-script → background message so
  save-time unfurling cannot recreate it, and persist the flag on local notes so
  publishing that draft later preserves the user's choice.

### Authenticated extension E2E isolation

- A fresh Playwright browser context does not isolate the local Supabase
  database. Tests using the deterministic authenticated accounts must import
  `authenticated.fixture` (extension UI) or `local-supabase.fixture` (database
  only). Their automatic test-scoped fixture reseeds and removes those accounts
  around every test so notes, follows, and notifications cannot leak between
  tests. Extension tests request `authenticatedContext` explicitly; because it
  is on-demand, file-level `beforeEach` data setup finishes before the extension
  starts and can warm its remote-index cache. Keep one-off rate-limit accounts
  self-contained with their existing transient-user hooks.

## Stable extension identity (needed for OAuth redirect URIs)

- **Chrome**: unpacked ID is path-derived (or key-derived if `key` is set). Paste
  the Web Store listing's public key (Developer Dashboard → Package → "View public
  key") into `manifest.key` so local dev shares the production extension ID — one
  OAuth redirect URI instead of two. You **cannot** reproduce a path-derived ID via
  `key` (the ID is a one-way hash; without the original private key it's lost).
- **Firefox**: temporary add-ons get a random ID per install. Pin via
  `browser_specific_settings.gecko.id` in `name@something` format (no real domain
  needed, e.g. `mustard@notes`). The OAuth redirect URI is then
  `https://<sha1(addonId)>.extensions.allizom.org/<path>` — predict it by
  SHA-1-hashing the gecko.id before deploying client metadata. AMO uses whatever
  `gecko.id` you set, so dev and prod share one ID/redirect URI (no key dance).

> For the OAuth flow that consumes these redirect URIs, see the
> `atproto-supabase-auth` skill.

## Build-time browser detection (not runtime sniffing)

- WXT exposes `import.meta.env.FIREFOX` / `import.meta.env.CHROME` as **build-time
  constants** (tree-shakeable per target). Use these to branch browser-specific
  behavior — don't sniff at runtime via `getBrowserInfo`/UA. Each `dist/{browser}`
  bundle then contains only its own branch.

## Client update / "update now" (version guard)

There is **no cross-browser "force update"** — stores auto-update extensions on
their own schedule. `AppStatusService.requestClientUpdate()` only shrinks the
window, and the two browsers differ sharply:

- **Chrome**: `chrome.runtime.requestUpdateCheck()` asks the Web Store for a
  newer version; if `status === 'update_available'`, `runtime.reload()` applies
  it. Register the `runtime.onUpdateAvailable` → `reload()` listener **only after
  the user opts in**, or an unrelated background update can reload the extension
  under the user. Falls back to opening the store listing if throttled/none
  pending.
- **Firefox**: no `requestUpdateCheck`, can't open `about:addons`
  programmatically — the only lever is opening the AMO listing in a tab.
- The store URLs are constants in `AppStatusService` (Chrome detail-by-id URL
  redirects to the current listing; AMO uses the slug). Selection is via
  `import.meta.env.FIREFOX`.
- The guard itself (min-version check, read-only gating of remote writes) is in
  the `mustard-architecture` skill; this section is just the browser-update
  mechanics.

## UI: smooth expand animations (content-script pills/labels)

- `grid-template-columns: 0fr → 1fr` with `overflow: hidden` on the container and
  `min-width: 0` on the inner element gives smooth **width**-expand animations —
  same trick as `grid-template-rows` for height, just on the X axis (used by the
  CommentToggle pill and minimized-note pills).
- An implicit `auto` grid column sizes to its content's preferred width, so a
  `flex: 1` child has no extra space to grow into. Switch to `minmax(0, 1fr)` so
  the column fills its container and flex children can actually expand when the
  surrounding layout widens.
