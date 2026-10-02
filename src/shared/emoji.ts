/** One row per visible emoji; first name is canonical, the rest are searchable aliases. */
export type EmojiEntry = { emoji: string; names: readonly string[] }

const CURATED_EMOJI: EmojiEntry[] = [
  { emoji: '👍', names: ['thumbs-up', 'plus-one', 'like'] },
  { emoji: '👎', names: ['thumbs-down', 'minus-one', 'dislike'] },
  { emoji: '😄', names: ['smile'] },
  { emoji: '😃', names: ['smiley'] },
  { emoji: '😊', names: ['smiling', 'blush'] },
  { emoji: '😁', names: ['grin'] },
  { emoji: '😀', names: ['grinning'] },
  { emoji: '😂', names: ['joy', 'laughing-tears'] },
  { emoji: '😆', names: ['laughing'] },
  { emoji: '😉', names: ['wink'] },
  { emoji: '🙂', names: ['slight-smile'] },
  { emoji: '🙃', names: ['upside-down'] },
  { emoji: '🫠', names: ['melting'] },
  { emoji: '😅', names: ['sweat-smile'] },
  { emoji: '🤣', names: ['rofl'] },
  { emoji: '🥰', names: ['hearts-face', 'in-love'] },
  { emoji: '🥲', names: ['smile-tear'] },
  { emoji: '🫣', names: ['peeking', 'peek', 'shy'] },
  { emoji: '😌', names: ['relieved'] },
  { emoji: '😪', names: ['sleepy'] },
  { emoji: '😴', names: ['sleeping'] },
  { emoji: '🥱', names: ['yawning'] },
  { emoji: '😐', names: ['neutral'] },
  { emoji: '😑', names: ['expressionless'] },
  { emoji: '😕', names: ['confused'] },
  { emoji: '😬', names: ['grimace'] },
  { emoji: '😏', names: ['smirk'] },
  { emoji: '😳', names: ['flushed'] },
  { emoji: '😤', names: ['huffing'] },
  { emoji: '🫨', names: ['shaking-face'] },
  { emoji: '😟', names: ['worried'] },
  { emoji: '🥺', names: ['pleading'] },
  { emoji: '😵', names: ['dizzy'] },
  { emoji: '🤢', names: ['sick'] },
  { emoji: '🤧', names: ['sneezing'] },
  { emoji: '😷', names: ['mask'] },
  { emoji: '🤓', names: ['nerd'] },
  { emoji: '🥳', names: ['party', 'party-face'] },
  { emoji: '😘', names: ['kiss'] },
  { emoji: '🤗', names: ['hug'] },
  { emoji: '❤️', names: ['heart', 'red-heart'] },
  { emoji: '💔', names: ['broken-heart'] },
  { emoji: '❤️‍🩹', names: ['mending-heart', 'healing-heart'] },
  { emoji: '🧡', names: ['orange-heart'] },
  { emoji: '💛', names: ['yellow-heart'] },
  { emoji: '💚', names: ['green-heart'] },
  { emoji: '💙', names: ['blue-heart'] },
  { emoji: '💜', names: ['purple-heart'] },
  { emoji: '🖤', names: ['black-heart'] },
  { emoji: '🤍', names: ['white-heart'] },
  { emoji: '😍', names: ['heart-eyes'] },
  { emoji: '🫶', names: ['heart-hands'] },
  { emoji: '🔥', names: ['fire', 'flame'] },
  { emoji: '🎉', names: ['tada', 'party-popper'] },
  { emoji: '👏', names: ['clap', 'applause'] },
  { emoji: '👋', names: ['wave', 'hello'] },
  { emoji: '👌', names: ['ok-hand'] },
  { emoji: '🙌', names: ['raised-hands'] },
  { emoji: '👊', names: ['fist-bump'] },
  { emoji: '🤞', names: ['crossed-fingers'] },
  { emoji: '👆', names: ['point-up'] },
  { emoji: '👇', names: ['point-down'] },
  { emoji: '👈', names: ['point-left'] },
  { emoji: '👉', names: ['point-right'] },
  { emoji: '🖕', names: ['middle-finger'] },
  { emoji: '💪', names: ['muscle', 'strong'] },
  { emoji: '🤝', names: ['handshake'] },
  { emoji: '🫡', names: ['salute'] },
  { emoji: '🤷‍♂️', names: ['shrug-man', 'man-shrugging'] },
  { emoji: '🤷', names: ['shrug', 'shrugging'] },
  { emoji: '🙏', names: ['pray', 'thanks'] },
  { emoji: '🤔', names: ['thinking'] },
  { emoji: '👀', names: ['eyes', 'looking'] },
  { emoji: '🙈', names: ['see-no-evil', 'monkey-see-no-evil'] },
  { emoji: '🙉', names: ['hear-no-evil', 'monkey-hear-no-evil'] },
  { emoji: '🙊', names: ['speak-no-evil', 'monkey-speak-no-evil'] },
  { emoji: '😢', names: ['cry', 'sad'] },
  { emoji: '😭', names: ['sob'] },
  { emoji: '😠', names: ['angry'] },
  { emoji: '😡', names: ['rage'] },
  { emoji: '😱', names: ['scream'] },
  { emoji: '😮', names: ['surprised'] },
  { emoji: '😎', names: ['cool'] },
  { emoji: '⭐', names: ['star'] },
  { emoji: '🤩', names: ['star-struck'] },
  { emoji: '☀️', names: ['sun'] },
  { emoji: '🌙', names: ['moon'] },
  { emoji: '🌈', names: ['rainbow'] },
  { emoji: '🌀', names: ['cyclone', 'spiral', 'swirl'] },
  { emoji: '☁️', names: ['cloud'] },
  { emoji: '❄️', names: ['snowflake'] },
  { emoji: '⚡', names: ['lightning'] },
  { emoji: '🌧️', names: ['rain'] },
  { emoji: '☂️', names: ['umbrella'] },
  { emoji: '✅', names: ['check', 'done'] },
  { emoji: '❌', names: ['x', 'cross'] },
  { emoji: '⚠️', names: ['warning', 'alert'] },
  { emoji: '❓', names: ['question'] },
  { emoji: '❗', names: ['exclamation'] },
  { emoji: '🚀', names: ['rocket'] },
  { emoji: '✨', names: ['sparkles'] },
  { emoji: '💡', names: ['bulb', 'idea'] },
  { emoji: '💯', names: ['hundred'] },
  { emoji: '🎊', names: ['confetti'] },
  { emoji: '🎈', names: ['balloon'] },
  { emoji: '🎁', names: ['gift'] },
  { emoji: '🎵', names: ['music'] },
  { emoji: '🎤', names: ['microphone'] },
  { emoji: '🎸', names: ['guitar'] },
  { emoji: '🎮', names: ['gamepad', 'gaming'] },
  { emoji: '📷', names: ['camera'] },
  { emoji: '💻', names: ['computer', 'laptop'] },
  { emoji: '📱', names: ['phone'] },
  { emoji: '📧', names: ['email'] },
  { emoji: '📖', names: ['book'] },
  { emoji: '✏️', names: ['pencil'] },
  { emoji: '📌', names: ['pin'] },
  { emoji: '🔗', names: ['link'] },
  { emoji: '🔒', names: ['lock'] },
  { emoji: '🔑', names: ['key'] },
  { emoji: '💰', names: ['money'] },
  { emoji: '💎', names: ['gem'] },
  { emoji: '🕒', names: ['clock'] },
  { emoji: '🐱', names: ['cat'] },
  { emoji: '🐶', names: ['dog'] },
  { emoji: '🐵', names: ['monkey'] },
  { emoji: '🦋', names: ['butterfly'] },
  { emoji: '🪱', names: ['worm'] },
  { emoji: '🌸', names: ['flower'] },
  { emoji: '🌹', names: ['rose'] },
  { emoji: '🌻', names: ['sunflower'] },
  { emoji: '🌵', names: ['cactus'] },
  { emoji: '🌳', names: ['tree'] },
  { emoji: '🏳️', names: ['white-flag'] },
  { emoji: '🏴', names: ['black-flag'] },
  { emoji: '🏳️‍🌈', names: ['rainbow-flag', 'pride-flag'] },
  { emoji: '🏳️‍⚧️', names: ['transgender-flag', 'trans-flag'] },
  { emoji: '🏴‍☠️', names: ['pirate-flag'] },
]

