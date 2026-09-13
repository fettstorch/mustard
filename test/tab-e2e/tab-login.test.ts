import { test, expect } from '../e2e/extension.fixture'
import type { BrowserContext, Page } from '@playwright/test'
import { awaitable } from '@fettstorch/jule'

// Real extension UI, tabs, messaging and storage; deterministic provider/backend
// HTTP responses. This tests the transport, not live provider authentication.
const callback = 'https://fettstorch.github.io/mustard/callback.html'
const userId = '00000000-0000-4000-8000-000000000001'
const state = 'test-oauth-state'
const callbackUrl = `${callback}?code=test-code&state=${state}&iss=https%3A%2F%2Fprovider.example`

async function mockAuth(
  context: BrowserContext,
  options: {
    reject?: boolean
    completionGate?: Promise<void>
    identitiesGate?: Promise<void>
    linking?: boolean
  } = {},
) {
  const requests: Record<string, unknown>[] = []
  await context.route('https://provider.example/**', (route) =>
    route.fulfill({
      contentType: 'text/html',
      body: '<h1>Test provider</h1>',
    }),
  )
  await context.route(`${callback}**`, (route) =>
    route.fulfill({
      contentType: 'text/html',
      body: '<p>Return to Mustard</p>',
    }),
  )
  await context.route('**/functions/v1/auth-bridge', async (route) => {
    const body = route.request().postDataJSON() as Record<string, unknown>
    requests.push(body)
    if (body.action === 'callback') await options.completionGate
    if (body.action === 'list-identities') await options.identitiesGate
    const json =
      body.action === 'initiate'
        ? {
            authUrl: 'https://provider.example/authorize',
            state,
          }
        : body.action === 'callback'
          ? {
              userId,
              did: 'did:plc:test',
              jwt: 'test-jwt',
              expiresAt: Math.floor(Date.now() / 1000) + 86400,
              refreshToken: 'test-refresh',
            }
          : body.action === 'list-identities'
            ? {
                identities: [
                  {
                    provider: 'atproto',
                    provider_account_id: 'did:plc:test',
                    handle: 'test.example',
                  },
                  ...(options.linking && requests.some((r) => r.action === 'callback')
                    ? [{ provider: 'github', provider_account_id: '42', handle: 'test-github' }]
                    : []),
                ],
              }
            : {}
    await route.fulfill({
      status: body.action === 'callback' && options.reject ? 400 : 200,
      json: body.action === 'callback' && options.reject ? { error: 'Rejected callback' } : json,
    })
  })
  await context.route('**/rest/v1/**', (route) => route.fulfill({ json: [] }))
  return requests
}

async function openLogin(context: BrowserContext, popupUrl: string, provider = 'atproto') {
  const popup = await context.newPage()
  await popup.goto(popupUrl)
  if (provider === 'github') await popup.getByRole('tab', { name: 'GitHub' }).click()
  else await popup.getByLabel('Login with Bluesky').fill('test.example')
  return popup
}

async function start(context: BrowserContext, popup: Page, provider = 'atproto') {
  await popup
    .getByRole('button', {
      name: provider === 'github' ? 'Continue with GitHub' : 'Login',
      exact: true,
    })
    .click()
  return providerTab(context)
}

async function providerTab(context: BrowserContext) {
  // Installation can open a welcome tab before the login tab.
  const findAuth = () =>
    context.pages().find((page) => page.url() === 'https://provider.example/authorize')
  await expect.poll(() => Boolean(findAuth())).toBe(true)
  const auth = findAuth()!
  await auth.waitForLoadState()
  return auth
}

async function stored(context: BrowserContext) {
  return context.serviceWorkers()[0]!.evaluate(async () => {
    const ext = globalThis as typeof globalThis & {
      chrome: {
        storage: {
          local: { get(keys: string[]): Promise<Record<string, unknown>> }
          session: { get(key: string): Promise<Record<string, unknown>> }
        }
      }
    }
    return {
      local: await ext.chrome.storage.local.get(['mustard_session', 'supabase_jwt']),
      transient: await ext.chrome.storage.session.get('mustard_tab_login'),
    }
  })
}

