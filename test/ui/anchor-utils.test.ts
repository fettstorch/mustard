import { describe, expect, it } from 'vitest'
import {
  calculateOverlayPositionStyle,
  clampOverlayAnchorX,
  rebaseOverlayDragOffset,
} from '@/ui/content/anchor-utils'

describe('calculateOverlayPositionStyle', () => {
  it('starts at the anchor on either side of the viewport midpoint', () => {
    const before = calculateOverlayPositionStyle({ x: 100, y: 50 }, 600)
    const after = calculateOverlayPositionStyle({ x: 420, y: 50 }, 600)

    expect(before).toMatchObject({ left: '100px', right: 'auto' })
    expect(after).toMatchObject({ left: '420px', right: 'auto' })
    expect(after['--mustard-overlay-max-width']).toBe('172px')
  })

  it('keeps a left-anchored note grabbable at the right gutter', () => {
    expect(calculateOverlayPositionStyle({ x: 592, y: 50 }, 600)).toMatchObject({
      left: '512px',
      right: 'auto',
      '--mustard-overlay-max-width': '80px',
    })
  })

  it('provides the clamped anchor used to rebase stored drag offsets', () => {
    expect(clampOverlayAnchorX(-40, 600)).toBe(8)
    expect(clampOverlayAnchorX(640, 600)).toBe(512)
  })

  it('rebases a stored drag offset against the current viewport', () => {
    expect(rebaseOverlayDragOffset(500, { x: -460, y: 24 }, 600)).toEqual({
      x: -460,
      y: 24,
    })
    expect(rebaseOverlayDragOffset(100, { x: 460, y: -12 }, 600)).toEqual({
      x: 412,
      y: -12,
    })
  })

  it('rebases an initially off-screen anchor before the first drag', () => {
    expect(rebaseOverlayDragOffset(700, { x: 0, y: 0 }, 600)).toEqual({
      x: -188,
      y: 0,
    })
  })
})
