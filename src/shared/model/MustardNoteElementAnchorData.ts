/**
 * Optional metadata for the element a note is anchored to.
 *
 * This augments MustardNoteAnchorData without replacing its positional
 * fallback, while allowing element-specific context as new element types are
 * added.
 */
export type ElementAnchorData = YoutubeVideoElementAnchorData

export type YoutubeVideoElementAnchorData = {
  type: 'video'
  /** Locator strategy used to identify the video element. */
  locator: 'youtube'
  /** Identifier interpreted by the locator strategy. */
  key: string
  /** Playback position at which the note was created, in seconds. */
  startAt: number
  /** Duration for which the note remains visible, in seconds. */
  duration: number
}
