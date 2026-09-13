# macOS Safari support plan

Research date: **2026-09-12**. Status updated **2026-09-13**: **desktop Safari preview works; Bluesky and GitHub login manually confirmed; OAuth deployment complete**. See section 9 for verification and remaining release work. The initial research below is retained as design rationale, not a list of unfinished implementation tasks.

## Scope and priority

**Scope: desktop Safari on macOS only.** Mobile support is outside this plan.

**Scope discipline: only changes directly needed for desktop Safari support and its Chrome/Firefox regression checks belong here. No opportunistic cleanup, new authentication protocol, database migration, or general security redesign.**

**Highest priority: existing Chrome and Firefox versions must keep working.** This covers both newly built extensions and already installed clients calling the updated backend. Safari support cannot ship at the cost of either browser's behavior, stored data, authentication, notifications, or update flow.

✅ Keep WXT, Vue, the note model, and the Supabase backend. Introduce small interfaces around browser-dependent systems, retaining the existing Chrome/Firefox implementations behind them.

❌ A Safari build flag alone is insufficient: authentication and update initialization can stop its background from starting.

Use **Safari MV3 explicitly**. Proposed initial minimum: **Safari 18.4 on macOS**, to confirm against intended Mac/OS coverage. This is not a claim of tested runtime support.

