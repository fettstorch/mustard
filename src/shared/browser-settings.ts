type BrowserSettingsHelp =
  | { kind: 'link'; url: string }
  | { kind: 'instructions'; guide: 'firefox-shortcuts' | 'safari-shortcuts' }

/** UI-only descriptor. Browser APIs and background implementations stay out. */
export function getShortcutSettingsHelp(): BrowserSettingsHelp | undefined {
  switch (import.meta.env.BROWSER) {
    case 'chrome':
      return { kind: 'link', url: 'chrome://extensions/shortcuts' }
    case 'firefox':
      // Firefox blocks opening about:addons; render the existing manual guide.
      return { kind: 'instructions', guide: 'firefox-shortcuts' }
    case 'safari':
      return { kind: 'instructions', guide: 'safari-shortcuts' }
    default:
      return undefined
  }
}
