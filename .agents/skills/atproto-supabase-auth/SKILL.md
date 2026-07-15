---
name: atproto-supabase-auth
description: >-
  Multi-provider OAuth (Bluesky/AT Protocol + GitHub) and Supabase auth
  architecture for the Mustard extension. Covers the BFF auth-bridge pattern,
  the UUID account model + identities table, account linking/unlinking,
  opaque-token constraints, DPoP/PKCE/PAR, identity verification, Supabase JWT
  minting + refresh + logout, and legacy DID migration. Use when working on
  login/logout, account linking, the auth-bridge edge function, SupabaseAuth,
  JWT handling, OAuth redirect flows, or session broadcasting.
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
    Bridge->>AS: PAR request + DPoP proof
    AS-->>Bridge: {request_uri}
    Bridge->>DB: Store state, code_verifier, DPoP keys
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
    Bridge->>AS: Token exchange + DPoP proof + PKCE verifier
    AS-->>Bridge: {access_token, refresh_token, sub: DID}
    Bridge->>Bridge: Verify DID→PDS→AS matches issuer
    Bridge->>DB: Upsert identity → users.id (UUID);<br/>link to current JWT's user if linking
    Bridge->>DB: Store oauth_session (tokens, DPoP keys, user_id)
    Bridge->>Bridge: Mint Supabase JWT (sub: UUID)
    Bridge-->>SW: {jwt, expiresAt, userId, did}

    SW->>SW: Cache JWT, sync identities, broadcast SESSION_CHANGED
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

## Gotchas

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
- `refresh` — mint a fresh JWT for the UUID; for atproto also refresh the
  upstream token. Verifies `payload.sub === userId` and looks up `oauth_session`
  by `user_id`. GitHub classic OAuth tokens don't expire, so refresh just
  re-mints the JWT.
- `list-identities` — all identities for the JWT's user (options "Connected
  Accounts").
- `disconnect` — unlink a provider; deletes the account if it was the last.
- `resolve-identities` — UUIDs → linked identities (used by `GET_PROFILES` and
  mention-actor enrichment to turn author/actor UUIDs into bsky/github profiles).
- `resolve-accounts` — reverse: provider account ids → Mustard userId.
- `github-mention-candidates` — your GitHub follows who are also Mustard users
  (the only github accounts that can be @-mentioned).

## Supabase JWT lifecycle

- `SupabaseAuth.ts` caches the JWT (`{ jwt, userId, expiresAt }`) with a 1h TTL;
  refresh goes through auth-bridge using the expired JWT as proof.
- **Refresh 4xx/502 = logout**: a non-transient refresh failure means the
  server-side session is gone — clear the stored session + JWT and broadcast
  `SESSION_CHANGED(null)` + `SESSION_EXPIRED`. **Do NOT clear on other 5xx**
  (transient server errors).
- **Legacy DID sessions/caches** (pre multi-provider migration) have a DID where
  the UUID should be. Migration `011` did `DELETE FROM oauth_session`, so there
  is nothing to refresh against and AT Protocol re-auth is interactive-only —
  **a silent re-login is impossible**. `getSupabaseJwt()` detects a `did:`-prefixed
  `session.userId`, and `getCachedJwt()` rejects a `did:`/`userId`-less cache;
  both wipe local creds and fire `SESSION_EXPIRED` to force a one-time re-login.
- `SESSION_CHANGED` is broadcast to all tabs on login/logout so content scripts
  re-query notes without a page reload.

## Auth-related tables

- `users`: opaque account UUID (the JWT subject).
- `identities`: `(user_id, provider, provider_account_id, handle)` — the only
  place provider ids live; unique on `(provider, provider_account_id)`.
- `oauth_login_state`: temporary PAR/PKCE/DPoP state during login (~10 min TTL);
  `provider` column distinguishes atproto vs github.
- `oauth_session`: server-side token storage for refresh, PK
  `(provider, provider_account_id)` + `user_id` FK. atproto-only columns
  (DPoP keys, `token_endpoint`) are nullable so github rows can omit them.
