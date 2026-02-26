import { fileURLToPath, URL } from 'node:url'
import { readFileSync } from 'node:fs'

import { defineConfig } from 'vite'
import type { Plugin } from 'vite'
import vue from '@vitejs/plugin-vue'
import tailwindcss from '@tailwindcss/vite'
import { crx } from '@crxjs/vite-plugin'
import manifest from './src/manifest'

/**
 * Converts PNG imports from src/assets/icons/ to base64 data URIs at transform time.
 * Works in both dev and production — assetsInlineLimit only applies to production builds.
 */
const inlineIcons: Plugin = {
  name: 'inline-icons',
  transform(_code, id) {
    if (!id.includes('/assets/icons/') || !id.endsWith('.png')) return
    const data = readFileSync(id)
    return `export default "data:image/png;base64,${data.toString('base64')}"`
  },
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [inlineIcons, vue(), tailwindcss(), crx({ manifest })],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  build: {
    assetsInlineLimit: 65536, // inline assets <64 KB as base64 data URIs (all UI icons are <8 KB)
    rollupOptions: {
      input: {
        'url-change-detector': 'src/content/url-change-detector.ts',
      },
      output: {
        entryFileNames: (chunkInfo) => {
          if (chunkInfo.name === 'url-change-detector') {
            return 'url-change-detector.js'
          }
          return '[name]-[hash].js'
        },
      },
    },
  },
})
