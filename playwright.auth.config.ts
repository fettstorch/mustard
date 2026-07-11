import { defineConfig } from '@playwright/test'
import baseConfig from './playwright.config'

export default defineConfig(baseConfig, {
  testDir: './test/e2e/authenticated',
  testIgnore: [],
  globalSetup: './test/e2e/authenticated/global-setup.ts',
  globalTeardown: './test/e2e/authenticated/global-teardown.ts',
})
