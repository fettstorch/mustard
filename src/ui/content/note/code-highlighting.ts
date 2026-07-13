import { createLowlight } from 'lowlight'
import hljs from 'highlight.js/lib/core'
import bash from 'highlight.js/lib/languages/bash'
import cpp from 'highlight.js/lib/languages/cpp'
import css from 'highlight.js/lib/languages/css'
import haskell from 'highlight.js/lib/languages/haskell'
import javascript from 'highlight.js/lib/languages/javascript'
import json from 'highlight.js/lib/languages/json'
import python from 'highlight.js/lib/languages/python'
import rust from 'highlight.js/lib/languages/rust'
import sql from 'highlight.js/lib/languages/sql'
import typescript from 'highlight.js/lib/languages/typescript'
import xml from 'highlight.js/lib/languages/xml'

const languages = {
  bash,
  cpp,
  css,
  haskell,
  javascript,
  json,
  python,
  rust,
  sql,
  typescript,
  xml,
}

const aliases = {
  bash: ['sh', 'shell', 'zsh'],
  cpp: ['c++', 'cc', 'cxx', 'h++', 'hh', 'hpp', 'hxx'],
  haskell: ['hs'],
  javascript: ['js', 'jsx', 'mjs', 'cjs'],
  rust: ['rs'],
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
