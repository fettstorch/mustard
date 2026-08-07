import { describe, expect, it } from 'vitest'
import { buildLocalE2ePlan } from '../../scripts/run-local-e2e.mjs'

describe('local E2E runner plan', () => {
  it('uses the default local Edge Function env and runs every E2E suite', () => {
    expect(buildLocalE2ePlan('all')).toEqual({
      prerequisites: [
        ['supabase', 'start'],
        ['supabase', 'functions', 'serve'],
      ],
      build: ['npm', 'run', 'build:e2e:auth'],
      tests: [
        ['npx', 'playwright', 'test'],
        ['npx', 'playwright', 'test', '--config', 'playwright.auth.config.ts'],
        ['npx', 'playwright', 'test', '--config', 'playwright.bluesky-auth.config.ts'],
      ],
    })
  })

  it('selects only the requested authenticated suite', () => {
    expect(buildLocalE2ePlan('auth').tests).toEqual([
      ['npx', 'playwright', 'test', '--config', 'playwright.auth.config.ts'],
    ])
    expect(buildLocalE2ePlan('bluesky').tests).toEqual([
      ['npx', 'playwright', 'test', '--config', 'playwright.bluesky-auth.config.ts'],
    ])
  })
})