Follow the [README Project Vision](../README.md#project-vision): annotate arbitrary pages, save locally without login, publish through Bluesky/GitHub, see followed users' notes, and support SPA navigation. Safari should preserve these outcomes. Native OS notifications and editable keyboard shortcuts are secondary capabilities.

## 1. Initial research evidence and limits

| Check                                              | Result                                                                                                                    | Meaning                                                                                                         |
| -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| Installed tooling                                  | WXT **0.20.27**, Vite **8.1.4**, Xcode **26.6**                                                                           | Audit used installed dependencies; `package.json` declares WXT `^0.20.25`                                       |
| Installed WXT implementation                       | Safari and Firefox default to MV2                                                                                         | Verified in `node_modules/wxt/dist/core/resolve-config.mjs`; use `--mv3`                                        |
| Unchanged-source Safari MV3 build                  | **Passed** in a temporary copy of source, config, public assets, and public production env; reused installed dependencies | Generated `background.service_worker`, popup, options, content scripts, and SPA script; about **3.24 MB** total |
| Apple project generation                           | **Passed**, macOS-only, unsigned, disposable Xcode project                                                                | Packager warned about **identity** and **notifications**                                                        |
| Safari runtime, native compilation, signing, OAuth | **Not tested**                                                                                                            | Build/package generation does not establish working support                                                     |
| Existing automated tests                           | Chromium extension E2E; Chrome/Firefox builds in CI                                                                       | No Safari extension runtime coverage                                                                            |

Probe details:

- Successful build: `node <repo>/node_modules/wxt/bin/wxt.mjs build -b safari --mv3`, with the working directory set to the canonical physical path of the temporary project.
- An initial temporary-root invocation failed in WXT's import phase with `Browser.identity.getRedirectURL not implemented`. Running from the canonical temporary project directory resolved that probe failure without source changes. It is **not evidence that the normal build is broken**.
- Packager initially returned exit 65, `requires access to the supplied path / Unable to parse manifest.json`; the same command succeeded outside the sandbox. Treat that message as potentially an access failure before changing the manifest.
- Build emitted a large-chunk warning. Measure memory and startup on supported Macs; no bundle-size optimization was performed here.
- Public docs were checked live. API support was cross-checked against Mozilla's compatibility data. Historical issue reports inform tests, not claims about current defects.

WXT documents its browser targets and Node-based entrypoint import phase: [browser targets](https://wxt.dev/guide/essentials/target-different-browsers), [entrypoint loaders](https://wxt.dev/guide/essentials/config/entrypoint-loaders).

## 2. What should carry over, and what needs work

This table records the initial audit, before the implementation checkpoints below. “Expected reuse” means supported APIs and portable code, **not runtime-verified**.

| Area                                       | macOS Safari                            | Mustard evidence / action                                                                         |
| ------------------------------------------ | --------------------------------------- | ------------------------------------------------------------------------------------------------- |
| WXT/Vue/TypeScript, bundled assets         | Expected reuse                          | Build passed; keep existing entrypoints and DTOs                                                  |
| Popup and options pages                    | Supported, test sizing/focus            | `src/entrypoints/{popup,options}/`; popup has a fixed 300 px width                                |
| Background/content messaging               | Supported                               | `src/shared/messaging.ts` already sends plain DTOs; test Promise replies and dropped receivers    |
| Local notes and preferences                | `storage.local` supported               | `MustardNotesServiceLocal.ts`; test quota failures and stable storage keys                        |
| Remote index cache                         | `storage.session` requires Safari 16.4+ | `MustardNotesServiceRemote.ts` calls it directly; no older-version fallback today                 |
| Backend notes, comments, follows, sessions | Expected reuse after auth works         | UUID account model and authenticated Supabase requests remain shared                              |
| Website injection                          | Supported after site access is granted  | `<all_urls>` is not automatic user consent                                                        |
| SPA navigation and element anchors         | Expected reuse; test real sites         | Script-tag injection of `url-change-detector.js`, selector/position fallback, site strategies     |
| Bluesky/GitHub OAuth                       | **Blocked**                             | `identity` is unsupported; both auth modules access it at import time                             |
| Assisted extension updates                 | **Blocked initialization**              | Non-Firefox selects Chrome provider; unguarded `onUpdateAvailable.addListener`                    |
| Right-click creation                       | Context menus supported                 | Keep the existing `background.ts` menu path; verify desktop Safari dispatch                       |
| Alt-click, drag, hover actions             | Test keyboard/mouse behavior            | `content/index.ts`, `note/MustardNote.vue`: mouse events and hover reveal                         |
| Toolbar badge and commands                 | APIs available; test resolved bindings  | Existing action/browserAction shim helps; retain visible controls                                 |
| Native notifications                       | **API unsupported**                     | Runtime guard exists in `native-notifications.ts`; remove permission and hide unsupported setting |
| In-app unread indicators                   | Expected reuse                          | Keep popup badges, note/thread indicators, comments, and notification data                        |
| Link-preview thumbnails                    | Capability-dependent                    | Existing `createImageBitmap` / `OffscreenCanvas` checks and text-only fallback are useful         |
| Browser settings links                     | **Wrong browser instructions**          | Options uses non-Firefox → `chrome://extensions/shortcuts`; add Safari-specific copy              |
| Store installation and upgrades            | Apple app distribution                  | WXT ZIP is not an installable App Store app                                                       |

Sources: [Apple compatibility assessment](https://developer.apple.com/documentation/safariservices/assessing-your-safari-web-extension-s-browser-compatibility); Mozilla data for [identity](https://raw.githubusercontent.com/mdn/browser-compat-data/main/webextensions/api/identity.json), [runtime](https://raw.githubusercontent.com/mdn/browser-compat-data/main/webextensions/api/runtime.json), [notifications](https://raw.githubusercontent.com/mdn/browser-compat-data/main/webextensions/api/notifications.json), [storage](https://raw.githubusercontent.com/mdn/browser-compat-data/main/webextensions/api/storage.json), [commands](https://raw.githubusercontent.com/mdn/browser-compat-data/main/webextensions/api/commands.json), [tabs](https://raw.githubusercontent.com/mdn/browser-compat-data/main/webextensions/api/tabs.json), and [action](https://raw.githubusercontent.com/mdn/browser-compat-data/main/webextensions/api/action.json).

## Phase 0: automated Chromium baseline and manual Firefox coverage

**Decision confirmed on 2026-09-12:** retain the established Chromium E2E suites, including real Bluesky login, and test Firefox manually. Do not build a Firefox automation harness, use undocumented browser preferences, or add unproven workarounds. New GitHub login E2E is not required; GitHub remains a supported product feature. Preserve Chrome/Firefox behavior throughout Safari work.

### Current coverage, verified from the repository

| Suite                                                     | Browser actually launched             | Authentication                                                                                                                                  | What it proves / misses                                                                                                              |
| --------------------------------------------------------- | ------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `test/e2e/` via `playwright.config.ts`                    | Bundled Chromium, Chrome MV3 artifact | Anonymous unless a fixture supplies a session                                                                                                   | Local-note/UI behavior; no Firefox runtime coverage                                                                                  |
| `test/e2e/authenticated/` via `playwright.auth.config.ts` | Same Chromium fixture                 | `authenticated.fixture.ts` obtains a local test token through `exchangeLegacyJwtForSession` and writes session/JWT state into extension storage | Real local-backend feature tests after authentication, **not provider login**; the seeded GitHub identity does not test GitHub OAuth |
| `test/live-e2e/bluesky-auth.spec.ts`                      | Same Chromium fixture                 | **Real Bluesky credentials, provider UI/consent, browser identity callback, local auth-bridge exchange**                                        | Verifies UUID, provider identity, stored JWT/refresh token, server-side ATProto session and logout; no GitHub or Firefox login       |
| `.github/workflows/ci.yml` live Bluesky job               | Bundled Chromium                      | Live provider + local Supabase; requires secrets on trusted runs                                                                                | Passed on the merged revision; see the verified run below                                                                            |
| Firefox quality checks                                    | No browser launched                   | None                                                                                                                                            | Build and addons-linter only                                                                                                         |

Concrete sources: `test/e2e/extension.fixture.ts` hardcodes `chromium.launchPersistentContext`, `dist/chrome`, service-worker evaluation, and `chrome-extension:` URLs. `scripts/run-local-e2e.mjs` always invokes `build:e2e:auth`, which builds Chrome. `test/live-e2e/` currently contains only the Bluesky spec.

Current commands:

- `npm run test:e2e:auth`: deterministic authenticated suite with injected sessions.
- `npm run test:e2e:auth:bluesky`: real Bluesky login on Chromium.
- `npm run test:e2e:all`: existing Chromium suites, including live Bluesky; **not all browsers or both login providers**.
- `npm run check`: quality/build checks; does not run E2E suites.

### Verified CI and local baseline on 2026-09-12

The merged update-service revision `5647efb7d7c133f5bf0971550369f9b603308c75` **passed all CI jobs**: 238 unit tests, 18 Chromium smoke tests, 49 authenticated tests, and one real Bluesky OAuth test. These E2E suites are already integrated into CI; Firefox runtime coverage is the missing browser cell. [Verified CI run and logs](https://github.com/fettstorch/mustard/actions/runs/34694669502)

Local tests used clean workspace `f595c08fc260630ae85d3f7226ceac49f676097a`, extension `2.14.2`, Node `24.19.0`, and Playwright's bundled Chrome for Testing `149.0.7827.55` (the same browser version as CI, on macOS instead of Linux). Local Supabase migrations `001` through `023` match the repository, but matching migrations did **not** mean matching database contents.

| Check                                                  | Local result                                                                                               |
| ------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------- |
| `npm run check`                                        | Passed: 238 unit tests and all quality/build checks; Firefox validation has zero errors and eight warnings |
| Initial smoke / authenticated E2E                      | 16/18 and 43/49 passed; all eight failures reproduced with the same local setup                            |
| Smoke after normalizing test configuration             | 17/18 passed; only the editor-transition race remains                                                      |
| Authenticated E2E after normalizing test configuration | 49/49 passed, including all six previous failures                                                          |
| Real Bluesky OAuth E2E                                 | Passed, including login/session assertions and logout                                                      |
| Firefox runtime / login E2E                            | Not run: Firefox 155.0 is installed, but there is no Firefox harness and geckodriver is not on PATH        |

**Seven initial failures were caused by local database state, not demonstrated application regressions.** The reused local database had `app_config.min_client_version = '999.0.0'`; CI creates a fresh database seeded with `0.0.0`. The local runner reuses a running stack and uses its local E2E build even for smoke tests. CI's smoke job uses `build:e2e`; its authenticated job uses a fresh local stack and `build:e2e:auth`. The `999.0.0` value deliberately triggers the production write guard and update toast. The outdated-client test temporarily sets this value and restores the previous value; ordinary fixture cleanup resets test accounts, not this singleton. The origin of the pre-existing value was not established. Temporarily setting only the local row to `0.0.0` cleared all seven guard-related failures without code changes; the original local value was restored afterward. Do not reset the user's whole database or weaken the production guard to fix test setup.

**The remaining smoke failure is a confirmed transition race.** `test/e2e/local-note.spec.ts:167` reopens the editor before its 200 ms closing transition finishes. A Playwright trace captured the old editor with `mustard-note-leave-active mustard-note-leave-to` alongside the new editor with `mustard-note-enter-from mustard-note-enter-active`. Both contain the save-button locator, which fails strict resolution. It passed on CI's Linux runner but reproduced locally; the test must wait for the first editor to be removed before reopening it, rather than choose an arbitrary matching button.

**Baseline reliability fixes:** the local runner now temporarily normalizes the minimum-version singleton for smoke/auth/all runs and restores the prior value in `finally`; unit coverage includes failed runs. The smoke test now waits for editor removal before reopening. The initial local failures did not mean these suites were absent from CI. Firefox automation was abandoned at the user's request; its unused Selenium dependencies were removed.

**Verification after these fixes (2026-09-12):** `npm run check` passed with 241 unit tests and both browser builds. `npm run test:e2e:all` passed all 18 smoke, 49 authenticated, and one real Bluesky OAuth test in a single run. The original local minimum version was restored afterward. This completes the local automated baseline; no manual Firefox login pass or CI run of these unpublished test fixes is claimed.

### Required browser checks

| Browser       | Method                                                   | Coverage                                                                                                                |
| ------------- | -------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| Chrome target | Existing Playwright automation with bundled Chromium     | Smoke, deterministic authenticated behavior, real Bluesky OAuth login/session checks/logout                             |
| Firefox       | Manual checks with the actual Firefox build              | Real Bluesky login, popup reopen, publish/read a test note, logout; repeat affected feature checks after shared changes |
| macOS Safari  | Manual real-browser validation as support is implemented | Installation, startup, permissions, local notes, OAuth, background suspension, updates and signed upgrades              |

Keep `npm run check` and `npm run test:e2e:all` green before production browser-boundary changes. Both commands remain Chromium automation plus Chrome/Firefox build validation; they do not imply automated Firefox runtime coverage. Record manual Firefox results separately, including browser/build revision and the flows exercised. Schedule these checks at shared-code compatibility checkpoints and before release; absence of a Firefox E2E driver is not an implementation blocker.

### Manual Firefox checklist

1. Install the candidate Firefox extension in an isolated test profile using the normal WXT/Mozilla development flow.
2. Start Bluesky login in Mustard, enter the dedicated test account at the real provider, complete consent if shown, and confirm Mustard displays the expected identity.
3. Close/reopen the extension UI and verify it remains logged in. Publish a disposable note, revisit it, and delete the test note.
4. Log out and verify the logged-out UI; start login again and cancel to confirm clean retry behavior.
5. For shared auth/backend changes, repeat applicable checks with an archived pre-change Firefox artifact. For updates, notifications, permissions, settings, or content UI changes, manually exercise the corresponding existing behavior as well.

Temporary add-on reinstallation does not prove session persistence across browser restarts or signed upgrades; validate those separately with the appropriate installation. Manual Firefox acceptance remains required before release.

### CI and test-data discipline

- Preserve the existing Chromium smoke, authenticated, and live-Bluesky CI jobs. Live login requires a trusted run with repository secrets; missing credentials or provider failures must not be reported as a successful login test.
- Keep the live Bluesky traces, screenshots, and video disabled. Never upload passwords, tokens, provider responses, or browser profiles as diagnostics.
- Run suites sharing a local Supabase stack sequentially. Fresh browser profiles do not isolate database contents; the local runner owns/restores the test minimum version, and existing fixtures own deterministic test accounts.
- The existing live test looks up the newest login-state row. Keep it serialized; correlate an exact transaction before introducing concurrent live runs.
- Preserve the Chrome key, Firefox Gecko ID, provider registrations, confidential-client keys, existing session/storage contracts, and old client artifacts. No production auth changes are needed merely to test the browsers.

**Automated baseline exit gate:** quality/build checks, Chromium smoke/authenticated suites, and real Bluesky OAuth pass. Thereafter extract one browser boundary at a time, rerun relevant Chromium checks, and validate Firefox manually at compatibility checkpoints. Use documented, established tooling; do not add experimental browser automation to satisfy this gate.

## 3. Build and startup changes

### Explicit Safari build

The preview implements the following scripts. Use `build:safari` followed by manual reload. Both dev commands remain available, but their generated extension fails to open its popup in Safari; the cause is unresolved. Do not treat a running WXT server as a working Safari dev extension.

```json
{
  "build:safari": "wxt build -b safari --mv3",
  "zip:safari": "wxt zip -b safari --mv3",
  "dev:safari": "wxt -b safari --mv3 --mode production",
  "dev:safari:local": "wxt -b safari --mv3"
}
```

- Keep Chrome MV3 and Firefox's current target unchanged.
- Keep `dist/safari` as the generated web-resource directory.
- Assert `manifest_version: 3`, `background.service_worker`, `action.default_popup`, options, content scripts, and the SPA web-accessible resource in CI.
- Derive reserved popup commands from the selected manifest version. The existing Firefox/non-Firefox branch only works for Safari when explicitly building MV3.
- Safari manifest: remove `identity` and `notifications`; retain `storage`, website access, and desktop context-menu permission; add Safari-only `tabs` to observe its tracked login tab URL. Apply these changes only to the Safari manifest; Chrome/Firefox permissions remain unchanged.
- Add `browser_specific_settings.safari.strict_min_version` when the supported minimum is decided; align native deployment targets and generated JS/CSS compatibility with it.
- Do not add Chrome's public key or Firefox's Gecko settings to Safari. Existing manifest branches already exclude them.
- WXT's `webExt.disabled` means no automatic browser launch today. Start with production rebuild + manual Safari reload. Treat Safari HMR/CSP behavior as a later developer-experience check.
- Avoid a framework upgrade as a prerequisite: this installed WXT version already produces the needed artifact.

### Prevent startup exceptions

1. Move `identity.getRedirectURL()` out of module-level constants in both auth modules. Select the browser auth transport before accessing browser-specific APIs.
2. Make `ExtensionUpdateService.createProvider()` explicitly distinguish Chrome, Firefox, and Safari. Safari must never construct the Chrome provider.
3. Preserve desktop context-menu registration and behavior. Safari on macOS supports this API; no replacement creation workflow is required.
4. Keep browser listeners registered synchronously in the background entrypoint; run asynchronous restoration after registration.
5. Add a background-startup test with `identity`, `notifications`, `requestUpdateCheck`, and `onUpdateAvailable` absent, while retaining desktop context menus. Assert that local-note and status messages still receive replies.

Apple supports MV3 from Safari 15.4. MV3 keeps Safari close to the current Chrome background architecture; Firefox stays on its existing MV2 target. Test nonpersistent background recovery on macOS. See [Apple background guidance](https://developer.apple.com/documentation/safariservices/optimizing-your-web-extension-for-safari).

**Exit gate:** build succeeds and the background answers messages in actual Safari without logging in or granting every website permission.

## 4. Authentication: highest-risk implementation slice

### Preserve the existing security and account model

- `auth-bridge` remains the confidential OAuth client: ATProto PKCE, PAR, DPoP, client assertions, token exchange, and DID → PDS → issuer verification remain server-side.
- GitHub code exchange and authenticated provider identity lookup remain server-side.
- Mustard accounts remain opaque UUIDs. Keep JWT subject, linked identities, rotating Mustard refresh tokens, revocation, and logout behavior.
- Chrome/Firefox retain their current identity transport.
- No provider secret, private JWK, provider token, Mustard JWT, or refresh token in callback URLs or page messages.

References: [AT Protocol OAuth specification](https://atproto.com/specs/oauth), [GitHub OAuth authorization](https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/authorizing-oauth-apps), and the current repository auth skill and `specs/atproto-auth/`.

### Implemented transport: normal tab + extension-observed HTTPS callback

Apple recommends starting OAuth in a new tab when `identity` is unavailable. `TabOAuthLoginFlow` uses supported `tabs.create/update/onUpdated/onRemoved/get/remove` APIs. The fixed callback is `https://fettstorch.github.io/mustard/callback.html`.

1. Send the existing `initiate` payload: provider, Bluesky handle when applicable, and Safari's fixed HTTPS `redirect_uri`. The backend returns its existing `{ authUrl, state }` response.
2. Create a blank tab, persist its ID, state, request, current local account, and ten-minute expiry in `storage.session`, then navigate it to the authorization URL. This ordering avoids missing an immediate callback.
3. Synchronous startup listeners observe only that tab. Check the exact callback origin/path, returned state, code, and ATProto issuer before exchanging the callback. Another tab or path cannot complete this login.
4. The extension forwards the existing `callback` payload: provider, code, state, ATProto issuer, client version, and the existing optional linking JWT. Backend token exchange, PKCE/DPoP, identity verification, linking, and database state handling remain unchanged.
5. Persist the returned session through the shared session/identity handling, clear pending tab state, and close the owned tab. Popup/options show pending/cancel/retry status.

**Recovery:** session storage survives background suspension. Startup and `GET_OAUTH_LOGIN_STATUS` reconcile the saved tab URL. The UI checks status only while mounted. Closing/cancelling the tab, expiry, logout, disconnect, or a changed local account prevents stale completion; only one tab login runs at once. A browser restart clears pending session storage. An interrupted exchange requires a fresh login because its provider code may already have been consumed.

The callback page remains static, with no script, third-party requests, credentials, or backend access. Its referrer policy is `no-referrer`; its CSP allows only same-origin styles and images. The OAuth query stays intact for tab observation. Mustard JWTs and refresh tokens are returned to the extension, never placed in the callback URL.

**No new authentication protocol or database schema is required.** The only backend change is explicit Safari GitHub credential selection for the fixed callback.

Sources: [Apple browser compatibility](https://developer.apple.com/documentation/safariservices/assessing-your-safari-web-extension-s-browser-compatibility?changes=_1_2&language=objc), [MDN tab URL permissions](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/tabs), [MDN tab update events](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/tabs/onUpdated).

### Hosting and provider registration

- `docs/callback.html` is a static status page hosted on GitHub Pages; all callback exchange happens in the extension.
- Verify deployed HTML MIME type, HTTPS, CSP/referrer policy, and both providers' redirects before live Safari acceptance. Hosted Supabase Edge Functions on the standard domain rewrite HTML responses to plain text; do not assume they can serve the callback UI. [Supabase routing documentation](https://supabase.com/docs/guides/functions/http-methods)
- The exact Safari callback is published in ATProto production/test metadata alongside the existing Chrome/Firefox redirects and confidential-client keys. Keep old request/response contracts working; the tab transport is explicitly selected on the existing actions.
- GitHub changed on **2026-08-14**: OAuth apps can now register up to **10 callback URIs**. Mustard uses an isolated Safari app to preserve existing Chrome/Firefox settings; separate registration is an isolation choice, not an API requirement. [GitHub announcement](https://github.blog/changelog/2026-08-14-multiple-redirect-uris-and-token-refresh-for-oauth-apps/)
- Inspect GitHub registration token-expiry settings. New OAuth apps now default to expiring tokens; the current backend treats GitHub tokens as classic long-lived tokens. Either retain a compatible setting for this slice or separately implement/test GitHub refresh before relying on an expiring-token registration. Do not accidentally change existing users' token policy.
- Native authentication is a fallback investigation only. It adds app lifecycle and messaging work; a native messaging handler is not automatically an interactive auth presentation surface. Validate those boundaries before choosing it. [Apple native messaging](https://developer.apple.com/documentation/safariservices/messaging-between-the-app-and-javascript-in-a-safari-web-extension)

**Exit gate:** both providers pass login, linking, cancellation, logout, account switch, replay rejection, and interruption recovery on the oldest supported Safari and a current release. Confirm the same UUID is retained when linking.

## 5. Permissions, content scripts, and storage

### Website access is part of onboarding

- Explain the two steps: enable Mustard, then grant access to desired websites.
- Keep broad website access justified by automatic annotations on arbitrary pages. `activeTab` alone cannot provide automatic notes on every later visit.
- Support per-site use. Distinguish no site permission, inaccessible/restricted page, content script not yet loaded, and no notes found.
- Provide a visible retry/reload route after permission changes. Do not swallow a missing content-script response and leave the user with an inert creation action.
- Test Ask/Allow/Deny, temporary grants expiring, revoke/regrant, pre-existing tabs, private browsing enablement, and Safari profiles.
- Check access to backend and media domains as well as the visible page. Make failures actionable without requiring users to grant unrelated sites.
- Safari ignores `file:` host permissions; do not promise local-file annotation. Browser settings pages are also outside the normal annotation flow.

Source: [Apple permission management](https://developer.apple.com/documentation/safariservices/managing-safari-web-extension-permissions).

### Injection and rendering checks

- Test the real `url-change-detector.js` injection on strict-CSP sites; a packaged web-accessible resource is necessary but does not prove every injection succeeds.
- Preserve URL normalization and existing site strategies. Verify pushState, replaceState, back/forward, hash navigation where relevant, and back-forward-cache restoration.
- Verify notes detach from the old page and re-anchor on navigation without duplicates.
- Test selector/position fallbacks, page zoom, scrolling, web fonts falling back, dark/light themes, and images blocked by host policy.
- Keep external preview fetching in the background. Existing bounded thumbnail generation may fall back to text-only cards; this must not prevent saving or publishing a note.
- Exercise Giphy, pasted images, mentions, links, and Tiptap editing in Safari. Never assume a successful Vue build proves editor/selection compatibility.

### Storage and lifetime

- Safari 16.4+ supports `storage.session`; the proposed 18.4 baseline covers the current direct calls. Supporting older Safari would require a deliberate cache adapter and separate tests.
- Local notes use keys containing `browser.runtime.id`. Verify ID/key continuity for signed Safari upgrades and stable bundle identifiers. Preserve Chrome/Firefox storage keys and formats. If Safari needs a different namespace, isolate it in its storage-key policy and test Safari migration separately; do not migrate established browsers to enable Safari.
- Handle quota/storage errors visibly. A failed write must not report that a local note was saved. Keep a recoverable draft and avoid clearing unrelated notes or sessions.
- Local notes remain local to that browser installation. Signing into the same account does not migrate Chrome/Firefox drafts or provide synchronization between Mac installations.
- Test background restart with persisted sessions, minimum-version state, pending note focus, unread IDs, and remote-index invalidation. Caches and in-flight Promises may disappear without corrupting durable state.
- Use durable pending-operation state for OAuth; use alarms only if a real wake-up requirement is demonstrated. Do not replace every short UI timer or debounce with alarms.

**Exit gate:** anonymous local notes survive normal restarts and upgrades; signed-in reads recover after suspension; permission failures have clear recovery.

## 6. Safari updates and optional browser features

### Use the existing unified update service

- Add a Safari provider with a safe no-op subscription; it must never call Chrome update APIs.
- App Store updates update the containing app/extension. `runtime.reload()` does not download an App Store update.
- Keep `MinimumVersionCriterion`, required-update status, optional patch preference, and remote-write protection in the existing service. Do not introduce a second Safari-only banner or guard.
- Until an App Store listing exists, required updates show only “You must update Mustard to keep using it.” in the popup and persistent page toast. Local notes remain usable. No install action or preview-limitation banner is shown.
- Optional “new version available” detection needs **Safari-distributed version metadata**. Do not use Chrome Web Store, AMO, or a GitHub tag as proof that Apple has released that version.
- The provider returns `unavailable` with the installed version. The shared service applies the backend minimum; optional unavailability stays silent. Store discovery is deferred in [follow-ups](safari/follow-ups.md).
- If release channels have different versions, add an optional Safari-specific minimum while preserving the existing global field and its Chrome/Firefox semantics, or keep the global minimum below every supported distributed version. An Apple review delay must not lock Safari users out with no update available.
- Test required updates overriding the patch preference, read-only remote writes, continued local-note access, offline behavior, and recognizing the newly installed version on next startup.

### Capability-specific UI

- Keep native notification runtime guards; omit unsupported manifest permission and disable/hide the OS notification setting for Safari. Preserve all in-app notification behavior.
- Replace options-page non-Firefox sniffing with explicit WXT browser target selection. Never show `chrome://extensions/shortcuts` or Firefox Add-ons Manager instructions in Safari.
- Read actual `commands.getAll()` bindings. Test Mac Option-key collisions and command dispatch manually; provide visible alternatives for every command.
- Keep the existing action/browserAction compatibility helper. Preserve the existing badge behavior and validate it on macOS Safari.

Source: [Apple distribution and update model](https://developer.apple.com/documentation/safariservices/distributing-your-safari-web-extension) and runtime compatibility data in section 2.

## 7. Browser abstractions and compatibility contracts

### Boundary: shared feature logic → interface → browser implementation

Target selection lives in `src/background/platform/createBrowserPlatform.ts`. Select implementations with WXT build-time constants; use runtime capability checks inside implementations where API presence depends on installation or permissions. Factory imports and constructors must not access unsupported APIs at module load.

Keep this layer limited to real differences. Supported storage, messaging, content scripts, Vue rendering, and desktop context menus do not need a new wrapper merely because Safari is being added. Keep existing domain DTOs, message names, note interactions, and session persistence.

| System / interface                                 | Chrome implementation                                          | Firefox implementation                                             | macOS Safari implementation                              | Shared owner                                                                              |
| -------------------------------------------------- | -------------------------------------------------------------- | ------------------------------------------------------------------ | -------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| `OAuthLoginFlow` (new)                             | Existing identity flow, same redirects and backend actions     | Existing identity flow, same redirects and backend actions         | Tab flow from section 4                                  | Provider-facing login functions and session orchestration                                 |
| `ExtensionUpdateProvider` (existing)               | Keep requestUpdateCheck, downloaded-event and reload semantics | Keep AMO lookup, manual instructions and downloaded-event handling | Store check unavailable; shared minimum-version notice   | `ExtensionUpdateService` and `MinimumVersionCriterion`                                    |
| `NativeNotificationDelivery` (new narrow boundary) | Existing notification API delivery                             | Existing delivery, including Firefox staggering                    | Explicitly unsupported implementation                    | Existing unread fetching, preference, deduplication, acknowledgement and deep-link policy |
| `BrowserSettingsHelp` (new data contract)          | Existing actionable shortcut-settings URL                      | Existing manual Firefox instructions                               | Safari-specific instructions, no fabricated settings URL | Options UI                                                                                |
| Toolbar action helper (existing)                   | `browser.action`                                               | `browser.browserAction` for current MV2                            | `browser.action`                                         | Badge logic; reuse existing helper                                                        |

No Safari limitation should disable a working Chrome/Firefox feature. Unsupported is a capability outcome, not a successful operation or an empty data result.

### Authentication contract

The shared contract now returns either `OAuthSessionResult` or `{ pending: true }`. `IdentityOAuthLoginFlow` still returns a completed session; its browser API calls, callback payloads, and provider wrapper persistence remain unchanged. Safari uses optional lifecycle hooks:

```ts
interface OAuthLoginFlow {
  start(request: OAuthLoginRequest): Promise<OAuthSessionResult | PendingLogin>
  initialize?(complete: (result: OAuthSessionResult) => Promise<void>): void
  getStatus?(): Promise<OAuthLoginStatus>
  cancel?(): Promise<void>
}
```

`background.ts` owns one instance. It registers Safari listeners synchronously and supplies the shared session completion callback. `GET_OAUTH_LOGIN_STATUS` returns only idle/pending/failure, and `CANCEL_OAUTH_LOGIN` clears the single pending operation. Credentials are never added to these UI DTOs. Provider wrappers distinguish pending results before persisting or reporting successful login.

Production selection depends on WXT's browser target. `VITE_E2E_TAB_LOGIN=true` selects the same tab implementation **only in WXT mode `e2e`**, allowing the standard Playwright Chromium extension fixture to test it. The flag cannot change production Chrome/Firefox builds.

### Updates: extend the existing interface

`ExtensionUpdateProvider` already defines `check(currentVersion)`, `perform(action)`, and `subscribe(listener)`. Reuse it; do not replace the two existing providers or duplicate the coordinator.

- Add Safari selection and provider in isolation. Preserve existing Chrome/Firefox state transitions, cache TTLs, retry behavior, patch filtering, mandatory-update override, and write guards.
- `unavailable` represents the absent store check without an action or explanatory message. Existing Chrome/Firefox states remain unchanged. Safari displays the required-update notice when the shared service marks it required.
- UI renders supported actions from the result; it does not infer “download then reload” from the browser name.
- Test every existing provider against the same coordinator contract. Mocked Safari success must not mask a failing Chrome event subscription or Firefox manual update path.

### Notifications: keep policy, abstract delivery

`createNativeNotifications()` already owns unread selection, first-run seeding, deduplication, preferences, and deep links. Preserve that logic and inject only the delivery boundary:

```ts
interface NativeNotificationDelivery {
  readonly supported: boolean
  readonly createSpacingMs: number
  create(id: string, payload: NativeNotificationPayload): Promise<void>
  clear(id: string): Promise<void>
  onClicked(listener: (id: string) => void): () => void
}
```

`NativeNotificationPayload` carries title/message; `WebExtensionNotificationDelivery` owns the existing inlined icon. The adapter supplies `createSpacingMs` (Firefox 500 ms, Chrome 0); the shared dispatch loop spaces attempts within each batch, including after a failure, exactly as before. Successful delivery alone advances notification bookkeeping; real API errors stay visible/retryable. Safari's unsupported implementation registers no listeners, returns a no-op disposer, and rejects accidental delivery calls with an unsupported error. The dispatcher checks support before fetching/seeding/delivering, preserving today's early-return behavior. It must not acknowledge unread rows or pretend a toast was shown.

Expose the same support result to options so the setting matches runtime behavior. Keep Chrome/Firefox preferences and stored notification IDs unchanged. In-app unread indicators remain available on all three browsers.

### Settings and capabilities

- `getShortcutSettingsHelp()` returns a discriminated `link` or `instructions` descriptor using WXT’s build target. The Firefox guide identifier selects the existing formatted UI instructions; Chrome keeps its settings link. Unimplemented targets return no help rather than falling back to Chrome. Add the verified Safari guide in its implementation slice.
- Use a pure shared target descriptor for static UI differences and a background status message for runtime-dependent capability results. The popup must not import background implementations or credential-bearing objects.
- Treat denied website access separately from a missing API. User permission can change; it is not a permanent build-time capability flag.
- Do not add a native notification bridge or replace the current login flow on Chrome/Firefox to obtain artificial parity with Safari.

**Exit gate:** extracting the interfaces leaves Chrome and Firefox observably unchanged; Safari differences live in their implementations and capability-driven UI.

## 8. Packaging, local development, and release

### Fast desktop testing

Safari **18.4+ on macOS** can load a built extension folder/ZIP through Settings → Developer → Add Temporary Extension. No Xcode project is needed for this first runtime pass. Temporary extensions expire after 24 hours or quitting Safari; native messaging and distribution still need an app project. [Apple running guide](https://developer.apple.com/documentation/safariservices/running-your-safari-web-extension), [WebKit 18.4 announcement](https://webkit.org/blog/16574/webkit-features-in-safari-18-4/)

### Native project

1. Build Safari web resources.
2. Generate a macOS-only project (`--macos-only`).
3. Choose stable, owned bundle identifiers and Apple team before signed beta builds. The audit's `dev.mustard.safariaudit` identifier was disposable and is not a release choice.
4. Keep the wrapper project under a dedicated directory such as `apple/`. Decide whether resources are referenced from `dist/safari` or explicitly copied during a build phase. Make the process reproducible; stale copied bundles must not ship.
5. Include containing-app/extension icons, enablement instructions, version/build numbers, support/privacy links, and only needed entitlements. Do not rebuild the note UI natively.
6. Verify unsigned native compilation separately from project generation, then signing, Mac installation, and archive/export.

Example commands for implementation, using the installed tools and a chosen bundle ID:

```sh
npm run build:safari
xcrun safari-web-extension-packager dist/safari \
  --project-location apple \
  --app-name Mustard \
  --bundle-identifier "$SAFARI_APP_BUNDLE_ID" \
  --macos-only --swift --no-open --no-prompt
```

The packager was formerly named `safari-web-extension-converter`. It creates an Xcode project; it does not prove the extension works or sign/publish it. By default it references source resources; `--copy-resources` changes that behavior. Preserve customized wrapper files when regenerating an existing project. [Apple packaging guide](https://developer.apple.com/documentation/safariservices/packaging-a-web-extension-for-safari)

### Distribution choices

| Route                                             | Role                           | Required evidence                                                                   |
| ------------------------------------------------- | ------------------------------ | ----------------------------------------------------------------------------------- |
| Temporary desktop install                         | Early development              | Core runtime smoke tests                                                            |
| Signed app / TestFlight                           | Beta on supported Macs         | Apple Developer membership, signing, app registration, install/update QA            |
| Mac App Store                                     | Recommended public route       | Store assets, privacy answers, review, app/extension version alignment              |
| Developer ID + notarization on macOS Safari 18.4+ | Optional desktop alternative   | Separate install/update ownership and support plan                                  |
| App Store Connect web packager                    | Optional packaging alternative | Verify availability/workflow in the account; does not remove runtime or review work |

- Confirm ownership of the developer account and identifiers, supported OS versions, release channels, and store assets before production setup.
- Review the app's real data flows for privacy disclosures: local notes, published content, provider identities, social features, and external media. Verify account deletion/support paths and existing license/attribution obligations for the selected distribution route.
- Keep signing keys, provisioning profiles, and store credentials out of the repository; restrict release CI to authorized runs.
- Publish backend/callback compatibility before the Safari client. Preserve Chrome/Firefox flows throughout rollout.
- On rollback, stop promotion of the Safari release and restore a reachable minimum-version policy; keep additive backend compatibility and users' local data. An App Store binary cannot be replaced instantly.

## 9. Implementation order and file ownership

Each row is a coherent implementation slice. Recheck the shared checkout before editing; this plan audits the currently applied update-service work as well as the common base.

| Order | Deliverable                                                  | Main files / proposed additions                                                                                   | Exit gate                                                                                              |
| ----- | ------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| 0     | Pass automated Chromium baseline; plan manual Firefox checks | Existing Chromium fixtures/live test, browser builds, local runner, and manual Firefox checklist                  | Chromium suites pass; manual Firefox checks are scheduled at compatibility checkpoints                 |
| 1     | Extract browser boundaries without behavior changes          | Auth modules, `native-notifications.ts`, platform composition/settings contracts; reuse update provider interface | Same Chrome/Firefox manifests, auth contracts, storage and observable behavior                         |
| 2     | Add startup-safe Safari MV3 and capabilities                 | `package.json`, `wxt.config.ts`, Safari implementations, `background.ts`, options                                 | Local messages work in actual macOS Safari; existing browsers still pass                               |
| 3     | Safari local notes and permission UX                         | Content entrypoint, popup/options; only demonstrated Safari rendering fixes                                       | Desktop creation, editing, revisit, revoke/regrant, restart; shared UI regressions checked             |
| 4     | Safari auth using existing backend flow                      | Safari tab flow, GitHub credential selection, static callback/metadata                                            | Both Safari providers work; archived Chrome/Firefox clients still authenticate against the new backend |
| 5     | Safari manual updates and notification availability          | Safari update provider, capability-driven UI                                                                      | Required updates actionable; existing update and native notification behavior retained                 |
| 6     | macOS package, signed beta, release                          | `apple/`, resource script, README, CI                                                                             | All three browser acceptance gates pass; signed Safari upgrade preserves data                          |

During implementation, update the cross-browser/auth skills and auth specs alongside behavior changes. Correct outdated setup instructions where touched. The initial boundary extraction adds no native project, Safari build target, or production configuration.

### Current implementation and rollout (2026-09-13)

- Browser boundaries, Safari MV3 build, tab login, website-access requests, and required-update UI are implemented. Existing Chrome/Firefox auth, notification, and update behavior stays behind the same interfaces.
- The static callback and both ATProto metadata files were published on `main` in `46ae60f`. Existing callbacks and keys were retained.
- Safari GitHub credentials are configured in Supabase. The approved `auth-bridge` deployment adds only exact Safari callback credential selection. Downloaded production source matched the reviewed source; live initiation selected the expected OAuth app and callback for all three browsers. No database migration or other function deployment was involved.
- The user confirmed the production Safari build, Bluesky login, and GitHub login work. This is manual confirmation, not automated Safari coverage or a complete release acceptance pass.
- Callback-page styling is committed in this lane and awaits the general merge; it was checked locally for layout, assets, CSP, and referrer behavior. It does not change the callback protocol.
- `dev:safari` remains unresolved: the popup fails to open and Safari reports background content as not loaded. Use `build:safari` and manual reload. No speculative CSP/reload workaround was added.

### Recorded verification

- On 2026-09-12, `npm run test:e2e:all` passed **77 tests**: 18 smoke, 49 authenticated, one real Chromium Bluesky login/logout, and nine tab-flow tests. `npm run check` passed **279 unit/integration tests**, all three builds, and Firefox validation (zero errors, eight existing warnings). Chrome/Firefox manifests matched the saved pre-extraction baselines.
- On 2026-09-13, all nine Chromium tab-flow E2E tests passed again. These use deterministic provider/backend responses; they do not perform live Safari OAuth.
- The local E2E minimum-version isolation and editor-removal wait are retained as explicitly accepted baseline fixes. They make regression checks reliable without changing production behavior.
- Supplemental tests cover unsupported Safari APIs, background reconstruction, expiry, interrupted exchanges, changed accounts, duplicate callbacks, and concurrent starts. Browser automation remains Chromium-only; Firefox and Safari runtime checks are manual.

### Remaining work

- Review and merge this lane, including callback styling. OAuth activation is already complete.
- Before public release, use the manual acceptance matrix below for broader Safari behavior and existing Firefox compatibility. Account linking reuses the unchanged backend; the Safari-specific check is that the current account session reaches the tab callback.
- Signed macOS packaging, data-preserving installation/upgrades, and public distribution are later release work. App Store update discovery remains deferred until publication; see [follow-ups](safari/follow-ups.md).

## 10. Verification matrix

### Primary gate: Chrome and Firefox must remain compatible

This gate applies to **every shared-code or backend slice**, not just final release. A failure blocks that slice. Fix it within its scope or revert the owned slice; do not waive it because Safari works.

| Protected behavior         | Baseline and regression proof                                                                                                                                                                                 |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Build/install identity     | Compare generated Chrome MV3 and Firefox MV2 manifests before/after: key, Gecko ID, permissions, CSP, commands, resources, popup/options and background type. Explain any intended difference explicitly      |
| Existing installed clients | Keep archived pre-change Chrome/Firefox artifacts; run login, linked-account actions, refresh, logout and remote read/write smoke tests against the candidate backend, alongside new builds                   |
| OAuth                      | Both providers on both browsers: same redirect URLs, existing initiate/callback payloads, cancellation behavior, account UUID, linking and session persistence. No Safari transaction fields become mandatory |
| Local data                 | Upgrade from the current artifact with local notes/preferences present; no changed keys, forced migration, data loss, or unnecessary logout                                                                   |
| Updates                    | Existing Chrome downloaded/reload flow; Firefox AMO/manual flow; patch preference; required-update override; offline/cache restoration; remote-write guard                                                    |
| Native notifications       | Existing first-run seed, deduplication, click acknowledgement/deep link, Firefox spacing and disabled preference still work                                                                                   |
| Core desktop UI            | Right-click and Alt-click creation, drag, hover actions, keyboard commands, popup/options, SPA navigation, media and strict-CSP sites                                                                         |
| Backend rollout            | Only Safari GitHub credential selection; existing request/response contracts, database schema, and Chrome/Firefox credentials remain unchanged; no new global minimum-version requirement                     |

- The implementation base is settled: the update-service changes are merged in `5647efb7d7c133f5bf0971550369f9b603308c75`. The CI and local evidence above was collected after that merge; address the local test setup and transition race before implementation.
- Firefox runtime acceptance is manual by explicit user choice. Build plus addons-linter do not replace those manual checks, but no Firefox automation harness is required.
- Keep Chrome/Firefox smoke coverage on their currently supported operating systems, including existing Windows shortcut behavior when shared commands/input code changes. Mac-only Safari scope does not narrow existing browser support.
- Keep Safari-specific manifest changes under its target branch. Do not globally remove permissions, change manifest versions, replace mouse interactions, rename storage keys, or reroute OAuth to make Safari pass.
- Extract one boundary at a time, validate existing behavior, then add its Safari implementation. Keep Safari additions removable without reverting Chrome/Firefox data formats or production auth registration.
- Backend validation must use both old and new client artifacts. Merely rebuilding Chrome/Firefox against new code misses backward-compatibility breaks.

### Automated checks

- Preserve `npm run check` and deterministic Chromium/local-Supabase suites. Require the Chromium live Bluesky test for shared auth/backend/browser-boundary changes, with manual Firefox acceptance recorded separately.
- Add Safari MV3 build + generated-manifest assertions to the Linux quality job.
- Add focused tests for absent optional APIs, Safari provider selection, manual required updates, permission-state messaging, storage errors, and auth transaction replay/cancellation/recovery.
- For backend auth: test wrong secret, wrong state/issuer, cross-provider confusion, expired/revoked linking session, duplicate completion, and retry after lost redemption response.
- Add a macOS job for native compilation once the project is stable. Keep signing/archive/upload in separately authorized release jobs.
- Playwright WebKit can test portable page/editor behavior but **cannot load this Safari extension**. Its documented extension support is Chromium-only; do not relabel WebKit page tests as Safari extension E2E. [Playwright extension support](https://playwright.dev/docs/chrome-extensions)

### Actual Safari acceptance

Run on the proposed oldest supported Safari and a current stable release on supported Macs. Record exact macOS/Safari versions, build hash, signed/temporary install type, and results.

| Scenario                                                        | macOS            | Expected outcome                                                       |
| --------------------------------------------------------------- | ---------------- | ---------------------------------------------------------------------- |
| Fresh install and enablement                                    | Required         | Clear instructions; no startup exceptions                              |
| Per-site grant, deny, expiry, revoke/regrant                    | Required         | Access state explained; recovery works                                 |
| Local note create/edit/delete, offline revisit                  | Required         | No login needed; no false save success                                 |
| Both providers login/link/unlink/logout                         | Required         | Stable account UUID and session behavior                               |
| Cancel auth, close popup, restart background, resume            | Required         | No stranded spinner, duplicate account, or lost result                 |
| Published notes, follow visibility, comments, mentions, reposts | Required         | Same semantics as current browsers                                     |
| SPA transitions and strict-CSP sites                            | Required         | Correct page notes; no duplicate overlays                              |
| Preview images, Giphy, pasted content                           | Required         | Supported media works; safe text fallback                              |
| Sleep/wake or lock/unlock and memory pressure                   | Required         | Messaging/session/cache recover                                        |
| Minimize, expand, anchor drag, editor                           | Mouse + keyboard | Every action reachable                                                 |
| Options, larger text, themes, accessibility                     | Required         | No clipped controls or focus traps                                     |
| Required update before/after installation                       | Required         | Required-update notice; writes unlock at supported version             |
| Signed upgrade, stable ID and local-note keys                   | Required         | No lost local notes or unnecessary logout                              |
| Profiles and private browsing                                   | Required         | Explicit enablement/access behavior; no accidental cross-account state |

### Definition of done

- [ ] Before Safari changes, the automated Chromium baseline passes, including real Bluesky login and existing deterministic suites; manual Firefox checks are recorded at compatibility checkpoints.
- [ ] Existing Chrome and Firefox builds **and already installed client artifacts** pass the primary compatibility gate against the candidate backend.
- [ ] Browser abstractions preserve existing implementations; Safari limitations are isolated.
- [ ] Safari MV3 builds reproducibly with reviewed manifest and Apple tooling warnings.
- [ ] Background starts when unsupported APIs are absent.
- [ ] Anonymous local notes and all core social features pass actual Safari QA.
- [ ] Bluesky/GitHub login and linking survive expected interruptions without weakening auth.
- [ ] Permissions, storage failures, unavailable features, and updates have accurate UI.
- [ ] Signed app upgrades preserve data; Apple release availability matches minimum-version policy.
- [ ] Chrome and Firefox checks remain green.
- [ ] macOS release is explicitly approved after Chrome, Firefox, and Safari acceptance passes.

## 11. Selected defaults and deferred decisions

| Decision                                  | Proposed default                               | What would change it                                                   |
| ----------------------------------------- | ---------------------------------------------- | ---------------------------------------------------------------------- |
| Launch platform                           | macOS Safari only                              | Fixed scope of this task                                               |
| Minimum version                           | Safari 18.4 on macOS                           | Mac/OS coverage, audience requirements, and measured compatibility     |
| OAuth transport                           | Normal tab + extension-observed HTTPS callback | Failed real-provider/Mac spike; evaluate native fallback with evidence |
| GitHub registration                       | Prefer isolated Safari app settings            | Verified additive reuse without changing existing client behavior      |
| Public distribution                       | App Store                                      | Explicit choice to own a separate notarized macOS update channel       |
| Optional Safari update notices            | Add only with reliable Safari release metadata | Available distribution-specific version source                         |
| Local draft migration from other browsers | Separate future feature                        | Explicit cross-browser draft migration requirement                     |

The desktop preview and both real-provider logins are working. Keep the remaining acceptance work distinct from missing implementation: signed upgrades and public distribution are not yet verified, and automated Safari extension coverage is not available through the chosen WXT/Playwright workflow.