// Unicode Emoji 17.0 RGI_Emoji_Flag_Sequence (259 regional-indicator pairs):
// https://www.unicode.org/Public/17.0.0/emoji/emoji-sequences.txt
// Keep this allowlist: not every two-letter combination represents a flag.
const FLAG_CODES = [
  'AC AD AE AF AG AI AL AM AO AQ AR AS AT AU AW',
  'AX AZ BA BB BD BE BF BG BH BI BJ BL BM BN BO',
  'BQ BR BS BT BV BW BY BZ CA CC CD CF CG CH CI',
  'CK CL CM CN CO CP CQ CR CU CV CW CX CY CZ DE',
  'DG DJ DK DM DO DZ EA EC EE EG EH ER ES ET EU',
  'FI FJ FK FM FO FR GA GB GD GE GF GG GH GI GL',
  'GM GN GP GQ GR GS GT GU GW GY HK HM HN HR HT',
  'HU IC ID IE IL IM IN IO IQ IR IS IT JE JM JO',
  'JP KE KG KH KI KM KN KP KR KW KY KZ LA LB LC',
  'LI LK LR LS LT LU LV LY MA MC MD ME MF MG MH',
  'MK ML MM MN MO MP MQ MR MS MT MU MV MW MX MY',
  'MZ NA NC NE NF NG NI NL NO NP NR NU NZ OM PA',
  'PE PF PG PH PK PL PM PN PR PS PT PW PY QA RE',
  'RO RS RU RW SA SB SC SD SE SG SH SI SJ SK SL',
  'SM SN SO SR SS ST SV SX SY SZ TA TC TD TF TG',
  'TH TJ TK TL TM TN TO TR TT TV TW TZ UA UG UM',
  'UN US UY UZ VA VC VE VG VI VN VU WF WS XK YE',
  'YT ZA ZM ZW',
]
  .join(' ')
  .split(' ')

