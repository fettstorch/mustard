/**
 * User-selectable color themes for all Mustard surfaces.
 *
 * Components style via `--mustard-*` CSS custom properties (see
 * src/styles/mustard-theme.css). We override the full token set at runtime on
 * each surface root — popup/options use `document.documentElement`, on-page
 * notes use `#mustard-host`.
 */

export const MUSTARD_THEME_KEY = 'mustard-theme'
export const DEFAULT_THEME_ID = 'mustard'

interface ThemeOption {
  id: string
  label: string
  /** CSS `background` value for the swatch chip in the options picker. */
  swatch: string
  /** Full `--mustard-*` overrides (palette, semantic, surfaces, gradient, shadow). */
  vars: Record<string, string>
}

/** Tokens managed by themes — kept in sync with mustard-theme.css. */
const THEME_VAR_KEYS = [
  '--mustard-brown',
  '--mustard-brown-border',
  '--mustard-brown-dark',
  '--mustard-yellow-light',
  '--mustard-yellow',
  '--mustard-yellow-mid',
  '--mustard-orange',
  '--mustard-orange-dark',
  '--mustard-text',
  '--mustard-border',
  '--mustard-glass',
  '--mustard-glass-hover',
  '--mustard-glass-strong',
  '--mustard-border-subtle',
  '--mustard-border-faded',
  '--mustard-gradient',
  '--mustard-plastic-shadow',
] as const

const MUSTARD_VARS: Record<string, string> = {
  '--mustard-brown': '#3d2200',
  '--mustard-brown-border': '#5c3a1e',
  '--mustard-brown-dark': '#4a2e17',
  '--mustard-yellow-light': '#ffe066',
  '--mustard-yellow': '#ffcc33',
  '--mustard-yellow-mid': '#ffb800',
  '--mustard-orange': '#f5a200',
  '--mustard-orange-dark': '#e08c00',
  '--mustard-text': 'var(--mustard-brown)',
  '--mustard-border': 'var(--mustard-brown-border)',
  '--mustard-glass': 'rgba(255, 255, 255, 0.3)',
  '--mustard-glass-hover': 'rgba(255, 255, 255, 0.5)',
  '--mustard-glass-strong': 'rgba(255, 255, 255, 0.7)',
  '--mustard-border-subtle': 'rgba(92, 58, 30, 0.25)',
  '--mustard-border-faded': '#5c3a1e50',
  '--mustard-gradient':
    'linear-gradient(180deg, var(--mustard-yellow-light) 0%, var(--mustard-yellow) 25%, var(--mustard-yellow-mid) 50%, var(--mustard-orange) 75%, var(--mustard-orange-dark) 100%)',
  '--mustard-plastic-shadow':
    'inset 0 3px 0 rgba(255, 255, 255, 0.6), inset 0 15px 25px rgba(255, 255, 255, 0.3), inset 8px 0 20px rgba(255, 255, 255, 0.25), inset 0 -15px 25px rgba(140, 70, 0, 0.3), inset -5px 0 15px rgba(120, 60, 0, 0.15), 0 4px 12px rgba(0, 0, 0, 0.25)',
}

const BLUE_VARS: Record<string, string> = {
  '--mustard-brown': '#0a2540',
  '--mustard-brown-border': '#1a4a7a',
  '--mustard-brown-dark': '#153a5e',
  '--mustard-yellow-light': '#d4e8ff',
  '--mustard-yellow': '#a8d4ff',
  '--mustard-yellow-mid': '#6eb3e8',
  '--mustard-orange': '#3d8fd9',
  '--mustard-orange-dark': '#2563b8',
  '--mustard-text': 'var(--mustard-brown)',
  '--mustard-border': 'var(--mustard-brown-border)',
  '--mustard-glass': 'rgba(255, 255, 255, 0.3)',
  '--mustard-glass-hover': 'rgba(255, 255, 255, 0.5)',
  '--mustard-glass-strong': 'rgba(255, 255, 255, 0.7)',
  '--mustard-border-subtle': 'rgba(26, 74, 122, 0.25)',
  '--mustard-border-faded': '#1a4a7a50',
  '--mustard-gradient':
    'linear-gradient(180deg, var(--mustard-yellow-light) 0%, var(--mustard-yellow) 25%, var(--mustard-yellow-mid) 50%, var(--mustard-orange) 75%, var(--mustard-orange-dark) 100%)',
  '--mustard-plastic-shadow':
    'inset 0 3px 0 rgba(255, 255, 255, 0.6), inset 0 15px 25px rgba(255, 255, 255, 0.3), inset 8px 0 20px rgba(255, 255, 255, 0.25), inset 0 -15px 25px rgba(20, 60, 120, 0.3), inset -5px 0 15px rgba(15, 50, 100, 0.15), 0 4px 12px rgba(0, 0, 0, 0.25)',
}

