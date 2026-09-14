import { configDefaults, defineConfig } from 'vitest/config'
import { WxtVitest } from 'wxt/testing/vitest-plugin'

export default defineConfig({
  plugins: [WxtVitest()],
  test: {
    include: ['test/**/*.test.ts'],
    exclude: [...configDefaults.exclude, 'test/{e2e,live-e2e,tab-e2e}/**'],
  },
})
