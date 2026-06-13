/**
 * User-selectable text font for all Mustard surfaces.
 *
 * Everything renders text via the single `--mustard-font` CSS variable, so we
 * just override that variable at runtime and (for web fonts) inject the Google
 * Fonts stylesheet.
 *
 * Two font categories:
 * - `system`: installed on the user's machine, referenced by name only. These
 *   are NOT network loads, so a host page's CSP (`font-src`/`style-src`) can
 *   never block them — they render on every site, including strict-CSP pages
 *   like GitHub.
 * - `web`: downloaded from Google Fonts. Prettier/more distinctive, but the
 *   download is subject to the HOST page's CSP when used in content scripts, so
 *   on strict-CSP pages they silently fall back to the generic family at the
 *   end of the stack. Extension pages (popup/options) are unaffected.
 */

export const MUSTARD_FONT_KEY = 'mustard-font-family'
export const DEFAULT_FONT_ID = 'verdana'

interface FontOption {
  id: string
  label: string
  /** CSS `font-family` value; always ends in a generic family for graceful fallback. */
  stack: string
  category: 'system' | 'web'
  /** Google Fonts stylesheet URL. Absent for system fonts (no download needed). */
  googleHref?: string
}

export const MUSTARD_FONTS: FontOption[] = [
  // --- System fonts: render on every site, no download, CSP-proof ---
  { id: 'system', label: 'System default', stack: 'system-ui, sans-serif', category: 'system' },
  {
    id: 'arial',
    label: 'Arial (sans)',
    stack: 'Arial, Helvetica, sans-serif',
    category: 'system',
  },
  {
    id: 'verdana',
    label: 'Verdana (sans)',
    // Verdana ships on Windows/macOS; DejaVu Sans is the common Linux fallback.
    stack: "Verdana, Geneva, 'DejaVu Sans', sans-serif",
    category: 'system',
  },
  {
    id: 'georgia',
    label: 'Georgia (serif)',
    stack: "Georgia, 'Times New Roman', serif",
    category: 'system',
  },
  {
    id: 'courier',
    label: 'Courier (mono)',
    stack: "'Courier New', ui-monospace, monospace",
    category: 'system',
  },

  // --- Web fonts (Google): may fall back on strict-CSP sites ---
  {
    id: 'azeret-mono',
    label: 'Azeret Mono (mono)',
    stack: "'Azeret Mono', ui-monospace, monospace",
    category: 'web',
    googleHref:
      'https://fonts.googleapis.com/css2?family=Azeret+Mono:wght@300;400;500;600;700&display=swap',
  },
  {
    id: 'inter',
    label: 'Inter (sans)',
    stack: "'Inter', system-ui, sans-serif",
    category: 'web',
    googleHref:
      'https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&display=swap',
  },
  {
    id: 'nunito',
    label: 'Nunito (rounded)',
    stack: "'Nunito', system-ui, sans-serif",
    category: 'web',
    googleHref:
      'https://fonts.googleapis.com/css2?family=Nunito:wght@300;400;500;600;700&display=swap',
  },
  {
    id: 'lora',
    label: 'Lora (serif)',
    stack: "'Lora', Georgia, serif",
    category: 'web',
    googleHref: 'https://fonts.googleapis.com/css2?family=Lora:wght@400;500;600;700&display=swap',
  },
  {
    id: 'comic-neue',
    label: 'Comic Neue (fun)',
    stack: "'Comic Neue', cursive",
    category: 'web',
    googleHref: 'https://fonts.googleapis.com/css2?family=Comic+Neue:wght@300;400;700&display=swap',
  },
]

const FONT_LINK_ID = 'mustard-font-link'

/** Resolve a stored id to a font, falling back to the default. */
export function getFontById(id: string | undefined | null): FontOption {
  return (
    MUSTARD_FONTS.find((f) => f.id === id) ?? MUSTARD_FONTS.find((f) => f.id === DEFAULT_FONT_ID)!
  )
}

/**
 * Idempotently inject/update the `<link>` for a web font into `doc.head`.
 * For system fonts there's nothing to download, so any prior link is removed.
 */
export function ensureFontStylesheet(doc: Document, font: FontOption): void {
  const existing = doc.getElementById(FONT_LINK_ID) as HTMLLinkElement | null

  if (!font.googleHref) {
    existing?.remove()
    return
  }

  if (existing) {
    if (existing.href !== font.googleHref) existing.href = font.googleHref
    return
  }

  const link = doc.createElement('link')
  link.id = FONT_LINK_ID
  link.rel = 'stylesheet'
  link.href = font.googleHref
  doc.head.appendChild(link)
}

/** Override the `--mustard-font` token on the given element. */
export function applyFontVar(el: HTMLElement, font: FontOption): void {
  el.style.setProperty('--mustard-font', font.stack)
}

/**
 * Wire up the selected font on an extension surface (popup/options): apply the
 * stored choice now and keep it live when changed elsewhere.
 *
 * `doc` receives the web-font `<link>`; `rootEl` receives the `--mustard-font`
 * override (typically `document.documentElement`).
 */
export function initSurfaceFont(doc: Document, rootEl: HTMLElement): void {
  const apply = (id: string | undefined | null) => {
    const font = getFontById(id)
    ensureFontStylesheet(doc, font)
    applyFontVar(rootEl, font)
  }

  browser.storage.local
    .get(MUSTARD_FONT_KEY)
    .then((r) => apply(r[MUSTARD_FONT_KEY] as string | undefined))
    .catch(() => {})

  browser.storage.onChanged.addListener((changes) => {
    if (MUSTARD_FONT_KEY in changes) {
      apply(changes[MUSTARD_FONT_KEY].newValue as string | undefined)
    }
  })
}
