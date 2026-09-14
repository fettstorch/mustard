import type { ExtensionUpdateState } from '@/shared/extension-update'
import type { ExtensionUpdateProvider } from './ExtensionUpdateProvider'

export class SafariExtensionUpdateProvider implements ExtensionUpdateProvider {
  async check(currentVersion: string): Promise<ExtensionUpdateState> {
    return {
      status: 'unavailable',
      currentVersion,
    }
  }

  async perform(): Promise<void> {
    // No update action is available until Mustard has a published store listing.
  }

  subscribe(): () => void {
    // Safari does not expose runtime.onUpdateAvailable.
    return () => {}
  }
}
