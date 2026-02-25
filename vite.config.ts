import { fileURLToPath, URL } from 'node:url'

import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import tailwindcss from '@tailwindcss/vite'
import { crx } from '@crxjs/vite-plugin'
import manifest from './src/manifest'

// https://vite.dev/config/
export default defineConfig({
  plugins: [vue(), tailwindcss(), crx({ manifest })],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  build: {
    rollupOptions: {
      input: {
        'url-change-detector': 'src/content/url-change-detector.ts',
        welcome: 'src/ui/welcome/index.html',
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
