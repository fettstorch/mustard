# Testing

## Layers

| Layer             | Command            | What it proves                                                |
| ----------------- | ------------------ | ------------------------------------------------------------- |
| **Type check**    | `nr type-check`    | TypeScript compiles cleanly                                   |
| **Lint**          | `nr lint`          | oxlint rules pass (read-only)                                 |
| **Format**        | `nr format:check`  | oxfmt formatting is consistent                                |
| **Dead code**     | `nr knip`          | No unused exports, files, or deps                             |
| **Unit tests**    | `nr test`          | Pure logic is correct without a browser                       |
| **Chrome build**  | `nr build`         | Extension bundles without errors                              |
| **Firefox build** | `nr build:firefox` | Firefox variant bundles cleanly                               |
| **Firefox lint**  | `nr lint:firefox`  | Mozilla package checks find no blocking errors                |
| **E2E smoke**     | `nr test:e2e`      | Extension loads in real Chromium, popup + content script work |

Run everything in one shot (except E2E):

```sh
nr check
```

## Unit tests (Vitest)

Uses WXT's official Vitest integration (`WxtVitest` plugin) with in-memory WebExtension APIs (`fakeBrowser`). No real browser needed.

```sh
nr test        # run once
nr test:watch  # watch mode while developing
```

Test files live under `test/`, mirroring the source path they cover:

- `src/shared/version.ts` — semver comparison + outdated guard
- `src/shared/remote-mutation.ts` — which messages mutate remote state
- `src/background/business/service/MustardNotesServiceLocal.ts` — create / query / update / delete / index persistence

## Extension E2E smoke tests (Playwright + Chromium)

Loads the **built** extension from `dist/chrome` in a persistent Chromium context.
The tests serve their deterministic fixture page through Vite; they never contact
the Mustard backend or an OAuth provider.

```sh
nlx playwright install chromium # once per machine / Playwright version
nr build:e2e                     # build the Chrome extension
nr test:e2e                      # run the smoke suite
```

Tests:

- **`test/e2e/popup.spec.ts`** — popup renders Bluesky/GitHub login tabs, tab switching works
- **`test/e2e/local-note.spec.ts`** — content script injects, captures a synthetic context-menu anchor, saves a local note, and restores it after reload

> **No auth required.** The smoke suite never talks to Supabase, Bluesky, or GitHub. Local note storage uses `browser.storage.local` which works in the real extension context.

## Firefox package checks

`nr lint:firefox` runs Mozilla's `addons-linter` on the Firefox build in
`dist/firefox`. It validates the packaged extension metadata and scans the bundle
for AMO-relevant problems. It complements oxlint, which checks the source code.

The current Vue-generated bundle produces four `UNSAFE_VAR_ASSIGNMENT` warnings
for framework `innerHTML` code. The command fails on errors but reports those
warnings without treating them as release blockers.

### Failure artifacts

Playwright writes `playwright-report/` and `test-results/`; both are generated
and gitignored. On CI failure, `playwright-report` is uploaded for seven days.

Locally, inspect the report with:

```sh
npx playwright show-report
```

## Phase 2 (not yet implemented): Authenticated E2E

The plan for adding authenticated E2E without automating real provider login pages:

1. **Start local Supabase** — `supabase start && supabase functions serve`
2. **Seed a test user** — insert a row into `auth.users` + `public.accounts` with a known UUID
3. **Mint a local-only JWT** — sign with the local Supabase JWT secret (visible in `supabase status`)
4. **Seed extension storage** — before the test, inject the JWT into `browser.storage.local` via `context.addInitScript` or a Playwright fixture
5. **Run authenticated flows** — QUERY_NOTES, UPSERT_NOTE (remote), publish, comment

This approach never touches production and never automates OAuth redirects on bsky.social or github.com.
