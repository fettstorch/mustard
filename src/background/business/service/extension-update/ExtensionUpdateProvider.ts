import type { ExtensionUpdateAction, ExtensionUpdateState } from '@/shared/extension-update'

export interface ExtensionUpdateProvider {
  check(currentVersion: string): Promise<ExtensionUpdateState>
  perform(action: ExtensionUpdateAction): Promise<void>
  subscribe(listener: (latestVersion: string) => void): () => void
}
