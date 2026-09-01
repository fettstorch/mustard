export type ManualExtensionUpdateAction = {
  type: 'manual'
  instructions: string[]
}

export type ApplyExtensionUpdateAction = {
  type: 'apply'
  label: string
}

export type ExtensionUpdateAction = ManualExtensionUpdateAction | ApplyExtensionUpdateAction

/** Browser-neutral state exposed by the background update coordinator. */
export type ExtensionUpdateState =
  | { status: 'checking' }
  | { status: 'current'; currentVersion: string }
  | { status: 'downloading'; currentVersion: string; latestVersion: string }
  | {
      status: 'action-required'
      currentVersion: string
      latestVersion: string
      action: ManualExtensionUpdateAction
    }
  | {
      status: 'ready'
      currentVersion: string
      latestVersion: string
      action: ApplyExtensionUpdateAction
    }
  | { status: 'failed'; message: string; retryable: boolean }
