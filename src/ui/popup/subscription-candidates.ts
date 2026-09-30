import type { MentionCandidate } from '@/shared/model/MentionCandidate'
import {
  subscriptionIdentityKey,
  type ResolvedSubscriptionIdentities,
} from '@/shared/model/Subscription'

export function filterSubscriptionCandidates(
  candidates: MentionCandidate[],
  resolvedIdentities: ResolvedSubscriptionIdentities,
): MentionCandidate[] {
  const seenUserIds = new Set<string>()
  return candidates.filter((candidate) => {
    const userId = resolvedIdentities[subscriptionIdentityKey(candidate)]
    if (!userId || seenUserIds.has(userId)) return false
    seenUserIds.add(userId)
    return true
  })
}