const GREY_LIGHT_VARS: Record<string, string> = {
  '--mustard-brown': '#2d2d2d',
  '--mustard-brown-border': '#4a4a4a',
  '--mustard-brown-dark': '#3a3a3a',
  '--mustard-yellow-light': '#f5f5f5',
  '--mustard-yellow': '#ececec',
  '--mustard-yellow-mid': '#e0e0e0',
  '--mustard-orange': '#d0d0d0',
  '--mustard-orange-dark': '#b8b8b8',
  '--mustard-text': 'var(--mustard-brown)',
  '--mustard-border': 'var(--mustard-brown-border)',
  '--mustard-glass': 'rgba(255, 255, 255, 0.35)',
  '--mustard-glass-hover': 'rgba(255, 255, 255, 0.55)',
  '--mustard-glass-strong': 'rgba(255, 255, 255, 0.75)',
  '--mustard-border-subtle': 'rgba(74, 74, 74, 0.25)',
  '--mustard-border-faded': '#4a4a4a50',
  '--mustard-gradient':
    'linear-gradient(180deg, var(--mustard-yellow-light) 0%, var(--mustard-yellow) 25%, var(--mustard-yellow-mid) 50%, var(--mustard-orange) 75%, var(--mustard-orange-dark) 100%)',
  '--mustard-plastic-shadow':
    'inset 0 3px 0 rgba(255, 255, 255, 0.6), inset 0 15px 25px rgba(255, 255, 255, 0.3), inset 8px 0 20px rgba(255, 255, 255, 0.25), inset 0 -15px 25px rgba(80, 80, 80, 0.25), inset -5px 0 15px rgba(60, 60, 60, 0.12), 0 4px 12px rgba(0, 0, 0, 0.2)',
}

const GREY_DARK_VARS: Record<string, string> = {
  '--mustard-brown': '#e8e8e8',
  '--mustard-brown-border': '#a0a0a0',
  '--mustard-brown-dark': '#c8c8c8',
  '--mustard-yellow-light': '#e8e8e8',
  '--mustard-yellow': '#5a5a5a',
  '--mustard-yellow-mid': '#454545',
  '--mustard-orange': '#353535',
  '--mustard-orange-dark': '#252525',
  '--mustard-text': 'var(--mustard-brown)',
  '--mustard-border': 'var(--mustard-brown-border)',
  '--mustard-glass': 'rgba(255, 255, 255, 0.08)',
  '--mustard-glass-hover': 'rgba(255, 255, 255, 0.15)',
  '--mustard-glass-strong': 'rgba(255, 255, 255, 0.22)',
  '--mustard-border-subtle': 'rgba(255, 255, 255, 0.15)',
  '--mustard-border-faded': '#a0a0a050',
  '--mustard-gradient':
    'linear-gradient(180deg, #5a5a5a 0%, #454545 25%, #353535 50%, #2d2d2d 75%, #1f1f1f 100%)',
  '--mustard-plastic-shadow':
    'inset 0 2px 0 rgba(255, 255, 255, 0.12), inset 0 10px 20px rgba(255, 255, 255, 0.06), inset 0 -10px 20px rgba(0, 0, 0, 0.35), 0 4px 12px rgba(0, 0, 0, 0.4)',
}

const PINK_VARS: Record<string, string> = {
  '--mustard-brown': '#4a1028',
  '--mustard-brown-border': '#7a2048',
  '--mustard-brown-dark': '#5c1838',
  '--mustard-yellow-light': '#ffd6e8',
  '--mustard-yellow': '#ffb3d9',
  '--mustard-yellow-mid': '#ff8cc8',
  '--mustard-orange': '#ff5cad',
  '--mustard-orange-dark': '#e91e8c',
  '--mustard-text': 'var(--mustard-brown)',
  '--mustard-border': 'var(--mustard-brown-border)',
  '--mustard-glass': 'rgba(255, 255, 255, 0.3)',
  '--mustard-glass-hover': 'rgba(255, 255, 255, 0.5)',
  '--mustard-glass-strong': 'rgba(255, 255, 255, 0.7)',
  '--mustard-border-subtle': 'rgba(122, 32, 72, 0.25)',
  '--mustard-border-faded': '#7a204850',
  '--mustard-gradient':
    'linear-gradient(180deg, var(--mustard-yellow-light) 0%, var(--mustard-yellow) 25%, var(--mustard-yellow-mid) 50%, var(--mustard-orange) 75%, var(--mustard-orange-dark) 100%)',
  '--mustard-plastic-shadow':
    'inset 0 3px 0 rgba(255, 255, 255, 0.6), inset 0 15px 25px rgba(255, 255, 255, 0.3), inset 8px 0 20px rgba(255, 255, 255, 0.25), inset 0 -15px 25px rgba(180, 40, 100, 0.3), inset -5px 0 15px rgba(150, 30, 80, 0.15), 0 4px 12px rgba(0, 0, 0, 0.25)',
}

