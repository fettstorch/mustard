---
name: atproto-supabase-auth
description: >-
  Multi-provider OAuth (Bluesky/AT Protocol + GitHub) and Supabase auth
  architecture for the Mustard extension. Covers the BFF auth-bridge pattern,
  the UUID account model + identities table, account linking/unlinking,
  opaque-token constraints, DPoP/PKCE/PAR, the atproto confidential-client
  upgrade (private_key_jwt), identity verification, short-lived Supabase JWTs
  backed by rotating server-side refresh tokens (mustard_sessions), session
  revocation, and legacy migration. Use when working on login/logout, account
  linking, the auth-bridge edge function, SupabaseAuth, JWT/refresh-token
  handling, OAuth redirect flows, or session broadcasting.
---

# Multi-Provider OAuth + Supabase Auth (BFF)

Mustard authenticates users via OAuth (Bluesky/AT Protocol and GitHub) and mints
Supabase JWTs server-side. A Mustard account is an **opaque UUID** that can link
multiple provider identities. Read this before touching `auth-bridge`,
`SupabaseAuth`, `AtprotoAuth`, `GithubAuth`, or anything that handles
sessions/JWTs/account linking.

## Account model (UUID-always)

- A Mustard user is a `users.id` **UUID** that never encodes a provider id.
- All provider-specific ids (atproto DID, GitHub numeric id) live only in the
  `identities` table: `(user_id, provider, provider_account_id, handle)`, unique
  on `(provider, provider_account_id)`. It is the authoritative map from an
  external account → Mustard user, used by login, follow resolution, mentions.
- The **JWT subject is the UUID** (`sub = users.id`), never a DID. All DB rows
  (notes/comments/reposts/notifications authorship) are keyed by the UUID.
- The client session (`AtprotoAuth.StoredSession`) is `{ userId, identities[] }`;
  everything display-related (primary provider, handle, atproto DID) is derived
  from `identities`, never stored separately.

## Linking vs. new account

- **First login** (no session): auth-bridge creates a `users` row + first
  `identities` row, returns the UUID.
- **Linking** (already logged in): the client passes its **current JWT** to the
  `callback`; auth-bridge attaches the new identity to that UUID instead of
  creating a new account. If the JWT is missing/expired the client must abort
  (otherwise a new account is forked) — the options page enforces this.
- **Unlinking** (`disconnect`): removes one identity; removing the **last**
  identity deletes the whole account + all its content (delete-account RPC),
  then best-effort removes any now-unreferenced globally shared link-preview
  thumbnails. Thumbnail paths are captured before the authoritative DB
  transaction; cleanup happens afterward so a Storage outage cannot leave a
  half-deleted account or remove an object referenced by another author.

## Why BFF (Backend For Frontend) is mandatory

- **ATProto access tokens are opaque**: the JWKS endpoint
  (`bsky.social/oauth/jwks`) returns `{"keys":[]}` — third parties cannot verify
  access-token signatures. This rules out "pass the access token to your backend
  for verification" designs.
- Because tokens can't be independently verified, **the server must be the OAuth
  client**. The `auth-bridge` Edge Function handles PAR, DPoP, PKCE, and token
  exchange; the extension only opens the auth page and forwards the callback.
- **`@atproto/oauth-client-browser` is not needed** with BFF (it's for client-side
  OAuth). The extension just `fetch`es `auth-bridge` and uses
  `browser.identity.launchWebAuthFlow()` for the redirect — no client-side OAuth
  SDK.

## OAuth flow (sequence)

