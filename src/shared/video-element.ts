/** Generic HTML video-element detection for content-script DOM targets. */
export function isVideoElement(element: Element | null): element is HTMLVideoElement {
  return element instanceof HTMLVideoElement
}