const RAINBOW_VARS: Record<string, string> = {
  '--mustard-brown': '#2d1a3d',
  '--mustard-brown-border': '#4a2d5c',
  '--mustard-brown-dark': '#3d2450',
  '--mustard-yellow-light': '#fff5e6',
  '--mustard-yellow': '#ffe8cc',
  '--mustard-yellow-mid': '#ffd9b3',
  '--mustard-orange': '#ffcc99',
  '--mustard-orange-dark': '#ffbf80',
  '--mustard-text': 'var(--mustard-brown)',
  '--mustard-border': 'var(--mustard-brown-border)',
  '--mustard-glass': 'rgba(255, 255, 255, 0.35)',
  '--mustard-glass-hover': 'rgba(255, 255, 255, 0.55)',
  '--mustard-glass-strong': 'rgba(255, 255, 255, 0.75)',
  '--mustard-border-subtle': 'rgba(74, 45, 92, 0.25)',
  '--mustard-border-faded': '#4a2d5c50',
  '--mustard-gradient':
    'linear-gradient(180deg, #ff6b6b 0%, #ffd93d 20%, #6bcf7f 40%, #4d96ff 60%, #9b59b6 80%, #ff6bcb 100%)',
  '--mustard-plastic-shadow':
    'inset 0 3px 0 rgba(255, 255, 255, 0.5), inset 0 15px 25px rgba(255, 255, 255, 0.25), inset 8px 0 20px rgba(255, 255, 255, 0.2), inset 0 -15px 25px rgba(80, 40, 120, 0.25), inset -5px 0 15px rgba(60, 30, 90, 0.12), 0 4px 12px rgba(0, 0, 0, 0.25)',
}

export const MUSTARD_THEMES: ThemeOption[] = [
  {
    id: 'mustard',
    label: 'Mustard',
    swatch:
      'linear-gradient(180deg, #ffe066 0%, #ffcc33 25%, #ffb800 50%, #f5a200 75%, #e08c00 100%)',
    vars: MUSTARD_VARS,
  },
  {
    id: 'blue',
    label: 'Blue',
    swatch:
      'linear-gradient(180deg, #d4e8ff 0%, #a8d4ff 25%, #6eb3e8 50%, #3d8fd9 75%, #2563b8 100%)',
    vars: BLUE_VARS,
  },
  {
    id: 'grey-light',
    label: 'Light grey',
    swatch:
      'linear-gradient(180deg, #f5f5f5 0%, #ececec 25%, #e0e0e0 50%, #d0d0d0 75%, #b8b8b8 100%)',
    vars: GREY_LIGHT_VARS,
  },
  {
    id: 'grey-dark',
    label: 'Dark grey',
    swatch:
      'linear-gradient(180deg, #4a4a4a 0%, #404040 25%, #353535 50%, #2d2d2d 75%, #1f1f1f 100%)',
    vars: GREY_DARK_VARS,
  },
  {
    id: 'pink',
    label: 'Pink',
    swatch:
      'linear-gradient(180deg, #ffd6e8 0%, #ffb3d9 25%, #ff8cc8 50%, #ff5cad 75%, #e91e8c 100%)',
    vars: PINK_VARS,
  },
  {
    id: 'rainbow',
    label: 'Rainbow',
    swatch:
      'linear-gradient(180deg, #ff6b6b 0%, #ffd93d 20%, #6bcf7f 40%, #4d96ff 60%, #9b59b6 80%, #ff6bcb 100%)',
    vars: RAINBOW_VARS,
  },
]

/** Resolve a stored id to a theme, falling back to the default. */
export function getThemeById(id: string | undefined | null): ThemeOption {
  return (
    MUSTARD_THEMES.find((t) => t.id === id) ??
    MUSTARD_THEMES.find((t) => t.id === DEFAULT_THEME_ID)!
  )
}

/** Apply the full token set for a theme onto `el`. */
export function applyTheme(el: HTMLElement, theme: ThemeOption): void {
  for (const key of THEME_VAR_KEYS) {
    const value = theme.vars[key]
    if (value !== undefined) el.style.setProperty(key, value)
  }
}

/**
 * Wire up the selected theme on an extension surface (popup/options): apply the
 * stored choice now and keep it live when changed elsewhere.
 */
export function initSurfaceTheme(rootEl: HTMLElement): void {
  const apply = (id: string | undefined | null) => {
    applyTheme(rootEl, getThemeById(id))
  }

  browser.storage.local
    .get(MUSTARD_THEME_KEY)
    .then((r) => apply(r[MUSTARD_THEME_KEY] as string | undefined))
    .catch(() => {})

  browser.storage.onChanged.addListener((changes) => {
    if (MUSTARD_THEME_KEY in changes) {
      apply(changes[MUSTARD_THEME_KEY].newValue as string | undefined)
    }
  })
}
