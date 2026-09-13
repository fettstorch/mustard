// Background-only contract: session credentials never cross into UI messages.
import type { OAuthLoginStatus, PendingLogin } from '@/shared/oauth-login'
export type OAuthLoginRequest = (
  | { provider: 'atproto'; handle: string }
  | { provider: 'github' }
) & { currentJwt?: string }

export type OAuthSessionResult = {
  userId: string
  jwt: string
  expiresAt: number
  refreshToken: string
  did?: string
}

export interface OAuthLoginFlow {
  start(request: OAuthLoginRequest): Promise<OAuthSessionResult | PendingLogin>
  initialize?(complete: (result: OAuthSessionResult) => Promise<void>): void
  getStatus?(): Promise<OAuthLoginStatus>
  cancel?(): Promise<boolean>
}
