import { describe, expect, it } from 'vitest'
import { calculateProfileCardPosition } from '@/ui/content/note/profile-card-position'

const card = { width: 220, height: 160 }
const viewport = { width: 800, height: 600 }

describe('calculateProfileCardPosition', () => {
  it('places the card below the avatar when it fits', () => {
    expect(
      calculateProfileCardPosition({
        anchor: { top: 100, bottom: 124, left: 100 },
        card,
        viewport,
      }),
    ).toEqual({ top: 130, left: 100 })
  })

  it('flips the card above an avatar near the bottom', () => {
    expect(
      calculateProfileCardPosition({
        anchor: { top: 550, bottom: 574, left: 100 },
        card,
        viewport,
      }),
    ).toEqual({ top: 384, left: 100 })
  })

  it('clamps the card inside a viewport that cannot fit either side', () => {
    expect(
      calculateProfileCardPosition({
        anchor: { top: 80, bottom: 104, left: 790 },
        card: { width: 220, height: 580 },
        viewport,
      }),
    ).toEqual({ top: 12, left: 572 })
  })
})
