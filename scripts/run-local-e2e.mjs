import { spawn, spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createClient } from '@supabase/supabase-js'

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const FUNCTIONS_ENV = resolve(REPO_ROOT, 'supabase/functions/.env')
const PLAYWRIGHT_ENV = resolve(REPO_ROOT, '.env.e2e.local')

const TEST_COMMANDS = {
  smoke: ['npx', 'playwright', 'test'],
  auth: ['npx', 'playwright', 'test', '--config', 'playwright.auth.config.ts'],
  bluesky: ['npx', 'playwright', 'test', '--config', 'playwright.bluesky-auth.config.ts'],
  'tab-login': ['npm', 'run', 'test:e2e:tab-login'],
}

export function buildLocalE2ePlan(suite = 'all') {
  const selectedTests =
    suite === 'all'
      ? [TEST_COMMANDS.smoke, TEST_COMMANDS.auth, TEST_COMMANDS.bluesky, TEST_COMMANDS['tab-login']]
      : suite in TEST_COMMANDS
        ? [TEST_COMMANDS[suite]]
        : null

  if (!selectedTests) {
    throw new Error(`Unknown E2E suite "${suite}". Use: all, smoke, auth, bluesky, or tab-login.`)
  }

  return {
    prerequisites: [
      ['supabase', 'start'],
      ['supabase', 'functions', 'serve'],
    ],
    build: ['npm', 'run', 'build:e2e:auth'],
    tests: selectedTests,
  }
}

function readRequiredEnvFile(path, keys) {
  let contents
  try {
    contents = readFileSync(path, 'utf8')
  } catch {
    throw new Error(`Missing ${path}. See the matching committed .example file.`)
  }

  const missing = keys.filter(
    (key) => !new RegExp(`^(?:export\\s+)?${key}=.+$`, 'm').test(contents),
  )
  if (missing.length > 0) {
    throw new Error(`${path} is missing: ${missing.join(', ')}`)
  }
}

function validateLocalEnvironment(suite) {
  const functionKeys = ['JWT_SIGNING_SECRET']
  if (suite === 'all' || suite === 'bluesky') {
    functionKeys.push('ATPROTO_CLIENT_ID', 'ATPROTO_CLIENT_PRIVATE_JWK')
    readRequiredEnvFile(PLAYWRIGHT_ENV, ['BLUESKY_E2E_HANDLE', 'BLUESKY_E2E_PASSWORD'])
  }
  readRequiredEnvFile(FUNCTIONS_ENV, functionKeys)
}

function run([command, ...args], options = {}) {
  return new Promise((resolvePromise, reject) => {
    let output = ''
    const child = spawn(command, args, {
      cwd: REPO_ROOT,
      env: { ...process.env, ...options.env },
      stdio: options.quiet ? ['ignore', 'pipe', 'pipe'] : 'inherit',
    })
    if (options.quiet) {
      child.stdout.on('data', (chunk) => (output += chunk))
      child.stderr.on('data', (chunk) => (output += chunk))
    }
    child.once('error', reject)
    child.once('exit', (code, signal) => {
      if (code === 0) resolvePromise()
      else {
        reject(
          new Error(
            `${command} ${args.join(' ')} exited with ${code ?? signal}${output ? `\n${output.trim()}` : ''}`,
          ),
        )
      }
    })
  })
}

function localSupabaseEnvironment(required = true) {
  const result = spawnSync('supabase', ['status', '-o', 'env'], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
  })
  if (result.status !== 0) {
    if (!required) return null
    throw new Error(`Could not read local Supabase status: ${result.stderr.trim()}`)
  }

  const values = Object.fromEntries(
    result.stdout
      .split('\n')
      .map((line) => line.match(/^([A-Z_]+)="(.*)"$/))
      .filter(Boolean)
      .map((match) => [match[1], match[2]]),
  )
  if (!values.API_URL || !values.ANON_KEY) {
    throw new Error('Local Supabase status did not contain API_URL and ANON_KEY')
  }
  return values
}

