import { defineConfig } from '@playwright/test'
import { existsSync } from 'node:fs'
import baseConfig from './playwright.config'

if (existsSync('.env.e2e.local')) process.loadEnvFile('.env.e2e.local')

export default defineConfig(baseConfig, {
  testDir: './test/live-e2e',
  testMatch: 'bluesky-auth.spec.ts',
  // Live provider discovery, PAR, login, and token exchange can be slower on
  // shared GitHub runners than on a developer machine.
  timeout: 120_000,
  expect: { timeout: 45_000 },
  retries: process.env.CI ? 1 : 0,
  use: {
    ...baseConfig.use,
    // This test enters a real account password. Do not persist browser state or
    // DOM snapshots in CI artifacts, even on failure.
    trace: 'off',
    screenshot: 'off',
    video: 'off',
  },
})
