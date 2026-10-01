import { describe, expect, it } from 'vitest'
import { EMOJI, EMOJI_NAMES, emojiMatches } from '@/shared/emoji'

describe('emoji shortcodes', () => {
  it('uses kebab-case names throughout the catalogue', () => {
    expect(EMOJI_NAMES.length).toBeGreaterThan(100)
    expect(EMOJI_NAMES.every((name) => /^[a-z]+(?:-[a-z]+)*$/.test(name))).toBe(true)
  })

  it('finds related emojis by partial name', () => {
    expect(emojiMatches('thumbs')).toEqual(['thumbs-up', 'thumbs-down'])
    expect(emojiMatches('HEART')).toContain('broken-heart')
    expect(emojiMatches('thumbs-up')).toEqual(['thumbs-up'])
    expect(EMOJI['thumbs-up']).toBe('👍')
  })
})