```mermaid
sequenceDiagram
    participant User
    participant Popup as Extension Popup
    participant SW as Service Worker
    participant Bridge as auth-bridge<br/>(Edge Function)
    participant DB as Supabase DB
    participant Chrome as browser.identity
    participant AS as Authorization Server<br/>(bsky.social)

    User->>Popup: Enter handle, click Login
    Popup->>SW: ATPROTO_LOGIN message

    Note over SW,AS: Step 1: Initiate (server-side)
    SW->>Bridge: POST {action: "initiate", handle}
    Bridge->>AS: Resolve handle→DID→PDS→AS
    Bridge->>Bridge: Generate DPoP keypair + PKCE
    Bridge->>Bridge: Sign client assertion (private_key_jwt, aud=AS issuer)
    Bridge->>AS: PAR request + DPoP proof + client assertion
    AS-->>Bridge: {request_uri}
    Bridge->>DB: Store state, code_verifier, DPoP keys, as_issuer
    Bridge-->>SW: {authUrl, state}

    Note over SW,AS: Step 2: User Authentication
    SW->>Chrome: launchWebAuthFlow({url: authUrl})
    Chrome->>AS: Open auth page
    User->>AS: Enter credentials, approve
    AS->>Chrome: Redirect with ?code&state&iss
    Chrome-->>SW: Return callback URL

    Note over SW,AS: Step 3: Callback (server-side)
    SW->>Bridge: POST {action: "callback", code, state, iss}
    Bridge->>DB: Look up state → code_verifier, DPoP keys
    Bridge->>Bridge: Sign client assertion (aud=AS issuer)
    Bridge->>AS: Token exchange + DPoP proof + PKCE verifier + client assertion
    AS-->>Bridge: {access_token, refresh_token, sub: DID}
    Bridge->>Bridge: Verify DID→PDS→AS matches issuer
    Bridge->>DB: Upsert identity → users.id (UUID);<br/>link to current JWT's user if linking
    Bridge->>DB: Store oauth_session (tokens, DPoP keys, as_issuer, user_id)
    Bridge->>DB: createSession() → mustard_sessions row (hashed refresh token)
    Bridge->>Bridge: Mint Supabase JWT (sub: UUID, sid: session id, 24h TTL)
    Bridge-->>SW: {jwt, expiresAt, refreshToken, userId, did}

    SW->>SW: Cache {jwt, refreshToken}, sync identities, broadcast SESSION_CHANGED
    SW-->>Popup: {userId, did}
    Popup->>User: Show "Logged in"
```

GitHub login is the same shape minus DPoP/PAR/identity-verification (standard
OAuth code exchange in `handleGithubInitiate`/`handleGithubCallback`); it ends
with the same identity-upsert → UUID → JWT mint.

## Key components

- **auth-bridge (BFF)**: server-side OAuth client. Holds DPoP keys + ATProto
  tokens; the extension never sees them. Mints Supabase JWTs only after a verified
  login.
- **client-metadata.json** (GitHub Pages, public HTTPS): the OAuth client config.
  Its URL **is** the `client_id`. `redirect_uris` must include the
  `chromiumapp.org` URL (and the Firefox `allizom.org` URL). Add an empty
  `.nojekyll` so GitHub Pages serves it without a Jekyll build. **Don't host it on
  Supabase**: Storage serves `.html`/files as `text/plain`, and Edge Functions
  intentionally rewrite `text/html` → `text/plain` (APIs only) — use GitHub Pages
  / Cloudflare Pages / similar static hosting.
- **redirect_uri**: Chrome → `chromiumapp.org`; Firefox →
  `https://<sha1(gecko.id)>.extensions.allizom.org/<path>` (see
  `cross-browser-webext` skill for deriving these).
- **PKCE**: prevents auth-code interception. **PAR**: pushes auth params to the AS
  before redirect (required by AT Protocol). **DPoP**: binds tokens to
  server-held keys.
- **Identity verification**: after token exchange, auth-bridge independently
  resolves DID→PDS→AS to confirm the AS is authoritative for that DID — without
  it, a malicious AS could claim to authenticate any DID.
- **Confidential client (`client-assertion.ts`)**: after the one-time rollout,
  auth-bridge is registered as a confidential client (`client-metadata.json` sets
  `token_endpoint_auth_method: "private_key_jwt"` + a `jwks`), so every PAR,
  token-exchange, and refresh call to an atproto AS carries a `private_key_jwt`
  assertion signed with `ATPROTO_CLIENT_PRIVATE_JWK` (an ES256 keypair, `aud` =
  the AS issuer). This is what makes the confidential-client's longer upstream
  atproto session lifetime (vs. 2 weeks for a public client) available — needed
  because Mustard's atproto session outlives auth (e.g. future PDS writes), not
  just for login. Distinct from DPoP: DPoP proves possession of a per-session
  key; the client assertion proves _auth-bridge itself_, reused across every
  user's session. See `specs/atproto-auth/sketch.md` for the full rationale.
  Before that rollout, production `client-metadata.json` deliberately remains
  public; `client-metadata.confidential.json` holds the staged replacement.
  Merging the code does not publish the extension. Cut over auth-bridge and the
  metadata first, verify the live metadata plus a real Bluesky login, and only
  then publish v2.9; the old backend cannot return the refresh-token response
  shape that v2.9 expects.

