import type { ExtensionUpdateState } from '@/shared/extension-update'
import type { ExtensionUpdateProvider } from './ExtensionUpdateProvider'

type UpdateCheckResult = {
  status: 'throttled' | 'no_update' | 'update_available'
  version?: string
}

type UpdateRuntime = typeof browser.runtime & {
  requestUpdateCheck?: () => Promise<UpdateCheckResult>
}

export class ChromeExtensionUpdateProvider implements ExtensionUpdateProvider {
  async check(currentVersion: string): Promise<ExtensionUpdateState> {
    const runtime = browser.runtime as UpdateRuntime
    if (typeof runtime.requestUpdateCheck !== 'function') {
      return {
        status: 'failed',
        message: 'Chrome cannot check for extension updates in this installation.',
        retryable: false,
      }
    }

    try {
      const result = await runtime.requestUpdateCheck()
      if (result.status === 'no_update') return { status: 'current', currentVersion }
      if (result.status === 'throttled') {
        // Chrome has checked recently enough to reject another forced check.
        // Its normal updater and onUpdateAvailable listener remain active, so
        // throttling is not a user-facing failure.
        return { status: 'current', currentVersion }
      }

      return {
        status: 'downloading',
        currentVersion,
        latestVersion: result.version ?? currentVersion,
      }
    } catch {
      return {
        status: 'failed',
        message: 'Chrome could not check for a Mustard update.',
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
