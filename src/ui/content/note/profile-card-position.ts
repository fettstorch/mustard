type ProfileCardPositionInput = {
  anchor: { top: number; bottom: number; left: number }
  card: { width: number; height: number }
  viewport: { width: number; height: number }
}

const GAP = 6
export const PROFILE_CARD_VIEWPORT_MARGIN = 8

export function calculateProfileCardPosition({
  anchor,
  card,
  viewport,
}: ProfileCardPositionInput): { top: number; left: number } {
  const below = anchor.bottom + GAP
  const above = anchor.top - card.height - GAP
  const maxTop = Math.max(
    PROFILE_CARD_VIEWPORT_MARGIN,
    viewport.height - card.height - PROFILE_CARD_VIEWPORT_MARGIN,
  )

  return {
    top:
      below + card.height <= viewport.height - PROFILE_CARD_VIEWPORT_MARGIN
        ? below
        : above >= PROFILE_CARD_VIEWPORT_MARGIN
          ? above
          : Math.min(Math.max(PROFILE_CARD_VIEWPORT_MARGIN, below), maxTop),
    left: Math.max(
      PROFILE_CARD_VIEWPORT_MARGIN,
      Math.min(anchor.left, viewport.width - card.width - PROFILE_CARD_VIEWPORT_MARGIN),
    ),
  }
}