for (const linking of [false, true]) {
  test(`recovers partially saved ${linking ? 'account linking' : 'first login'}`, async ({
    context,
    popupUrl,
  }) => {
    const requests = await mockAuth(context)
    const popup = await context.newPage()
    await popup.goto(popupUrl)
    await context.serviceWorkers()[0]!.evaluate(
      async ({ userId, linking }) => {
        const ext = globalThis as typeof globalThis & {
          chrome: {
            storage: {
              local: { set(value: unknown): Promise<void> }
              session: { set(value: unknown): Promise<void> }
            }
            tabs: { create(value: unknown): Promise<{ id: number }> }
          }
        }
        const session = {
          userId,
          jwt: 'test-jwt',
          expiresAt: Math.floor(Date.now() / 1000) + 86400,
          refreshToken: 'test-refresh',
        }
        // State left after saving credentials but before saving fresh identities.
        await ext.chrome.storage.local.set({
          supabase_jwt: session,
          ...(linking
            ? {
                mustard_session: {
                  userId,
                  identities: [{ provider: 'github', providerAccountId: 'old' }],
                },
              }
            : {}),
        })
        const tab = await ext.chrome.tabs.create({ url: 'about:blank' })
        await ext.chrome.storage.session.set({
          mustard_tab_login: {
            pending: {
              tabId: tab.id,
              state: 'already-exchanged',
              request: { provider: 'github' },
              owner: linking ? userId : null,
              expiresAt: 0,
              phase: 'completing',
              session,
            },
            status: { status: 'finishing' },
          },
        })
      },
      { userId, linking },
    )
    // Exercise recovery through the real background message handler.
    await popup.evaluate(() =>
      (
        globalThis as typeof globalThis & {
          chrome: { runtime: { sendMessage(value: unknown): Promise<unknown> } }
        }
      ).chrome.runtime.sendMessage({ type: 'GET_OAUTH_LOGIN_STATUS' }),
    )
    await expect
      .poll(async () => (await stored(context)).transient)
      .toEqual({
        mustard_tab_login: { status: { status: 'idle' } },
      })
    expect((await stored(context)).local.mustard_session).toMatchObject({
      userId,
      identities: [{ provider: 'atproto', providerAccountId: 'did:plc:test' }],
    })
    expect(requests.filter((r) => r.action === 'list-identities')).toHaveLength(1)
    expect(requests.some((r) => r.action === 'initiate' || r.action === 'callback')).toBe(false)
    await popup.reload()
    await expect(popup.getByRole('button', { name: 'Logout', exact: true })).toBeVisible()
    await popup.getByRole('button', { name: 'Logout', exact: true }).click()
    await expect.poll(async () => (await stored(context)).local.supabase_jwt).toBeUndefined()
  })
}

for (const provider of ['atproto', 'github']) {
  test(`${provider}: completes after the popup closes, keeps credentials out of the callback page, and logs out`, async ({
    context,
    popupUrl,
  }) => {
    const requests = await mockAuth(context)
    const popup = await openLogin(context, popupUrl, provider)
    const auth = await start(context, popup, provider)
    await popup.close()
    const closed = auth.waitForEvent('close')
    await auth.goto(callbackUrl).catch(() => {}) // Extension may close the tab during navigation.
    await closed
    await expect
      .poll(async () => (await stored(context)).local.mustard_session)
      .toMatchObject({ userId })
    const initiate = requests.find((r) => r.action === 'initiate')!
    const complete = requests.filter((r) => r.action === 'callback')
    expect(complete).toHaveLength(1)
    expect(initiate).toEqual({
      action: 'initiate',
      provider,
      ...(provider === 'atproto' ? { handle: 'test.example' } : {}),
      redirect_uri: callback,
    })
    expect(complete[0]).toEqual({
      action: 'callback',
      provider,
      code: 'test-code',
      state,
      ...(provider === 'atproto' ? { iss: 'https://provider.example' } : {}),
      clientVersion: expect.any(String),
    })
    expect((await stored(context)).transient).toEqual({
      mustard_tab_login: { status: { status: 'idle' } },
    })
    const reopened = await context.newPage()
    await reopened.goto(popupUrl)
    await expect(reopened.getByRole('button', { name: 'Logout', exact: true })).toBeVisible()
    await reopened.getByRole('button', { name: 'Logout', exact: true }).click()
    await expect.poll(async () => (await stored(context)).local.supabase_jwt).toBeUndefined()
    expect(requests.some((r) => r.action === 'logout')).toBe(true)
  })
}

