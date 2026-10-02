import emojiRegex from 'emoji-regex-xs'

// The emoji regex also recognizes text symbols such as © and ™. Only frame
// actual emoji presentation, including VS16 sequences and compound glyphs.
const emojiPresentation = /\p{Emoji_Presentation}/u

export function visibleEmojiMatches(text: string): IterableIterator<RegExpMatchArray> {
  return (function* () {
    for (const match of text.matchAll(emojiRegex())) {
      if (match[0].includes('\ufe0f') || emojiPresentation.test(match[0])) yield match
    }
  })()
}
