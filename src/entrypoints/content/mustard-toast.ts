import mustardIconUrl from '@/assets/icons/mustard_bottle_smile_48.png'

// Shared renderer for Mustard's top-of-page toasts: persistent ones (session
// expired, update required) and transient ones (e.g. "show all notes"
// feedback). All toasts share one look and live in a single top-center stack so
// multiple can appear without overlapping. Placement is always the top — where
// users expect toasts.

const STACK_ID = 'mustard-toast-stack'

/** Lazily create (once) the fixed top-center column that holds all toasts. */
function getStack(): HTMLElement {
  let stack = document.getElementById(STACK_ID)
  if (!stack) {
    stack = document.createElement('div')
    stack.id = STACK_ID
    stack.style.cssText =
      'position:fixed;top:0;left:50%;transform:translateX(-50%);z-index:2147483647;' +
      'display:flex;flex-direction:column;align-items:center;gap:8px;pointer-events:none'
    document.body.appendChild(stack)
  }
  return stack
}

interface MustardToastOptions {
  /** Stable id — re-showing with the same id replaces the existing toast. */
  id: string
  text: string
  /**
   * Click handler. Receives a `dismiss` callback so the caller decides whether
   * a click should also close the toast. Omit for a non-interactive toast.
   */
  onClick?: (dismiss: () => void) => void
  /** Auto-remove after N ms (transient toast). Omit for a persistent one. */
  autoDismissMs?: number
}

// Per-id auto-dismiss timers, so replacing/removing a toast can cancel its
// pending timeout instead of leaking it.
const timers = new Map<string, ReturnType<typeof setTimeout>>()

/**
 * Show (or replace) a Mustard toast at the top of the page.
 * Persistent when `autoDismissMs` is omitted, transient otherwise.
 */
export function showMustardToast(options: MustardToastOptions): void {
  const { id, text, onClick, autoDismissMs } = options
  const stack = getStack()

  // Replace any existing toast with this id and clear its pending timer.
  document.getElementById(id)?.remove()
  const existingTimer = timers.get(id)
  if (existingTimer) {
    clearTimeout(existingTimer)
    timers.delete(id)
  }

  const toast = document.createElement('div')
  toast.id = id
  toast.style.cssText =
    'pointer-events:auto;background:#ffb800;color:#3d2200;padding:10px 18px;' +
    'border-radius:0 0 10px 10px;font-family:monospace;font-size:13px;font-weight:600;' +
    'box-shadow:0 2px 8px rgba(0,0,0,0.25);display:flex;align-items:center;gap:8px;' +
    'max-width:min(90vw,480px)' +
    (onClick ? ';cursor:pointer' : '')

  const icon = document.createElement('img')
  icon.src = mustardIconUrl
  icon.style.cssText = 'width:24px;height:24px;flex-shrink:0'
  const label = document.createElement('span')
  label.textContent = text
  toast.appendChild(icon)
  toast.appendChild(label)

  const dismiss = () => {
    toast.remove()
    const t = timers.get(id)
    if (t) {
      clearTimeout(t)
      timers.delete(id)
    }
  }
  if (onClick) toast.onclick = () => onClick(dismiss)

  stack.appendChild(toast)

  if (autoDismissMs !== undefined) {
    timers.set(id, setTimeout(dismiss, autoDismissMs))
  }
}