test('ignores another tab and wrong callback path, then accepts only its own callback', async ({
  context,
  popupUrl,
}) => {
  const requests = await mockAuth(context)
  // Reproduce CI timing: an unrelated tab opens before the provider tab.
  await context.route('**/functions/v1/auth-bridge', async (route) => {
    if (route.request().postDataJSON().action === 'initiate') {
      const welcome = await context.newPage()
      await welcome.setContent('<h1>Welcome</h1>')
    }
    await route.fallback()
  })
  const popup = await openLogin(context, popupUrl)
  const auth = await start(context, popup)
  const other = await context.newPage()
  await other.goto(callbackUrl)
  await auth.goto(`${callback}/wrong?code=test-code&state=${state}`)
  await expect(popup.getByRole('button', { name: 'Cancel sign-in' })).toBeVisible()
  expect(requests.filter((r) => r.action === 'callback')).toHaveLength(0)
  const closed = auth.waitForEvent('close')
  await auth.goto(callbackUrl).catch(() => {})
  await closed
  expect(other.isClosed()).toBe(false)
  expect(requests.filter((r) => r.action === 'callback')).toHaveLength(1)
})

for (const ending of ['close', 'cancel', 'wrong-state', 'provider-error', 'backend-error']) {
  test(`${ending}: clears pending login without creating a session`, async ({
    context,
    popupUrl,
  }) => {
    const requests = await mockAuth(context, { reject: ending === 'backend-error' })
    const popup = await openLogin(context, popupUrl)
    const auth = await start(context, popup)
    if (ending === 'close') await auth.close()
    else if (ending === 'cancel')
      await popup.getByRole('button', { name: 'Cancel sign-in' }).click()
    else
      await auth.goto(
        ending === 'wrong-state'
          ? callbackUrl.replace(state, 'wrong-state')
          : ending === 'provider-error'
            ? `${callback}?error=access_denied&state=${state}`
            : callbackUrl,
      )
    await expect
      .poll(async () => (await stored(context)).transient)
      .toMatchObject({
        mustard_tab_login: { status: { status: ending === 'cancel' ? 'idle' : 'failed' } },
      })
    expect((await stored(context)).local.supabase_jwt).toBeUndefined()
    expect(requests.filter((r) => r.action === 'callback')).toHaveLength(
      ending === 'backend-error' ? 1 : 0,
    )
  })
}

test('cancelling during exchange revokes the returned session without installing it', async ({
  context,
  popupUrl,
}) => {
  const completionGate = awaitable()
  const requests = await mockAuth(context, { completionGate })
  const popup = await openLogin(context, popupUrl)
  const auth = await start(context, popup)
  await expect(popup.getByRole('button', { name: 'Cancel sign-in' })).toBeVisible()
  await auth.goto(callbackUrl)
  await expect.poll(() => requests.some((r) => r.action === 'callback')).toBe(true)
  // Queue the popup's status reconciliation before cancellation while exchange waits.
  await popup.evaluate(() =>
    (
      globalThis as typeof globalThis & {
        chrome: { runtime: { sendMessage(value: unknown): Promise<unknown> } }
      }
    ).chrome.runtime.sendMessage({ type: 'GET_OAUTH_LOGIN_STATUS' }),
  )
  await popup.getByRole('button', { name: 'Cancel sign-in' }).click()
  completionGate.resolve()
  await expect
    .poll(async () => (await stored(context)).transient)
    .toEqual({ mustard_tab_login: { status: { status: 'idle' } } })
  expect((await stored(context)).local.supabase_jwt).toBeUndefined()
  expect(requests.some((r) => r.action === 'logout' && r.refreshToken === 'test-refresh')).toBe(
    true,
  )
})