export async function withTestMinimumVersion(admin, runTests) {
  const { data, error } = await admin
    .from('app_config')
    .select('min_client_version')
    .eq('id', 1)
    .single()
  if (error) throw new Error(`Could not read local test app config: ${error.message}`)

  const setMinimum = async (value) => {
    const { error: updateError } = await admin
      .from('app_config')
      .update({ min_client_version: value })
      .eq('id', 1)
    if (updateError) throw new Error(`Could not set local test app config: ${updateError.message}`)
  }

  // Match a fresh CI database without resetting the developer's other data.
  await setMinimum('0.0.0')
  try {
    return await runTests()
  } finally {
    await setMinimum(data.min_client_version)
  }
}

function startFunctions() {
  const child = spawn('supabase', ['functions', 'serve'], {
    cwd: REPO_ROOT,
    env: process.env,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let logs = ''
  const capture = (chunk) => {
    const text = chunk.toString()
    logs = `${logs}${text}`.slice(-100_000)
    if (process.env.DEBUG_E2E_FUNCTIONS) process.stderr.write(text)
  }
  child.stdout.on('data', capture)
  child.stderr.on('data', capture)
  return { child, logs: () => logs }
}

async function waitForFunctions(apiUrl, anonKey, child) {
  const deadline = Date.now() + 30_000
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`supabase functions serve exited early with ${child.exitCode}`)
    }
    try {
      const response = await fetch(`${apiUrl}/functions/v1/auth-bridge`, {
        method: 'OPTIONS',
        headers: { Authorization: `Bearer ${anonKey}` },
      })
      if (response.status < 500) return
    } catch {
      // The Edge runtime is still starting.
    }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 500))
  }
  throw new Error('Local Edge Functions did not become ready within 30 seconds')
}

async function stopFunctions(child) {
  if (child.exitCode !== null) return
  child.kill('SIGINT')
  await Promise.race([
    new Promise((resolvePromise) => child.once('exit', resolvePromise)),
    new Promise((resolvePromise) => setTimeout(resolvePromise, 5_000)),
  ])
  if (child.exitCode === null) child.kill('SIGTERM')
}

async function main() {
  const suite = process.argv[2] ?? 'all'
  const plan = buildLocalE2ePlan(suite)
  validateLocalEnvironment(suite)

  let local = localSupabaseEnvironment(false)
  if (local) {
    console.log('Local Supabase is already running.')
  } else {
    console.log('Starting local Supabase...')
    await run(plan.prerequisites[0], { quiet: true })
    local = localSupabaseEnvironment()
  }

  console.log('Starting local Edge Functions with supabase/functions/.env...')
  const functions = startFunctions()
  try {
    await waitForFunctions(local.API_URL, local.ANON_KEY, functions.child)
    const testEnvironment = {
      VITE_SUPABASE_URL: local.API_URL,
      VITE_SUPABASE_ANON_KEY: local.ANON_KEY,
    }
    const runTests = async () => {
      await run(plan.build, { env: testEnvironment })
      for (const command of plan.tests) await run(command, { env: testEnvironment })
    }
    if (suite === 'bluesky') {
      await runTests()
    } else {
      const url = new URL(local.API_URL)
      if (!['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)) {
        throw new Error('Local E2E app config must only be changed on a loopback backend')
      }
      if (!local.SERVICE_ROLE_KEY) throw new Error('Local Supabase service-role key is missing')
      const admin = createClient(local.API_URL, local.SERVICE_ROLE_KEY, {
        auth: { persistSession: false, autoRefreshToken: false },
      })
      await withTestMinimumVersion(admin, runTests)
    }
  } catch (error) {
    const logs = functions.logs().trim()
    if (logs) console.error(`\nLocal Edge Function logs:\n${logs}`)
    throw error
  } finally {
    await stopFunctions(functions.child)
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error)
    process.exitCode = 1
  })
}
