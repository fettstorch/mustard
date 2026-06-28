import { computed, onMounted, ref } from 'vue'
import {
  createGetMutualsMessage,
  createGetGithubMentionCandidatesMessage,
  sendMessage,
} from '@/shared/messaging'
import type { MentionCandidate } from '@/shared/model/MentionCandidate'

/**
 * Loads the @-mention autocomplete candidates once on mount, merging two
 * provider-specific sources:
 *   - Bluesky mutuals (people the user follows who follow them back).
 *   - GitHub follows who are also Mustard users (so the mention can be rendered).
 *
 * Each source owns its own ref and the merged list is a `computed`, so the two
 * async responses never race over a shared array. Each provider keeps its own
 * identity space, so a person on both networks can appear twice (once per
 * network) — picking one decides which profile the mention links to. The
 * computed is read lazily by the suggestion on each keystroke.
 */
export function useMentionCandidates() {
  const bskyMutuals = ref<MentionCandidate[]>([])
  const githubFollows = ref<MentionCandidate[]>([])
  const candidates = computed<MentionCandidate[]>(() => [
    ...bskyMutuals.value,
    ...githubFollows.value,
  ])

  onMounted(() => {
    sendMessage(createGetMutualsMessage())
      .then((list) => {
        bskyMutuals.value = (list ?? []).map((p) => ({
          provider: 'atproto',
          accountId: p.id,
          handle: p.handle,
          displayName: p.displayName,
          avatarUrl: p.avatarUrl,
        }))
      })
      .catch(() => {})

    // Already enriched to MentionCandidate by the bridge — assign as-is.
    sendMessage(createGetGithubMentionCandidatesMessage())
      .then((list) => {
        githubFollows.value = list ?? []
      })
      .catch(() => {})
  })

  return { candidates }
}
