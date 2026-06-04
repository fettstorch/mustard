/**
 * Data about where a mustard note is anchored on the page.
 *
 * Anchor resolution strategy:
 * 1. Try to find element using `elementSelector` (e.g., "#myId" or "div.class > span")
 * 2. If found and has dimensions, position using `relativePosition` (% within element)
 * 3. If not found or zero dimensions, fall back to `clickPosition` (absolute viewport position)
 *
 * Both position types are ALWAYS stored because we can't predict at storage time whether
 * the element will exist or have valid dimensions when the note is later rendered.
 * The `clickPosition` serves as a runtime fallback, not a storage-time decision.
 */
export type MustardNoteAnchorData = {
  pageUrl: string
  /** CSS selector to find the anchored element (e.g., "#myId" or "div > span:nth-child(2)") */
  elementSelector: string | null
  /** Position as percentage (0-100) relative to the anchored element's dimensions */
  relativePosition: {
    xP: number // 0-100 percentage relative to element
    yP: number // 0-100 percentage relative to element
  }
  /** Absolute position as fallback when element can't be found or has zero dimensions */
  clickPosition: {
    xVw: number // viewport width percentage (0-100)
    yPx: number // pixels from top (includes scroll offset)
  }
}
