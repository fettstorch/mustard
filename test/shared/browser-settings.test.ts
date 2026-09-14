import { afterEach, describe, expect, it, vi } from 'vitest'
import { getShortcutSettingsHelp } from '@/shared/browser-settings'

describe('browser shortcut settings', () => {
  afterEach(() => vi.unstubAllEnvs())

  it('keeps the Chrome settings link', () => {
    vi.stubEnv('BROWSER', 'chrome')
    expect(getShortcutSettingsHelp()).toEqual({
      kind: 'link',
      url: 'chrome://extensions/shortcuts',
    })
  })

  it('keeps Firefox manual navigation', () => {
    vi.stubEnv('BROWSER', 'firefox')
    expect(getShortcutSettingsHelp()).toEqual({ kind: 'instructions', guide: 'firefox-shortcuts' })
  })

  it('selects Safari guidance without a fabricated settings link', () => {
    vi.stubEnv('BROWSER', 'safari')
    expect(getShortcutSettingsHelp()).toEqual({ kind: 'instructions', guide: 'safari-shortcuts' })
  })

  it('does not give unknown targets Chrome settings', () => {
    vi.stubEnv('BROWSER', 'unknown')
    expect(getShortcutSettingsHelp()).toBeUndefined()
  })
})