## Gotchas

- **Keep the two refresh-token layers distinct**: the Mustard refresh token is
  an opaque client-side credential for rotating short-lived Supabase JWTs;
  the ATProto OAuth refresh token stays server-side in `oauth_session` and
  refreshes the user's upstream Bluesky session. Client-version compatibility
  and rollout claims must say explicitly which token they concern.
- **Persist a rotated upstream token before success**: an ATProto refresh can
  replace the prior refresh token. Retry a transient `oauth_session` write
  while the replacement is still in memory; if it cannot be stored, fail the
  request rather than claim a successful migration with a stale credential.
- **Keep rollout artifacts synchronized**: when auth behavior, compatibility
  gates, deployment ordering, or test scaffolding changes, update the PR rollout
  description, `specs/atproto-auth/sketch.md`, `cleanup.md`, and the cutover
  script wherever they are affected. Do not leave the executable rollout and
  its operational documentation describing different states.
- **DPoP nonce retry**: the AS rejects the first DPoP-signed request with
  `use_dpop_nonce` and returns the nonce in a header. Standard pattern: send with
  empty nonce, retry with the server-provided nonce.
- **Extension ID stability**: redirect URIs break if the extension ID changes.
  Pin Chrome via `manifest.key` and Firefox via `gecko.id` (see
  `cross-browser-webext` skill).
- **Popup closes during OAuth**: extension popups close when `launchWebAuthFlow`
  opens (loses focus). Run OAuth in the **service worker** (persists) and
  communicate via messaging.

## auth-bridge actions (provider-agnostic)

One Edge Function, routed by `body.action` (legacy callers omit `provider` →
default atproto):

- `initiate` / `callback` — OAuth login or linking (atproto + github).
- `refresh` — dual path, dispatched on the request shape (`handleRefresh` in
  `index.ts`):
  - **v2** (`{ refreshToken }`): rotate the mustard session (`rotateSession`)
    and mint a new 24h JWT. Routine Mustard rotation is deliberately independent
    of upstream atproto refresh; future PDS operations refresh upstream only
    when they actually need it.
  - **legacy** (`{ userId, expired_jwt }`, no `refreshToken`): one-time
    exchange for a pre-overhaul cache that predates refresh tokens — verifies
    JWT (`clockTolerance` generous enough to cover the old 180-day TTL) and
    mints a brand-new session. v2.9 prioritizes this exchange over its valid-JWT
    fast path, so a JWT-only cache upgrades on its first authenticated call even
    when the old JWT is still far from expiry. See
    `specs/atproto-auth/cleanup.md` for when this path can be deleted.
- `logout` — `{ refreshToken }`; revokes the mustard session
  (`revokeSession`/`mustard_sessions` row). Idempotent, always `200`.
- `list-identities` — all identities for the JWT's user (options "Connected
  Accounts").
- `disconnect` — unlink a provider; deletes the account if it was the last.
- `resolve-identities` — UUIDs → linked identities (used by `GET_PROFILES` and
  mention-actor enrichment to turn author/actor UUIDs into bsky/github profiles).
- `resolve-accounts` — reverse: provider account ids → Mustard userId.
- `github-mention-candidates` — your GitHub follows who are also Mustard users
  (the only github accounts that can be @-mentioned).

## Supabase JWT lifecycle

The Supabase JWT is now a **thin, short-lived capability** (24h TTL, `sid`
claim = a `mustard_sessions.id`), not a long-lived credential in its own right.
The actual session — revocable, rotating — lives server-side in
`mustard_sessions`, keyed by a hashed opaque refresh token. This replaced the
old model (still relevant for understanding old code/data: JWTs with a 180-day
TTL, "refreshed" by re-verifying the same JWT with a huge clock tolerance).

