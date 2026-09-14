// The E2E-only override exercises the same transport in Playwright Chromium.
export function usesTabLogin(): boolean {
  return (
    import.meta.env.BROWSER === 'safari' ||
    (import.meta.env.MODE === 'e2e' && import.meta.env.VITE_E2E_TAB_LOGIN === 'true')
  )
}

/** Build-time differences only; website grants remain a runtime permission. */
export function getBrowserCapabilities() {
  const safari = import.meta.env.BROWSER === 'safari'
  return { nativeNotifications: !safari }
}
