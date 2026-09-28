import type { MustardNoteAnchorData } from '@/shared/model/MustardNoteAnchorData'
import { resolveAnchoredElement, siteStrategyFor } from '@/shared/site-strategies'

const VIEWPORT_GUTTER = 8

export function calculateOverlayPositionStyle(
  position: { x: number; y: number },
  viewportWidth: number,
  growsLeft?: boolean,
) {
  const anchorX = Number.isFinite(position.x) ? position.x : VIEWPORT_GUTTER
  const x = Math.min(Math.max(anchorX, VIEWPORT_GUTTER), viewportWidth - VIEWPORT_GUTTER)
  const shouldGrowLeft = growsLeft ?? x > viewportWidth / 2
  const availableWidth = (shouldGrowLeft ? x : viewportWidth - x) - VIEWPORT_GUTTER

  return {
    top: `${Number.isFinite(position.y) ? position.y : VIEWPORT_GUTTER}px`,
    left: shouldGrowLeft ? 'auto' : `${x}px`,
    right: shouldGrowLeft ? `${viewportWidth - x}px` : 'auto',
    '--mustard-overlay-max-width': `${availableWidth}px`,
  }
}

/**
 * Viewport position for a note's anchor, or null when the note cannot be
 * placed on this page at all (a post-keyed note whose post isn't rendered
 * here) — callers hide such notes instead of misplacing them.
 */
export function calculateAnchorPosition(
  anchor: MustardNoteAnchorData,
): { x: number; y: number } | null {
  const element = resolveAnchoredElement(anchor)

  if (element) {
    const rect = element.getBoundingClientRect()
    // If element has zero dimensions, it's likely hidden/detached - fall back to clickPosition
    if (rect.width > 0 && rect.height > 0) {
      // Using fixed positioning, so use viewport-relative coordinates (no scrollY adjustment)
      return {
        x: rect.left + (rect.width * anchor.relativePosition.xP) / 100,
        y: rect.top + (rect.height * anchor.relativePosition.yP) / 100,
      }
    }
  }

  // The absolute click position belongs to the layout of the page the note
  // was created on. On the post's own page that layout is the current one, so
  // the fallback stays valid; on any OTHER surface rendering the post (feeds,
  // threads) it is meaningless — hide the note rather than scatter it.
  if (
    anchor.pageUrl.startsWith('at://') &&
    siteStrategyFor(window.location.href).getPageKey() !== anchor.pageUrl
  ) {
    return null
  }

  // Fallback to click position - convert from document coordinates to viewport coordinates
  return {
    x: (anchor.clickPosition.xVw / 100) * window.innerWidth,
    y: anchor.clickPosition.yPx - window.scrollY,
  }
}
