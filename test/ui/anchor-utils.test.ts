import { describe, expect, it } from 'vitest'
import {
  calculateOverlayPositionStyle,
  clampOverlayAnchorX,
  rebaseOverlayDragOffset,
} from '@/ui/content/anchor-utils'

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

  it('provides the clamped anchor used to rebase stored drag offsets', () => {
    expect(clampOverlayAnchorX(-40, 600, true)).toBe(88)
    expect(clampOverlayAnchorX(640, 600, false)).toBe(512)
  })

  it('rebases a stored drag offset against the current viewport', () => {
    expect(rebaseOverlayDragOffset(500, { x: -460, y: 24 }, 600, true)).toEqual({
      x: -412,
      y: 24,
    })
    expect(rebaseOverlayDragOffset(100, { x: 460, y: -12 }, 600, false)).toEqual({
      x: 412,
      y: -12,
    })
  })

  it('rebases an initially off-screen anchor before the first drag', () => {
    expect(rebaseOverlayDragOffset(700, { x: 0, y: 0 }, 600, true)).toEqual({
      x: -108,
      y: 0,
    })
  })
})
