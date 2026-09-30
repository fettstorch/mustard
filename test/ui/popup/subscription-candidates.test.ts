import { describe, expect, it } from 'vitest'
import type { MentionCandidate } from '@/shared/model/MentionCandidate'
import { filterSubscriptionCandidates } from '@/ui/popup/subscription-candidates'

const candidates: MentionCandidate[] = [
  {
    provider: 'atproto',
    accountId: 'did:plc:mustard',
    handle: 'mustard.bsky.social',
    displayName: 'Mustard User',
  },
  {
    provider: 'atproto',
    accountId: 'did:plc:outsider',
    handle: 'outsider.bsky.social',
    displayName: 'Not on Mustard',
  },
  {
    provider: 'github',
    accountId: '42',
    handle: 'mustard-user',
    displayName: 'mustard-user',
  },
]

describe('filterSubscriptionCandidates', () => {
  it('keeps only identities that resolve to a Mustard account', () => {
    expect(
      filterSubscriptionCandidates(candidates, {
        'atproto:did:plc:mustard': 'user-1',
        'github:42': 'user-2',
      }),
    ).toEqual([candidates[0], candidates[2]])
  })

  it('shows a linked Mustard account only once', () => {
    expect(
      filterSubscriptionCandidates(candidates, {
        'atproto:did:plc:mustard': 'user-1',
        'github:42': 'user-1',
      }),
    ).toEqual([candidates[0]])
  })
})
