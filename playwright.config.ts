import { defineConfig } from '@playwright/test'
export default defineConfig({
  testDir: './test/e2e',
  testIgnore: '**/authenticated/**',
  // Each test file gets its own isolated browser context (extension installed fresh)
  fullyParallel: false,
  workers: 1,
  timeout: 30_000,
  retries: 0,
  use: {
    // Traces and screenshots only saved on failure
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },
  reporter: [
    [process.env.CI ? 'github' : 'list'],
    ['html', { outputFolder: 'playwright-report', open: 'never' }],
  ],
  // Chromium only — extension testing requires a real browser context.
  projects: [
    {
      name: 'chromium-extension',
    },
  ],
  webServer: {
    command: 'vite test/e2e/fixtures --host 127.0.0.1 --port 4173 --strictPort',
    url: 'http://127.0.0.1:4173/page.html',
    reuseExistingServer: !process.env.CI,
  },
  outputDir: 'test-results',
})
