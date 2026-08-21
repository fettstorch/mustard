// @vitest-environment jsdom

import { describe, expect, it } from 'vitest'
import { isVideoElement } from '../../src/shared/video-element'

describe('isVideoElement', () => {
  it('recognizes an HTML video element', () => {
    expect(isVideoElement(document.createElement('video'))).toBe(true)
  })

  it('rejects non-video elements and null', () => {
    expect(isVideoElement(document.createElement('div'))).toBe(false)
    expect(isVideoElement(null)).toBe(false)
  })
})
