import { describe, expect, it, vi } from 'vitest'
import { buildLocalE2ePlan, withTestMinimumVersion } from '../../scripts/run-local-e2e.mjs'

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
        ['npm', 'run', 'test:e2e:tab-login'],
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

describe('local E2E minimum-version isolation', () => {
  function appConfig(initial: string) {
    let minimum = initial
    const admin = {
      from: vi.fn((_table: string) => ({
        select: () => ({
          eq: () => ({ single: async () => ({ data: { min_client_version: minimum } }) }),
        }),
        update: ({ min_client_version }: { min_client_version: string }) => ({
          eq: async () => {
            minimum = min_client_version
            return { error: null }
          },
        }),
      })),
    }
    return { admin, read: () => minimum }
  }

  it('uses a compatible test minimum and restores the original developer setting', async () => {
    const config = appConfig('999.0.0')
    const result = await withTestMinimumVersion(config.admin, async () => {
      expect(config.read()).toBe('0.0.0')
      return 'passed'
    })
    expect(result).toBe('passed')
    expect(config.read()).toBe('999.0.0')
    expect(config.admin.from.mock.calls.every(([table]) => table === 'app_config')).toBe(true)
  })

  it('restores the original setting when the build or test run fails', async () => {
    const config = appConfig('2.14.0')
    await expect(
      withTestMinimumVersion(config.admin, async () => {
        throw new Error('test failed')
      }),
    ).rejects.toThrow('test failed')
    expect(config.read()).toBe('2.14.0')
  })

  it('does not run tests when the original setting cannot be read', async () => {
    const runTests = vi.fn()
    const admin = {
      from: () => ({
        select: () => ({
          eq: () => ({ single: async () => ({ error: { message: 'database unavailable' } }) }),
        }),
      }),
    }
    await expect(withTestMinimumVersion(admin, runTests)).rejects.toThrow('database unavailable')
    expect(runTests).not.toHaveBeenCalled()
  })
})