for (const ending of ['cancel', 'close']) {
  test(`account linking keeps its replacement session after ${ending} during exchange`, async ({
    context,
    popupUrl,
  }) => {
    const completionGate = awaitable()
    const requests = await mockAuth(context, { completionGate, linking: true })
    await context.serviceWorkers()[0]!.evaluate(async (userId) => {
      const ext = globalThis as typeof globalThis & {
        chrome: { storage: { local: { set(value: unknown): Promise<void> } } }
      }
      await ext.chrome.storage.local.set({
        mustard_session: {
          userId,
          identities: [
            { provider: 'atproto', providerAccountId: 'did:plc:test', handle: 'test.example' },
          ],
        },
        supabase_jwt: {
          userId,
          jwt: 'old-jwt',
          refreshToken: 'old-refresh',
          expiresAt: Math.floor(Date.now() / 1000) + 86400,
        },
      })
    }, userId)
    const options = await context.newPage()
    await options.goto(popupUrl.replace('popup.html', 'options.html'))
    await options.getByRole('button', { name: 'Connect GitHub', exact: true }).click()
    const auth = await providerTab(context)
    await auth.goto(callbackUrl)
    await expect.poll(() => requests.some((r) => r.action === 'callback')).toBe(true)
    if (ending === 'close') await auth.close()
    else {
      // A cancellation message already in flight must be rejected, too.
      await options.evaluate(() => {
        const page = globalThis as typeof globalThis & {
          chrome: { runtime: { sendMessage(message: unknown): Promise<boolean> } }
          cancellation?: Promise<boolean>
        }
        page.cancellation = page.chrome.runtime.sendMessage({ type: 'CANCEL_OAUTH_LOGIN' })
      })
    }
    await expect(options.getByText('Finishing sign-in…')).toBeVisible()
    await expect(options.getByRole('button', { name: 'Cancel sign-in' })).toBeDisabled()
    completionGate.resolve()
    if (ending === 'cancel') {
      expect(
        await options.evaluate(
          () => (globalThis as typeof globalThis & { cancellation: Promise<boolean> }).cancellation,
        ),
      ).toBe(false)
    }
    await expect
      .poll(async () => (await stored(context)).local.supabase_jwt)
      .toMatchObject({
        jwt: 'test-jwt',
        refreshToken: 'test-refresh',
        userId,
      })
    await expect
      .poll(async () => (await stored(context)).transient)
      .toEqual({
        mustard_tab_login: { status: { status: 'idle' } },
      })
    expect((await stored(context)).local.mustard_session).toMatchObject({
      userId,
      identities: expect.arrayContaining([
        { provider: 'github', providerAccountId: '42', handle: 'test-github' },
      ]),
    })
    expect(requests.find((r) => r.action === 'callback')).toMatchObject({ currentJwt: 'old-jwt' })
    expect(requests.some((r) => r.action === 'logout')).toBe(false)
  })
}

