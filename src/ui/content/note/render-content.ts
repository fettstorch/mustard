import MarkdownIt from 'markdown-it'
import {
  BSKY_PROFILE_URL_PREFIX,
  makeMentionSentinelRegex,
  bskyProfileUrl,
  shortDid,
} from '@/shared/mentions'

const md = new MarkdownIt({
  html: false, // XSS prevention: don't render raw HTML
  linkify: true, // auto-convert bare URLs to links
  breaks: true, // newlines become <br>
})

// Add target="_blank" and security attrs to links. Mentions (links to a
// Bluesky profile) get a distinct class so they can be styled differently.
const defaultLinkOpen =
  md.renderer.rules.link_open ||
  ((tokens, idx, options, _env, self) => self.renderToken(tokens, idx, options))

md.renderer.rules.link_open = (tokens, idx, options, env, self) => {
  const href = tokens[idx]!.attrGet('href') ?? ''
  const isMention = href.startsWith(BSKY_PROFILE_URL_PREFIX)
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
 * Rewrites DID-canonical mention sentinels `@[did:...]` into markdown links to
 * the mentioned user's Bluesky profile. The visible label is the *current*
 * handle (resolved via `resolveHandle`); the link target is the stable DID.
 */
function rewriteMentions(
  content: string,
  resolveHandle?: (did: string) => string | undefined,
): string {
  return content.replace(makeMentionSentinelRegex(), (_match, did: string) => {
    const handle = resolveHandle?.(did)
    const label = handle ? `@${handle}` : `@${shortDid(did)}`
    return `[${escapeLinkText(label)}](${bskyProfileUrl(did)})`
  })
}

/**
 * Converts bare image URLs to markdown image syntax for backward compat
 * with old notes that stored plain-text image URLs.
 */
function preprocessContent(
  content: string,
  resolveHandle?: (did: string) => string | undefined,
): string {
  const withMentions = rewriteMentions(content, resolveHandle)
  return withMentions.replace(BARE_IMAGE_URL_REGEX, (url) => `![](${url})`)
}

/**
 * Renders note content as sanitized HTML.
 * Handles both old-format (bare URLs) and new-format (markdown) notes.
 */
// Matches <p> elements containing only whitespace and/or <br> tags.
// p:empty in CSS misses these since they have text/element children.
const EMPTY_P_REGEX = /<p>(\s|<br\s*\/?>)*<\/p>/gi

/**
 * Renders note/comment content as sanitized HTML.
 *
 * @param resolveHandle optional DID → current-handle resolver for @-mentions.
 *   When a handle isn't known yet, a short DID placeholder is shown instead
 *   (the link still works since it targets the DID).
 */
export function renderContent(
  content: string,
  resolveHandle?: (did: string) => string | undefined,
): string {
  return md.render(preprocessContent(content.trim(), resolveHandle)).replace(EMPTY_P_REGEX, '')
}
