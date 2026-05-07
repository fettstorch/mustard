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

export default defineConfig({
  srcDir: 'src',
  outDir: '.',
  outDirTemplate: 'dist',

  manifest: {
    name: 'Mustard',
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
  },

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
