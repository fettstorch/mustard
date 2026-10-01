import { describe, expect, it } from 'vitest'
import { EMOJI_CATALOGUE, emojiForName, emojiMatches } from '@/shared/emoji'

describe('emoji shortcodes', () => {
  it('uses kebab-case names throughout the catalogue', () => {
    expect(EMOJI_CATALOGUE.length).toBeGreaterThan(100)
    const names = EMOJI_CATALOGUE.flatMap((entry) => entry.names)
    expect(names.every((name) => /^[a-z]+(?:-[a-z]+)*$/.test(name))).toBe(true)
    expect(new Set(names).size).toBe(names.length)
    expect(new Set(EMOJI_CATALOGUE.map((entry) => entry.emoji)).size).toBe(EMOJI_CATALOGUE.length)
  })

  it('finds related emojis by partial name', () => {
    expect(emojiMatches('thumbs').map((entry) => entry.emoji)).toEqual(['👍', '👎'])
    expect(emojiMatches('HEART').some((entry) => entry.emoji === '💔')).toBe(true)
    expect(emojiMatches('thumbs-up').map((entry) => entry.emoji)).toEqual(['👍'])
    expect(emojiForName('plus-one')).toBe('👍')
  })

  it('finds each monkey through its visible name or monkey alias without duplicate results', () => {
    expect(emojiMatches('monkey').map((entry) => entry.emoji)).toEqual(['🙈', '🙉', '🙊', '🐵'])
    expect(emojiForName('see-no-evil')).toBe('🙈')
    expect(emojiForName('monkey-see-no-evil')).toBe('🙈')
    expect(emojiMatches('blush').map((entry) => entry.emoji)).toEqual(['😊'])
  })
})