function flagForRegion(code: string): string {
  return [...code]
    .map((letter) => String.fromCodePoint(0x1f1e6 + letter.charCodeAt(0) - 65))
    .join('')
}

function flagForSubdivision(code: string): string {
  return String.fromCodePoint(
    0x1f3f4,
    ...[...code].map((letter) => 0xe0000 + letter.charCodeAt(0)),
    0xe007f,
  )
}

const regionNames = new Intl.DisplayNames(['en'], { type: 'region' })
const slug = (name: string) =>
  name
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')

const regionalFlags: EmojiEntry[] = FLAG_CODES.map((code) => {
  const name = slug(regionNames.of(code) ?? code)
  return {
    emoji: flagForRegion(code),
    names: [...new Set([`flag-${code.toLowerCase()}`, `flag-${name}`, name])],
  }
})

const subdivisionFlags: EmojiEntry[] = [
  { emoji: flagForSubdivision('gbeng'), names: ['flag-england', 'england'] },
  { emoji: flagForSubdivision('gbsct'), names: ['flag-scotland', 'scotland'] },
  { emoji: flagForSubdivision('gbwls'), names: ['flag-wales', 'wales'] },
]

const EMOJI_CATALOGUE: readonly EmojiEntry[] = [
  ...CURATED_EMOJI,
  ...regionalFlags,
  ...subdivisionFlags,
]

function normalizeEmojiQuery(query: string): string {
  return query.toLowerCase().replace(/_/g, '-')
}

export function emojiMatches(query: string): EmojiEntry[] {
  const needle = normalizeEmojiQuery(query)
  return needle
    ? EMOJI_CATALOGUE.filter(({ names }) => names.some((name) => name.includes(needle)))
    : [...EMOJI_CATALOGUE]
}

export function emojiForName(name: string): string | undefined {
  return EMOJI_CATALOGUE.find((entry) => entry.names.includes(normalizeEmojiQuery(name)))?.emoji
}
