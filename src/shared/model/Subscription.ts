import type { UserProfileType } from './UserProfile'

export type PageSubscription = {
  id: string
  kind: 'page'
  pageKey: string
  createdAt: number
}

export type UserSubscription = {
  id: string
  kind: 'user'
  targetUserId: string
  createdAt: number
}

export type Subscription = PageSubscription | UserSubscription

export type SubscriptionIdentityTarget = {
  provider: UserProfileType
  accountId: string
}

export type ResolvedSubscriptionIdentities = Record<string, string>

export function subscriptionIdentityKey(target: SubscriptionIdentityTarget): string {
  return `${target.provider}:${target.accountId}`
}

export function isPageSubscriptionSupported(pageKey: string): boolean {
  return pageKey.length > 0 && !pageKey.startsWith('at://')
}
