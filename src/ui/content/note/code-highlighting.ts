import { createLowlight } from 'lowlight'
import hljs from 'highlight.js/lib/core'
import bash from 'highlight.js/lib/languages/bash'
import css from 'highlight.js/lib/languages/css'
import javascript from 'highlight.js/lib/languages/javascript'
import json from 'highlight.js/lib/languages/json'
import python from 'highlight.js/lib/languages/python'
import sql from 'highlight.js/lib/languages/sql'
import typescript from 'highlight.js/lib/languages/typescript'
import xml from 'highlight.js/lib/languages/xml'

const languages = {
  bash,
  css,
  javascript,
  json,
  python,
  sql,
  typescript,
  xml,
}

const aliases = {
  bash: ['sh', 'shell', 'zsh'],
  javascript: ['js', 'jsx', 'mjs', 'cjs'],
  typescript: ['ts', 'tsx', 'mts', 'cts'],
  xml: ['html', 'svg'],
}

for (const [name, grammar] of Object.entries(languages)) {
  hljs.registerLanguage(name, grammar)
}

for (const [name, names] of Object.entries(aliases)) {
  hljs.registerAliases(names, { languageName: name })
}

/**
 * A deliberately small grammar set for the content-script bundle. Lowlight
 * powers the editor; highlight.js renders persisted Markdown to HTML.
 */
export const lowlight = createLowlight(languages)

lowlight.registerAlias(aliases)

/**
 * Returns escaped highlight.js markup for a supported fenced-code language.
 * An unknown explicit language returns an empty string so markdown-it performs
 * its safe default escaping instead.
 */
export function highlightCode(source: string, language: string): string {
  const normalizedLanguage = language.trim().toLowerCase()

  if (normalizedLanguage) {
    if (!hljs.getLanguage(normalizedLanguage)) return ''
    return hljs.highlight(source, { language: normalizedLanguage, ignoreIllegals: true }).value
  }

  return hljs.highlightAuto(source).value
}
