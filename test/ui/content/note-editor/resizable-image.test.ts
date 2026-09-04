import { describe, expect, it } from 'vitest'
import {
  parseImageWidth,
  serializeImageWidth,
} from '../../../../src/ui/content/note-editor/resizable-image'

describe('resizable image Markdown metadata', () => {
  it('round-trips a valid image width', () => {
    const title = serializeImageWidth(247.6)

    expect(title).toBe('mustard:image-width=248')
    expect(parseImageWidth(title)).toBe(248)
  })

  it('leaves ordinary and invalid image titles alone', () => {
    expect(parseImageWidth('An ordinary title')).toBeUndefined()
    expect(parseImageWidth('mustard:image-width=0')).toBeUndefined()
    expect(parseImageWidth('mustard:image-width=not-a-number')).toBeUndefined()
  })
})