- `SupabaseAuth.ts` caches `{ jwt, userId, expiresAt, refreshToken }`. Within
  60s of `expiresAt` it calls `refresh` with the cached `refreshToken`
  (`sessions.ts`'s `rotateSession`) and stores the **new** rotated pair —
  every refresh invalidates the previous refresh token.
- **Rotation grace window**: `rotateSession` accepts the _immediately previous_
  token hash for 10 minutes after rotation (`prev_token_hash`/`prev_valid_until`
  in `mustard_sessions`), so a service-worker restart racing an in-flight
  refresh doesn't strand the caller. A token more than one rotation old is
  always rejected, regardless of elapsed time.
- **`sid` enforces logout for account actions**: v2.9 JWTs carrying a `sid`
  must still match a live, unexpired `mustard_sessions` row before auth-bridge
  permits account actions (including identity linking). A signed JWT alone
  cannot attach an identity or otherwise revive a logged-out session during its
  remaining 24-hour lifetime. Sid-less pre-v2.9 JWTs remain compatible only for
  the rollout window.
- **Concurrency**: `getSupabaseJwt()` is wrapped in `synchronize()` (from
  `@fettstorch/jule`) so concurrent callers share one in-flight refresh instead
  of racing to rotate the same token.
- **Refresh 4xx/502 = logout**: a non-transient refresh failure means the
  server-side session is gone — clear the stored session + JWT and broadcast
  `SESSION_CHANGED(null)` + `SESSION_EXPIRED`. **Do NOT clear on other 5xx**
  (transient server errors) — keep the (now-unusable-until-retry) credentials
  and let the next call retry.
- **Logout is explicit**: `revokeSupabaseSession()` (not `clearSupabaseJwt`,
  which is module-private) posts `{ action: "logout", refreshToken }` to
  auth-bridge to delete the server-side row, then clears local state — so a
  stolen/cached refresh token can't outlive an intentional logout. Always
  clears local state even if the network call fails.
- **Legacy migration (one-time, no forced re-login)**: a cache from before this
  overhaul has `{ jwt, userId, expiresAt }` with **no `refreshToken`**.
  `getSupabaseJwt()` detects that shape before its valid-JWT fast path and
  immediately calls `refresh` with
  `{ userId, expired_jwt }` instead of `{ refreshToken }` — the one-time legacy
  exchange (`handleLegacyExchange` in auth-bridge) mints a real session from the
  old JWT alone. After that one exchange the cache is steady-state
  (`refreshToken` present) and never hits this branch again. See
  `specs/atproto-auth/cleanup.md` for the removal plan/gates.
- **Legacy DID sessions/caches** (pre multi-provider migration, older than the
  above) have a DID where the UUID should be. Migration `011` did
  `DELETE FROM oauth_session`, so there is nothing to refresh against and AT
  Protocol re-auth is interactive-only — **a silent re-login is impossible**.
  `getSupabaseJwt()` detects a `did:`-prefixed `session.userId`, and
  `getCachedJwt()` rejects a `did:`/`userId`-less cache; both wipe local creds
  and fire `SESSION_EXPIRED` to force a one-time re-login.
- `SESSION_CHANGED` is broadcast to all tabs on login/logout so content scripts
  re-query notes without a page reload.

## Auth-related tables

- `users`: opaque account UUID (the JWT subject).
- `identities`: `(user_id, provider, provider_account_id, handle)` — the only
  place provider ids live; unique on `(provider, provider_account_id)`.
- `oauth_login_state`: temporary PAR/PKCE/DPoP state during login (~10 min TTL);
  `provider` column distinguishes atproto vs github.
- `oauth_session`: server-side upstream-provider token storage for refresh, PK
  `(provider, provider_account_id)` + `user_id` FK. atproto-only columns
  (DPoP keys, `token_endpoint`, `as_issuer`) are nullable so github rows can
  omit them. `as_issuer` (migration `021`) is the AS issuer URL, needed at
  refresh time (not just callback time) as the client assertion's `aud`. Rows
  predating migration `021` start with `as_issuer = NULL`; `refreshAtprotoToken`'s
  `resolveAsIssuer()` derives it via AS discovery and persists it lazily on
  first refresh (no bulk backfill) — this is load-bearing, not an
  optimization: the reference AS (`@atproto/oauth-provider`, run by
  `bsky.social`) checks every request's auth method against the _live_
  client-metadata document, so a session can't skip the client assertion just
  because it predates the confidential-client upgrade.
- `mustard_sessions` (migration `020`): Mustard's **own** session, independent
  of provider. PK `id` (== the JWT's `sid` claim), `user_id` FK, a hashed
  opaque refresh token (`refresh_token_hash`, never the raw token), a one-
  generation-back `prev_token_hash`/`prev_valid_until` for the rotation grace
  window, and a sliding `expires_at` (90d from `createSession`, or from every
  `rotateSession`). Service-role only, no client-facing RLS policy.
