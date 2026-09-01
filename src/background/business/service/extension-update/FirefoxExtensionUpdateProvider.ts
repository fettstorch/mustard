import type { ExtensionUpdateAction, ExtensionUpdateState } from '@/shared/extension-update'
import { isOutdated } from '@/shared/version'
import type { ExtensionUpdateProvider } from './ExtensionUpdateProvider'

const AMO_ADDON_URL = 'https://addons.mozilla.org/api/v5/addons/addon/mustard-notes/'
type AmoAddon = {
  current_version?: {
    version?: string
  } | null
}

export class FirefoxExtensionUpdateProvider implements ExtensionUpdateProvider {
  async check(currentVersion: string): Promise<ExtensionUpdateState> {
    try {
      const response = await fetch(AMO_ADDON_URL, {
        headers: { Accept: 'application/json' },
        credentials: 'omit',
      })
      if (!response.ok) throw new Error(`AMO returned ${response.status}`)

      const addon = (await response.json()) as AmoAddon
      const latestVersion = addon.current_version?.version
      if (!latestVersion) throw new Error('AMO did not return a current version')
      if (!isOutdated(currentVersion, latestVersion)) {
        return { status: 'current', currentVersion }
      }

      return {
        status: 'action-required',
        currentVersion,
        latestVersion,
        action: {
          type: 'manual',
          instructions: [
            'Open about:addons in Firefox.',
            'Open the gear menu and select “Check for Updates”.',
            'Firefox will download the update and apply it automatically when Mustard restarts.',
          ],
        },
      }
    } catch {
      return {
        status: 'failed',
        message: 'Firefox could not check AMO for a Mustard update.',
        retryable: true,
      }
    }
  }

  async perform(action: ExtensionUpdateAction): Promise<void> {
    if (action.type === 'apply') {
      browser.runtime.reload()
      return
    }
    // Firefox blocks extensions from opening about:addons, and its WebExtension
    // API has no method for requesting an add-on update. The popup therefore
    // presents the supported manual steps without a misleading action button.
  }

  subscribe(listener: (latestVersion: string) => void): () => void {
    if (!browser.runtime.onUpdateAvailable) return () => {}

    const onUpdateAvailable = (details: { version: string }) => listener(details.version)
    browser.runtime.onUpdateAvailable.addListener(onUpdateAvailable)
    return () => browser.runtime.onUpdateAvailable.removeListener(onUpdateAvailable)
  }
}
