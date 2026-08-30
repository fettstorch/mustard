import type { ExtensionUpdateState } from '@/shared/extension-update'

export interface ExtensionUpdateProvider {
  check(currentVersion: string): Promise<ExtensionUpdateState>
  apply(): void
  subscribe(listener: (latestVersion: string) => void): () => void
}
