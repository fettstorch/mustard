export type ManualExtensionUpdateAction = {
  type: 'manual'
  instructions: string[]
}

export type ApplyExtensionUpdateAction = {
  type: 'apply'
  label: string
}

export type ExtensionUpdateAction = ManualExtensionUpdateAction | ApplyExtensionUpdateAction

export const INCLUDE_PATCH_UPDATES_KEY = 'mustard-include-patch-updates'

/** Browser-neutral state exposed by the background update coordinator. */
export type ExtensionUpdateState = {
  /** Required updates override the optional patch preference and keep remote writes read-only. */
  required?: boolean
  minimumVersion?: string
} &
  (
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
  )
