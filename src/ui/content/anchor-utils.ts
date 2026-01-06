import type { MustardNoteAnchorData } from '@/shared/messaging'

export function calculateAnchorPosition(anchor: MustardNoteAnchorData): { x: number; y: number } {
  const element = findAnchorElement(anchor)

  if (element) {
    const rect = element.getBoundingClientRect()
    return {
      x: rect.left + (rect.width * anchor.relativePosition.xP) / 100,
      y: rect.top + (rect.height * anchor.relativePosition.yP) / 100 + window.scrollY,
    }
  }

  return {
    x: (anchor.clickPosition.xVw / 100) * window.innerWidth,
    y: anchor.clickPosition.yPx,
  }
}

//--- module private utility

function findAnchorElement(anchor: MustardNoteAnchorData): HTMLElement | null {
  if (anchor.elementId) {
    const el = document.getElementById(anchor.elementId)
    if (el) return el
  }

  if (anchor.elementSelector) {
    const el = document.querySelector<HTMLElement>(anchor.elementSelector)
    if (el) return el
  }

  return null
}
