import MarkdownIt from 'markdown-it'
import { highlightCode } from './code-highlighting'
import { makeMentionSentinelRegex, shortAccountId } from '@/shared/mentions'
import {
  BSKY_PROFILE_URL_PREFIX,
  GITHUB_PROFILE_URL_PREFIX,
  providerProfileUrl,
} from '@/shared/providers'

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
  /(?<!\]\()https?:\/\/[^\s?#]+\.(?:png|jpe?g|gif|webp)(?::(?:large|medium|small|orig|thumb))?(?:\?[^\s]*)?(?:#[^\s]*)?/gi

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
  const withMentions = rewriteMentions(content, resolveProfile)
  return withMentions.replace(BARE_IMAGE_URL_REGEX, (url) => `![](${url})`)
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
