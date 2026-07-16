import type { LinkPreview } from './model/LinkPreview'

const MAX_TITLE_LENGTH = 200
const MAX_DESCRIPTION_LENGTH = 300
const MAX_SITE_NAME_LENGTH = 80
const LINK_TOKEN =
  /https?:\/\/[^\s<>{}\x5b\x5d"']+|(?:[a-z\d](?:[a-z\d-]*[a-z\d])?\.)+[a-z][a-z\d-]{1,62}(?::\d+)?(?:[/?#][^\s<>{}\x5b\x5d"']*)?/gi

/** Finds the first HTTP(S) URL or bare domain in note markdown/plain text. */
export function extractFirstLinkUrl(content: string): string | undefined {
  const previewableContent = maskMarkdownImages(maskMarkdownCode(content))
  for (const match of previewableContent.matchAll(LINK_TOKEN)) {
    const matched = match[0]
    const isBareDomain = !/^https?:\/\//i.test(matched)
    const matchStart = match.index ?? 0
    const before = previewableContent[matchStart - 1]
    const after = previewableContent[matchStart + matched.length]
    if (isBareDomain && (before === '@' || after === '@')) continue

    // Punctuation at the end of prose is not normally part of the URL. Keep a
    // balanced closing parenthesis, which is common in Wikipedia-style URLs.
    let candidate = matched
    while (
      /[.,!?;:]$/.test(candidate) ||
      (candidate.endsWith(')') && !hasBalancedParens(candidate))
    ) {
      candidate = candidate.slice(0, -1)
    }
    const url = normalizeHttpUrl(isBareDomain ? `https://${candidate}` : candidate)
    if (url) return url
  }
  return undefined
}

/**
 * Preserve string offsets while excluding Markdown code from preview discovery.
 * Code often contains dotted identifiers such as `client.invoke`, which look
 * like bare domains to the link matcher but must never control a note preview.
 */
function maskMarkdownCode(content: string): string {
  const characters = content.split('')
  let openFence: { marker: '`' | '~'; length: number } | undefined

  for (let lineStart = 0; lineStart <= content.length;) {
    const newline = content.indexOf('\n', lineStart)
    const lineEnd = newline === -1 ? content.length : newline
    const line = content.slice(lineStart, lineEnd)

    if (openFence) {
      maskRange(characters, lineStart, lineEnd)
      if (closesFencedCodeBlock(line, openFence)) openFence = undefined
    } else {
      const fence = opensFencedCodeBlock(line)
      if (fence) {
        maskRange(characters, lineStart, lineEnd)
        openFence = fence
      }
    }

    if (newline === -1) break
    lineStart = newline + 1
  }

  for (let index = 0; index < characters.length; index++) {
    if (characters[index] !== '`') continue
    const delimiterLength = countRun(characters, index, '`')
    const closing = findInlineCodeClosingDelimiter(
      characters,
      index + delimiterLength,
      delimiterLength,
    )
    if (closing === undefined) {
      index += delimiterLength - 1
      continue
    }
    maskRange(characters, index, closing + delimiterLength)
    index = closing + delimiterLength - 1
  }

  return characters.join('')
}

/** Image nodes are already the visual attachment, not a candidate card URL. */
function maskMarkdownImages(content: string): string {
  const characters = content.split('')

  for (let index = 0; index < characters.length - 3; index++) {
    if (characters[index] !== '!' || characters[index + 1] !== '[') continue
    const altEnd = findMatchingDelimiter(characters, index + 1, '[', ']')
    if (altEnd === undefined || characters[altEnd + 1] !== '(') continue
    const imageEnd = findMatchingDelimiter(characters, altEnd + 1, '(', ')')
    if (imageEnd === undefined) continue
    maskRange(characters, index, imageEnd + 1)
    index = imageEnd
  }

  return characters.join('')
}

function opensFencedCodeBlock(line: string): { marker: '`' | '~'; length: number } | undefined {
  const match = line.match(/^ {0,3}(`{3,}|~{3,})/)
  if (!match?.[1]) return undefined
  return { marker: match[1][0] as '`' | '~', length: match[1].length }
}

function closesFencedCodeBlock(
  line: string,
  fence: { marker: '`' | '~'; length: number },
): boolean {
  const indentation = line.match(/^ {0,3}/)?.[0].length ?? 0
  if (line[indentation] !== fence.marker) return false
  const length = countRun(line, indentation, fence.marker)
  return length >= fence.length && line.slice(indentation + length).trim() === ''
}

function findInlineCodeClosingDelimiter(
  characters: string[],
  start: number,
  delimiterLength: number,
): number | undefined {
  for (let index = start; index < characters.length; index++) {
    if (characters[index] !== '`') continue
    const length = countRun(characters, index, '`')
    if (length === delimiterLength) return index
    index += length - 1
  }
  return undefined
}

function findMatchingDelimiter(
  characters: string[],
  start: number,
  opening: string,
  closing: string,
): number | undefined {
  let depth = 0
  for (let index = start; index < characters.length; index++) {
    if (characters[index] === '\\') {
      index++
      continue
    }
    if (characters[index] === opening) depth++
    if (characters[index] === closing && --depth === 0) return index
  }
  return undefined
}

function countRun(value: string | string[], start: number, character: string): number {
  let length = 0
  while (value[start + length] === character) length++
  return length
}

function maskRange(characters: string[], start: number, end: number): void {
  for (let index = start; index < end; index++) {
    if (characters[index] !== '\n') characters[index] = ' '
  }
}

function hasBalancedParens(value: string): boolean {
  let depth = 0
  for (const char of value) {
    if (char === '(') depth++
    if (char === ')') depth--
  }
  return depth === 0
}

/** Returns an absolute HTTP(S) URL without a fragment, or undefined. */
export function normalizeHttpUrl(value: string, base?: string): string | undefined {
  try {
    const url = new URL(value, base)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return undefined
    url.hash = ''
    return url.href
  } catch {
    return undefined
  }
}

/**
 * Parse the Open Graph subset we render. This deliberately does not parse or
 * return HTML: all values become plain text rendered by Vue interpolation.
 */
export function extractLinkPreview(
  html: string,
  requestedUrl: string,
  metadataBaseUrl = requestedUrl,
): LinkPreview | undefined {
  const url = normalizeHttpUrl(requestedUrl)
  if (!url) return undefined

  const metadata = new Map<string, string>()
  for (const tag of html.matchAll(/<meta\b[^>]*>/gi)) {
    const attributes = parseAttributes(tag[0])
    const key = (attributes.property ?? attributes.name ?? '').toLowerCase()
    const value = attributes.content
    if (key && value && !metadata.has(key)) metadata.set(key, cleanMetadataValue(value))
  }

  const title =
    metadata.get('og:title') ??
    metadata.get('twitter:title') ??
    cleanText(html.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? '', MAX_TITLE_LENGTH)
  const description =
    metadata.get('og:description') ??
    metadata.get('twitter:description') ??
    metadata.get('description')
  const siteName = metadata.get('og:site_name')
  const imageUrl = normalizeHttpUrl(
    metadata.get('og:image') ?? metadata.get('twitter:image') ?? '',
    metadataBaseUrl,
  )

  return {
    url,
    ...(title ? { title: cleanText(title, MAX_TITLE_LENGTH) } : {}),
    ...(description ? { description: cleanText(description, MAX_DESCRIPTION_LENGTH) } : {}),
    ...(siteName ? { siteName: cleanText(siteName, MAX_SITE_NAME_LENGTH) } : {}),
    ...(imageUrl ? { imageUrl } : {}),
  }
}

function parseAttributes(tag: string): Record<string, string> {
  const result: Record<string, string> = {}
  const attribute = /([^\s=/>]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g
  for (const match of tag.matchAll(attribute)) {
    result[match[1]!.toLowerCase()] = match[2] ?? match[3] ?? match[4] ?? ''
  }
  return result
}

function cleanText(value: string, maxLength: number): string {
  return cleanMetadataValue(value)
    .replace(/<[^>]*>/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLength)
}

/** Decode meta values without applying display-text limits to URLs. */
function cleanMetadataValue(value: string): string {
  return decodeEntities(value)
    .replace(/\p{Cc}/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function decodeEntities(value: string): string {
  return value
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&#(x[\da-f]+|\d+);/gi, (_match, entity: string) => {
      const codePoint =
        entity.startsWith('x') || entity.startsWith('X')
          ? Number.parseInt(entity.slice(1), 16)
          : Number(entity)
      return Number.isSafeInteger(codePoint) && codePoint >= 0 && codePoint <= 0x10ffff
        ? String.fromCodePoint(codePoint)
        : ''
    })
}
