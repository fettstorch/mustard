/**
 * Loads extension icons as data URLs so they aren't blocked by the host page's img-src CSP.
 * chrome-extension:// URLs are fetched inside the content script context (which has access to
 * web-accessible extension resources), then converted to data: URLs that any img-src policy accepts.
 */

const ICON_FILES = [
  'close_x_red_48.png',
  'upvote_blue_48.png',
  'eye_open_48.png',
  'eye_closed_48.png',
  'save_disk_48.png',
  'delete_bin_48.png',
  'publish_arrow_blue_48.png',
  'published_cloud_check_48.png',
] as const

type IconFile = (typeof ICON_FILES)[number]

const cache = new Map<IconFile, string>()

async function toDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = reject
    reader.readAsDataURL(blob)
  })
}

export async function preloadIcons(): Promise<void> {
  await Promise.all(
    ICON_FILES.map(async (file) => {
      try {
        const response = await fetch(chrome.runtime.getURL(file))
        if (!response.ok) throw new Error(`HTTP ${response.status}`)
        const blob = await response.blob()
        cache.set(file, await toDataUrl(blob))
      } catch (err) {
        console.warn(`mustard: failed to load icon ${file} as data URL, falling back:`, err)
        cache.set(file, chrome.runtime.getURL(file))
      }
    }),
  )
}

export function iconUrl(file: IconFile): string {
  return cache.get(file) ?? chrome.runtime.getURL(file)
}
