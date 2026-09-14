import { defineConfig } from '@playwright/test'
import base from './playwright.config'

export default defineConfig({
  ...base,
  testDir: './test/tab-e2e',
  testIgnore: [],
  projects: [{ name: 'chromium-tab-login' }],
})
