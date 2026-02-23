import type { MustardNoteAnchorData } from '@/shared/messaging'

export function calculateAnchorPosition(anchor: MustardNoteAnchorData): { x: number; y: number } {
  const element = findAnchorElement(anchor)

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

  // Fallback to click position - convert from document coordinates to viewport coordinates
  return {
    x: (anchor.clickPosition.xVw / 100) * window.innerWidth,
    y: anchor.clickPosition.yPx - window.scrollY,
  }
}

//--- module private utility

function findAnchorElement(anchor: MustardNoteAnchorData): HTMLElement | null {
  if (anchor.elementSelector) {
    const el = document.querySelector<HTMLElement>(anchor.elementSelector)
    if (el) return el
  }

  return null
}
