import { defineConfig } from 'wxt'
import vue from '@vitejs/plugin-vue'
import { fileURLToPath, URL } from 'node:url'
import { readFileSync } from 'node:fs'
import type { Plugin } from 'vite'

/**
 * Converts PNG imports from src/assets/icons/ to base64 data URIs at transform time.
 * Bypasses host page img-src CSP in both dev and production.
 */
const inlineIcons: Plugin = {
  name: 'inline-icons',
  transform(_code, id) {
    if (!id.includes('/assets/icons/') || !id.endsWith('.png')) return
    const data = readFileSync(id)
    return `export default "data:image/png;base64,${data.toString('base64')}"`
  },
}

// Public key from the Chrome Web Store listing. Embedding it pins the local
// unpacked extension ID to the deployed one (mmdodhbelecgangbkloiaoohdinhkpcj),
// so dev/prod share a single OAuth redirect URI.
const CHROME_KEY =
  'MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEA4cX9OgjhRCzrRvauVIyPhd9Lb0VarCl37jxpogyafhuSXiiFNzJbza/Oh/C01wqNMmsqCaeWv7abaOFwNqlhz1rCzi3nbl8EBPZKCSV4BdzWYkTeCoaXkBMZjo1yCutIwA+c0K/1pb9D/pCsbqEMUSz9bxe2weHd90g1xu/DRoNorZtUrK14ha9tFSdeignk1UGGOTSQ4el+a01FAvzOCZJYACKzaY/gtHHa9uTRFjij6BDu+CK6WBqoD063HiJZYM7qM1occAnbhRDN3QSx6jw/lrY8SPyEgKMlNOVCzH7EDGK4cSZw8KH3umagMP0Ts1wIWIOi9XE9Fjf6+AH8LwIDAQAB'

export default defineConfig({
  srcDir: 'src',
  outDir: 'dist',
  outDirTemplate: '{{browser}}',

  manifest: ({ browser }) => ({
    name: 'Mustard',
    ...(browser === 'chrome' ? { key: CHROME_KEY } : {}),
    permissions: ['storage', 'contextMenus', 'identity'],
    host_permissions: ['<all_urls>'],
    content_security_policy: {
      extension_pages: "script-src 'self'; object-src 'self'; img-src 'self' https: data:",
    },
    icons: {
      16: 'mustard_bottle_smile_16.png',
      48: 'mustard_bottle_smile_48.png',
      128: 'mustard_bottle_smile_128.png',
      512: 'mustard_bottle_smile_512.png',
    },
    web_accessible_resources: [
      {
        resources: ['url-change-detector.js'],
        matches: ['<all_urls>'],
      },
    ],
  }),

  vite: () => ({
    plugins: [inlineIcons, vue()],
    resolve: {
      alias: {
        '@': fileURLToPath(new URL('./src', import.meta.url)),
      },
    },
    build: {
      assetsInlineLimit: 65536,
    },
  }),

})
