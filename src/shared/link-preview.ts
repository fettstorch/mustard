import type { LinkPreview } from './model/LinkPreview'

const MAX_TITLE_LENGTH = 200
const MAX_DESCRIPTION_LENGTH = 300
const MAX_SITE_NAME_LENGTH = 80

/** Finds the first ordinary HTTP(S) URL in note markdown/plain text. */
export function extractFirstLinkUrl(content: string): string | undefined {
  const match = content.match(/https?:\/\/[^\s<>{}\x5b\x5d"']+/i)
  if (!match) return undefined

  // Punctuation at the end of prose is not normally part of the URL. Keep a
  // balanced closing parenthesis, which is common in Wikipedia-style URLs.
  let candidate = match[0]
  while (
    /[.,!?;:]$/.test(candidate) ||
    (candidate.endsWith(')') && !hasBalancedParens(candidate))
  ) {
    candidate = candidate.slice(0, -1)
  }
  return normalizeHttpUrl(candidate)
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
