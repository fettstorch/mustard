import type { ExtensionUpdateAction, ExtensionUpdateState } from '@/shared/extension-update'
import type { ExtensionUpdateProvider } from './ExtensionUpdateProvider'

export class SafariExtensionUpdateProvider implements ExtensionUpdateProvider {
  async check(currentVersion: string): Promise<ExtensionUpdateState> {
    return {
      status: 'unavailable',
      currentVersion,
      message: 'This Safari preview cannot check for updates automatically.',
      action: {
        type: 'manual',
        instructions: ['Install a newer Safari preview from the same source as this build.'],
      },
    }
  }

  async perform(_action: ExtensionUpdateAction): Promise<void> {
    // Installing a containing app/temporary extension is a manual operation.
  }

  subscribe(): () => void {
    // Safari does not expose runtime.onUpdateAvailable.
    return () => {}
  }
}
