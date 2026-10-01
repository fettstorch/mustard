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

  it('includes every Unicode regional and subdivision flag, searchable by country or code', () => {
    expect(EMOJI_CATALOGUE.filter(({ names }) => names[0]?.startsWith('flag-')).length).toBe(262)
    expect(emojiForName('flag-us')).toBe('🇺🇸')
    expect(emojiForName('flag-germany')).toBe('🇩🇪')
    expect(emojiForName('flag-england')).toBe(
      '🏴\u{e0067}\u{e0062}\u{e0065}\u{e006e}\u{e0067}\u{e007f}',
    )
    expect(emojiMatches('flag').length).toBeGreaterThan(260)
  })

  it('includes the requested basics without bringing back the food catalogue', () => {
    for (const [name, emoji] of [
      ['alert', '⚠️'],
      ['worm', '🪱'],
      ['mending-heart', '❤️‍🩹'],
      ['salute', '🫡'],
      ['crossed-fingers', '🤞'],
      ['peeking', '🫣'],
      ['cyclone', '🌀'],
      ['shrug-man', '🤷‍♂️'],
      ['butterfly', '🦋'],
    ]) {
      expect(emojiForName(name)).toBe(emoji)
    }
    expect(emojiForName('pizza')).toBeUndefined()
  })
})
