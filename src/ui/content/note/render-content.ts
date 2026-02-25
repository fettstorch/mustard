import MarkdownIt from 'markdown-it'

const md = new MarkdownIt({
  html: false, // XSS prevention: don't render raw HTML
  linkify: true, // auto-convert bare URLs to links
  breaks: true, // newlines become <br>
})

// Add target="_blank" and security attrs to links
const defaultLinkOpen =
  md.renderer.rules.link_open ||
  ((tokens, idx, options, _env, self) => self.renderToken(tokens, idx, options))

md.renderer.rules.link_open = (tokens, idx, options, env, self) => {
  tokens[idx]!.attrSet('target', '_blank')
  tokens[idx]!.attrSet('rel', 'noopener noreferrer')
  tokens[idx]!.attrSet('class', 'mustard-note-link')
  return defaultLinkOpen(tokens, idx, options, env, self)
}

// Add styling attrs to images
const defaultImage = md.renderer.rules.image!

md.renderer.rules.image = (tokens, idx, options, env, self) => {
  tokens[idx]!.attrSet('class', 'mustard-note-image')
  tokens[idx]!.attrSet('draggable', 'false')
  tokens[idx]!.attrSet('referrerpolicy', 'no-referrer')
  return defaultImage(tokens, idx, options, env, self)
}

/**
 * Bare image URL regex (not already wrapped in markdown `![](...)` syntax).
 * Negative lookbehind ensures we don't re-wrap existing markdown images.
 */
const BARE_IMAGE_URL_REGEX =
  /(?<!\]\()https?:\/\/[^\s]+\.(?:png|jpe?g|gif|webp)(?::(?:large|medium|small|orig|thumb))?(?:\?[^\s]*)?(?:#[^\s]*)?/gi

/**
 * Converts bare image URLs to markdown image syntax for backward compat
 * with old notes that stored plain-text image URLs.
 */
function preprocessContent(content: string): string {
  return content.replace(BARE_IMAGE_URL_REGEX, (url) => `![](${url})`)
}

/**
 * Renders note content as sanitized HTML.
 * Handles both old-format (bare URLs) and new-format (markdown) notes.
 */
export function renderContent(content: string): string {
  return md.render(preprocessContent(content))
}
