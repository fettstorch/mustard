import { describe, expect, it } from 'vitest'
import { calculateOverlayPositionStyle } from '@/ui/content/anchor-utils'

describe('calculateOverlayPositionStyle', () => {
  it('keeps the positioning edge stable when a dragged note crosses the midpoint', () => {
    const before = calculateOverlayPositionStyle({ x: 100, y: 50 }, 600, false)
    const after = calculateOverlayPositionStyle({ x: 420, y: 50 }, 600, false)

    expect(before).toMatchObject({ left: '100px', right: 'auto' })
    expect(after).toMatchObject({ left: '420px', right: 'auto' })
  })

  it('still chooses the roomier side when no fixed edge is supplied', () => {
    expect(calculateOverlayPositionStyle({ x: 420, y: 50 }, 600)).toMatchObject({
      left: 'auto',
      right: '180px',
    })
  })

  it('keeps a right-anchored note grabbable at the left gutter', () => {
    expect(calculateOverlayPositionStyle({ x: 8, y: 50 }, 600, true)).toMatchObject({
      left: 'auto',
      right: '512px',
      '--mustard-overlay-max-width': '80px',
    })
  })

  it('keeps a left-anchored note grabbable at the right gutter', () => {
    expect(calculateOverlayPositionStyle({ x: 592, y: 50 }, 600, false)).toMatchObject({
      left: '512px',
      right: 'auto',
      '--mustard-overlay-max-width': '80px',
    })
  })
})
