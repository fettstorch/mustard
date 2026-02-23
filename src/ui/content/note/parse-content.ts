/**
 * Content segment types for rendering note content with embedded URLs
 */
export type ContentSegment =
  | { type: 'text'; value: string }
  | { type: 'image'; value: string }
  | { type: 'link'; value: string }

/**
 * Regex to match HTTP/HTTPS URLs
 * Matches URLs that start with http:// or https:// and continue until whitespace or end of string
 */
const URL_REGEX = /(https?:\/\/[^\s]+)/g

/**
 * Image extensions we recognize for inline rendering
 * Query parameters are allowed after the extension (e.g., .jpg?width=500)
 */
const IMAGE_EXTENSION_REGEX = /\.(png|jpe?g|gif|webp)(\?[^\s]*)?$/i

/**
 * Determines if a URL points to an image based on its file extension
 */
function isImageUrl(url: string): boolean {
  return IMAGE_EXTENSION_REGEX.test(url)
}

/**
 * Parses note content and splits it into segments (text, image URLs, links)
 * preserving the original order of content.
 *
 * @param text - The raw note content
 * @returns Array of segments in the order they appear in the original text
 *
 * @example
 * parseContent("Check https://example.com/cat.png and https://docs.com")
 * // Returns:
 * // [
 * //   { type: 'text', value: 'Check ' },
 * //   { type: 'image', value: 'https://example.com/cat.png' },
 * //   { type: 'text', value: ' and ' },
 * //   { type: 'link', value: 'https://docs.com' }
 * // ]
 */
export function parseContent(text: string): ContentSegment[] {
  const segments: ContentSegment[] = []

  // Find all URLs in the text
  const urls = text.match(URL_REGEX)

  if (!urls) {
    // No URLs found, return the entire text as a single segment
    return [{ type: 'text', value: text }]
  }

  // Track our position in the original text
  let lastIndex = 0

  // Process each URL match
  urls.forEach((url) => {
    const urlStartIndex = text.indexOf(url, lastIndex)

    // Add text segment before this URL (if any)
    if (urlStartIndex > lastIndex) {
      const textBefore = text.substring(lastIndex, urlStartIndex)
      segments.push({ type: 'text', value: textBefore })
    }

    // Add URL segment (image or link)
    if (isImageUrl(url)) {
      segments.push({ type: 'image', value: url })
    } else {
      segments.push({ type: 'link', value: url })
    }

    // Update last index to after this URL
    lastIndex = urlStartIndex + url.length
  })

  // Add any remaining text after the last URL
  if (lastIndex < text.length) {
    const textAfter = text.substring(lastIndex)
    segments.push({ type: 'text', value: textAfter })
  }

  return segments
}