for (const linking of [false, true]) {
  test(`credential write failure revokes the returned session during ${linking ? 'account linking' : 'first login'}`, async ({
    context,
    popupUrl,
  }) => {
    const requests = await mockAuth(context, { linking })
    const popup = await openLogin(context, popupUrl)
    if (linking) {
      await context.serviceWorkers()[0]!.evaluate(async (userId) => {
        const ext = globalThis as typeof globalThis & {
          chrome: { storage: { local: { set(value: unknown): Promise<void> } } }
        }
        await ext.chrome.storage.local.set({
          mustard_session: {
            userId,
            identities: [
              { provider: 'atproto', providerAccountId: 'did:plc:test', handle: 'test.example' },
            ],
          },
          supabase_jwt: {
            userId,
            jwt: 'old-jwt',
            refreshToken: 'old-refresh',
            expiresAt: Math.floor(Date.now() / 1000) + 86400,
          },
        })
      }, userId)
      await popup.goto(popupUrl.replace('popup.html', 'options.html'))
      await popup.getByRole('button', { name: 'Connect GitHub', exact: true }).click()
    } else {
      await start(context, popup)
    }
    const auth = await providerTab(context)
    // Fail only the initial JWT write, leaving the existing rollback APIs usable.
    await context.serviceWorkers()[0]!.evaluate(() => {
      const ext = globalThis as typeof globalThis & {
        chrome: { storage: { local: { set(value: Record<string, unknown>): Promise<void> } } }
      }
      const storage = ext.chrome.storage.local
      const set = storage.set.bind(storage)
      storage.set = async (value) => {
        if ('supabase_jwt' in value) {
          storage.set = set
          throw new Error('Test credential write failure')
        }
        return set(value)
      }
    })
    await auth.goto(callbackUrl)
    await expect
      .poll(async () => (await stored(context)).transient)
      .toMatchObject({
        mustard_tab_login: { status: { status: 'failed' } },
      })
    expect(requests.filter((r) => r.action === 'logout')).toEqual([
      { action: 'logout', refreshToken: 'test-refresh' },
    ])
    expect((await stored(context)).local).toEqual({})
    expect(requests.some((r) => r.action === 'list-identities')).toBe(false)
    await popup.goto(popupUrl)
    await expect(popup.getByRole('button', { name: 'Login', exact: true })).toBeVisible()
  })
}

test('cache cleanup failure rolls back the installed login', async ({ context, popupUrl }) => {
  const requests = await mockAuth(context)
  const popup = await openLogin(context, popupUrl)
  const auth = await start(context, popup)
  // Inject a single storage failure in the real background completion handler.
  await context.serviceWorkers()[0]!.evaluate(() => {
    const ext = globalThis as typeof globalThis & {
      chrome: { storage: { session: { remove(key: string): Promise<void> } } }
    }
    const storage = ext.chrome.storage.session
    const remove = storage.remove.bind(storage)
    storage.remove = async (key) => {
      if (key === 'mustard-remote-index-cache') {
        storage.remove = remove
        throw new Error('Test cache cleanup failure')
      }
      return remove(key)
    }
  })
  await auth.goto(callbackUrl)
  await expect
    .poll(async () => (await stored(context)).transient)
    .toMatchObject({
      mustard_tab_login: { status: { status: 'failed' } },
    })
  expect((await stored(context)).local).toEqual({})
  expect(requests.some((r) => r.action === 'logout' && r.refreshToken === 'test-refresh')).toBe(
    true,
  )
  await popup.reload()
  await expect(popup.getByRole('button', { name: 'Login', exact: true })).toBeVisible()
})

test('finishing sign-in disables Cancel and rejects a late cancellation request', async ({
  context,
  popupUrl,
}) => {
  const identitiesGate = awaitable()
  const requests = await mockAuth(context, { identitiesGate })
  const popup = await openLogin(context, popupUrl)
  const auth = await start(context, popup)
  await auth.goto(callbackUrl)
  await expect.poll(() => requests.some((r) => r.action === 'list-identities')).toBe(true)
  await expect(popup.getByText('Finishing sign-in…')).toBeVisible()
  await expect(popup.getByRole('button', { name: 'Cancel sign-in' })).toBeDisabled()

  // Bypass the disabled UI to exercise a click/message already in flight.
  await popup.evaluate(() => {
    const page = globalThis as typeof globalThis & {
      chrome: { runtime: { sendMessage(message: unknown): Promise<boolean> } }
      lateCancellation?: Promise<boolean>
    }
    page.lateCancellation = page.chrome.runtime.sendMessage({ type: 'CANCEL_OAUTH_LOGIN' })
  })
  identitiesGate.resolve()
  expect(
    await popup.evaluate(
      () =>
        (globalThis as typeof globalThis & { lateCancellation: Promise<boolean> }).lateCancellation,
    ),
  ).toBe(false)
  await expect(popup.getByRole('button', { name: 'Logout', exact: true })).toBeVisible()
  expect((await stored(context)).local.mustard_session).toMatchObject({ userId })
  expect(requests.some((r) => r.action === 'logout')).toBe(false)
})
