# Desktop Safari follow-ups

## App Store update discovery — deferred until publication

Mustard does not yet have a published Mac App Store app. Do not query the store
or show optional-update notices for the current Safari build.

For now, retain the backend minimum-version check and existing remote-write
guard. When the installed version is too old, show the persistent page toast
“You must update Mustard to keep using it.” and the same message in the popup.
Local notes remain usable. Do not show missing-feature explanations or update
instructions that we cannot yet provide meaningfully.

After Mac App Store publication:

- Record Mustard's Mac app ID and listing URL. Keep the containing app's release
  version aligned with the extension manifest version.
- Implement store lookup in `SafariExtensionUpdateProvider` using Apple's public
  lookup API. Compare the published Mac app version with the installed version;
  reuse the existing update service and optional-update preferences.
- Offer a link to Mustard's App Store listing when a newer version is available.
  Installation remains managed by the App Store. Do not claim an update has been
  downloaded or can be applied through Safari's extension runtime.
- Validate the Mac-specific result and storefront availability. Cache lookups,
  handle empty/error responses as unknown availability, and keep backend
  minimum-version enforcement independent of lookup success.
- Verify from the actual Safari extension that the lookup succeeds with its
  granted permissions. Test current/newer versions, lookup failures, optional
  patch preferences, and a required minimum newer than the store release. Keep
  Chrome and Firefox behavior unchanged.

Research checked on 2026-09-13:

- Apple's [Search/Lookup API](https://developer.apple.com/library/archive/documentation/AudioVideo/Conceptual/iTuneSearchAPI/index.html)
  supports the Mac App Store. A live lookup for the Mac-only Noir Safari app
  returned `kind: "mac-software"` and a `version` field. This verifies the public
  endpoint, not Mustard's future listing or an in-extension Safari request.
- Apple's [query documentation](https://developer.apple.com/library/archive/documentation/AudioVideo/Conceptual/iTuneSearchAPI/Searching.html)
  describes storefront selection, `macSoftware`, caching, and rate limits.
- Safari lacks [`runtime.requestUpdateCheck`](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/runtime/requestUpdateCheck)
  and [`runtime.onUpdateAvailable`](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/runtime/onUpdateAvailable).
  Store metadata lookup is a separate capability.
