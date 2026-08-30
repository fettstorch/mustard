import type { ExtensionUpdateState } from '@/shared/extension-update'
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
          label: 'How to update',
          instructions: [
            'Open Firefox’s Add-ons Manager.',
            'Open the gear menu and select “Check for Updates”.',
            'Return to Mustard after Firefox downloads the update.',
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

  apply(): void {
    browser.runtime.reload()
  }

  subscribe(listener: (latestVersion: string) => void): () => void {
    const onUpdateAvailable = (details: { version: string }) => listener(details.version)
    browser.runtime.onUpdateAvailable.addListener(onUpdateAvailable)
    return () => browser.runtime.onUpdateAvailable.removeListener(onUpdateAvailable)
  }
}
