import MarkdownIt from 'markdown-it'
import { highlightCode } from './code-highlighting'
import { makeMentionSentinelRegex, shortAccountId } from '@/shared/mentions'
import {
  BSKY_PROFILE_URL_PREFIX,
  GITHUB_PROFILE_URL_PREFIX,
  providerProfileUrl,
} from '@/shared/providers'
import { parseImageWidth } from '../note-editor/resizable-image'
import { IMAGE_URL_PATTERN } from '@/shared/image-url'

const md = new MarkdownIt({
  html: false, // XSS prevention: don't render raw HTML
  linkify: true, // auto-convert bare URLs to links
  breaks: true, // newlines become <br>
  // highlight.js returns escaped markup. Returning an empty string for an
  // unsupported explicit language delegates to markdown-it's safe escaping.
  highlight: highlightCode,
})

// Add target="_blank" and security attrs to links. Mentions (links to a
// provider profile page) get a distinct class so they can be styled differently.
const defaultLinkOpen =
  md.renderer.rules.link_open ||
  ((tokens, idx, options, _env, self) => self.renderToken(tokens, idx, options))

const KNOWN_PROFILE_PREFIXES = [BSKY_PROFILE_URL_PREFIX, GITHUB_PROFILE_URL_PREFIX]
const IMAGE_URL_REGEX = new RegExp(`^(?:${IMAGE_URL_PATTERN})$`, 'i')

// Convert linkified image URLs after Markdown parsing. Code tokens are never
// linkified, so every Markdown code form stays untouched automatically.
md.core.ruler.after('inline', 'mustard_image_links', (state) => {
  for (const token of state.tokens) {
    const children = token.children
    if (!children) continue

    for (let index = 1; index < children.length - 1; index++) {
      const text = children[index]!
      const linkOpen = children[index - 1]!
      const linkClose = children[index + 1]!
      const href = linkOpen.attrGet('href')
      if (
        text.type !== 'text' ||
        linkOpen.type !== 'link_open' ||
        linkClose.type !== 'link_close' ||
        !href ||
        text.content !== href ||
        !IMAGE_URL_REGEX.test(href)
      ) {
        continue
      }

      const image = new state.Token('image', 'img', 0)
      image.attrs = [
        ['src', href],
        ['alt', ''],
      ]
      image.children = []
      if (linkOpen.markup === 'linkify') {
        children.splice(index - 1, 3, image)
        index--
      } else {
        children[index] = image
      }
    }
  }
})

md.renderer.rules.link_open = (tokens, idx, options, env, self) => {
  const href = tokens[idx]!.attrGet('href') ?? ''
  const isMention = KNOWN_PROFILE_PREFIXES.some((prefix) => href.startsWith(prefix))
  tokens[idx]!.attrSet('target', '_blank')
  tokens[idx]!.attrSet('rel', 'noopener noreferrer')
  tokens[idx]!.attrSet('class', isMention ? 'mustard-note-mention' : 'mustard-note-link')
  return defaultLinkOpen(tokens, idx, options, env, self)
}

// Add styling attrs to images
const defaultImage = md.renderer.rules.image!

md.renderer.rules.image = (tokens, idx, options, env, self) => {
  const width = parseImageWidth(tokens[idx]!.attrGet('title'))
  tokens[idx]!.attrSet('class', 'mustard-note-image')
  tokens[idx]!.attrSet('draggable', 'false')
  tokens[idx]!.attrSet('referrerpolicy', 'no-referrer')
  if (width !== undefined) {
    tokens[idx]!.attrSet('width', String(width))
    tokens[idx]!.attrSet('title', '')
  }
  return defaultImage(tokens, idx, options, env, self)
}

/** Escapes markdown link-text special chars in a resolved handle/label. */
function escapeLinkText(text: string): string {
  return text.replace(/[[\]]/g, '\\$&')
}

/**
 * Resolver callback for mention rendering.
 * Maps a provider account id → { handle, url } for a clickable mention link.
 * When the profile isn't cached yet, returning undefined shows a short
 * placeholder instead.
 */
type MentionProfileResolver = (accountId: string) => { handle: string; url: string } | undefined

/**
 * Rewrites `@[p:provider:accountId]` mention sentinels into markdown links.
 */
function rewriteMentions(content: string, resolveProfile?: MentionProfileResolver): string {
  return content.replace(
    makeMentionSentinelRegex(),
    (_match, provider: string, accountId: string) => {
      const resolved = resolveProfile?.(accountId)
      const label = resolved ? `@${resolved.handle}` : `@${shortAccountId(accountId)}`
      // atproto resolves a bare DID at bsky.app, so it makes a usable fallback
      // link; a github numeric id has no profile path, so leave it unlinked
      // until the profile (with the @login) resolves.
      const fallbackUrl =
        provider === 'atproto' ? providerProfileUrl('atproto', accountId) : `#${accountId}`
      const url = resolved ? resolved.url : fallbackUrl
      return `[${escapeLinkText(label)}](${url})`
    },
  )
}

/**
 * Converts bare image URLs to markdown image syntax for backward compat
 * with old notes that stored plain-text image URLs.
 */
function preprocessContent(content: string, resolveProfile?: MentionProfileResolver): string {
  return rewriteMentions(content, resolveProfile)
}

// Matches <p> elements containing only whitespace and/or <br> tags.
const EMPTY_P_REGEX = /<p>(\s|<br\s*\/?>)*<\/p>/gi

/**
 * Renders note/comment content as sanitized HTML.
 *
 * @param resolveProfile optional userId → { handle, url } resolver for @-mentions.
 *   When a profile isn't known yet, a short placeholder is shown and a fallback
 *   link is generated. Supports both legacy atproto and new multi-provider formats.
 */
export function renderContent(content: string, resolveProfile?: MentionProfileResolver): string {
  return md.render(preprocessContent(content.trim(), resolveProfile)).replace(EMPTY_P_REGEX, '')
}
