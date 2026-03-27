# Development Progress

This document tracks the current implementation status of Mustard features. Compare against `README.md` to see what's completed vs. what's still needed.

## Architecture

```mermaid
flowchart TB
    subgraph User["User Actions"]
        Click["Click extension icon"]
        RightClick["Right-click element"]
    end

    subgraph Extension["Mustard Extension"]
        Popup["Popup Menu"]
        Options["Options Page"]
        BG["Background Service Worker"]
        CS["Content Script"]
        CtxMenu["Context Menu"]
        NoteEditor["Note Editor"]
    end

    subgraph Business["Business Logic"]
        Manager["MustardNotesManager"]
        ServiceInterface["MustardNotesService"]
        LocalService["MustardNotesServiceLocal"]
        RemoteService["MustardNotesServiceRemote"]
        ProfileService["MustardProfileServiceBsky"]
    end

    subgraph Storage["Storage"]
        ChromeStorage[("chrome.storage.local")]
        Supabase["Supabase Edge Functions"]
        DB[("Supabase PostgreSQL")]
    end

    subgraph DTOs["DTOs"]
        DtoNote["DtoMustardNote"]
        DtoIndex["DtoMustardIndex"]
    end

    subgraph Page["Web Page"]
        Elements["Page Elements"]
        Notes["Injected Notes"]
    end

    Click -->|"opens"| Popup
    Popup -->|"gear icon"| Options
    RightClick -->|"opens"| CtxMenu
    CtxMenu -->|"opens"| NoteEditor

    CS <-->|"QUERY_NOTES / UPSERT_NOTE / DELETE_NOTE / GET_PROFILES"| BG
    BG --> Manager
    BG --> ProfileService
    ProfileService -->|"app.bsky.actor.getProfiles"| BSkyAPI["bsky.social API"]
    Manager --> ServiceInterface
    ServiceInterface --> LocalService
    ServiceInterface --> RemoteService

    LocalService <-->|"serialize via"| DtoNote
    LocalService <-->|"serialize via"| DtoIndex
    LocalService <--> ChromeStorage

    RemoteService -->|"fetch"| Supabase
    Supabase --> DB

    CS -->|"DOM injection"| Notes
    Notes -->|"anchored to"| Elements

```

## Completed

- Chrome extension setup with CRXJS and HMR working
- Extension icon (mustard bottle) displays in Chrome toolbar
- MustardPopupMenu accessible via extension icon click
- MustardOptionsPage accessible via chrome://extensions → Options
- Background service worker initialized
- Content script initialized (runs on all URLs)
- Context menu "Add Mustard" appears on right-click, handled in service worker
- Gear icon in popup menu opens options page
- Tailwind v4 configured via `@tailwindcss/vite`, imported in popup & options entry points
- Editor positioned at click location using anchor data (elementId → elementSelector → clickPosition fallback)
- Anchor data captured: pageUrl, elementId, elementSelector, relativePosition, clickPosition
- Type-safe messaging in `src/shared/messaging.ts`
- Reactive mustardState shared via provide/inject
- Positioning logic centralized in MustardContent, child components stay dumb
- UI folder reorganized: content script components in `src/ui/content/`
- Modular content styles in `content-styles.css` (mustard-plastic, mustard-rounded, mustard-text-\*, mustard-padding)
- Note Editor styled with mustard bottle aesthetic
- `MustardNotesService` interface: `queryIndex(userId)`, `queryNotes(pageUrl, userId)`, `upsertNote`, `deleteNote`
- `MustardNotesServiceLocal` implementation using chrome.storage.local
- DTOs for serialization: `DtoMustardNote`, `DtoMustardIndex` with `toDto`/`fromDto` mappers
- `MustardNote` model with `authorId`, `MustardIndex` class with follows/merge support
- `MustardNotesManager` coordinates services, merges indexes from multiple services
- Service worker ↔ content script: `QUERY_NOTES`, `UPSERT_NOTE`, `DELETE_NOTE` messaging via sendResponse
- Notes persisted to chrome.storage.local and retrieved on page load
- DTOs moved to `src/shared/dto/` for access by both background and content scripts
- `MustardNote.vue` component renders notes at anchor positions with date footer
- Notes injected into pages via MustardContent, positioned using anchor data
- Delete note: trash icon removes note, re-queries fresh list (re-query pattern for mutations)
- Clean DTO boundary: messaging uses DTOs, content-script converts to domain models for Vue
- Note positions recalculate on window resize
- AT Protocol OAuth login via Bluesky working (popup → auth → session)
- `MustardProfileService` interface + `MustardProfileServiceBsky` implementation using `@atproto/api`
- `UserProfile` model with type discriminator, `BskyProfile` satisfies it
- Popup displays user avatar, display name, and @handle when logged in
- Profile fetching via service worker `GET_PROFILES` message (bulk fetch using `app.bsky.actor.getProfiles`)
- Notes auto-select `authorId` based on session (DID if logged in, `'local'` otherwise)
- Service routing stubbed: `upsertNote(note, 'local' | 'remote')` with fallback to local until remote implemented
- `MustardNotesManager` acts as facade: always queries local, merges remote when logged in (remote stubbed)
- `currentUserDid` in content script state for note ownership checks (`authorId === 'local' || authorId === currentUserDid`)
- Note icons: publish arrow for local notes, cloud checkmark for remote notes (edit icon removed)
- Editor has Save (local) and Publish (remote) buttons; publish opens login popup if not authenticated
- `MustardNotesServiceRemote` implementation using Supabase client + Edge Functions
- Supabase Edge Functions: `auth-bridge` (BFF OAuth + JWT minting), `get-index` (fetches follows + notes index)
- Auth-bridge BFF pattern: server-side ATProto OAuth (handle→DID→PDS→AS resolution, DPoP key management, PKCE, PAR, token exchange, identity verification) — Supabase JWTs only minted after verified login
- `oauth_login_state` table: temporary PAR/PKCE/DPoP state during login (~10 min TTL)
- `oauth_session` table: server-side ATProto token storage for JWT refresh
- `SupabaseAuth.ts`: JWT caching with 1h TTL, refresh via auth-bridge using expired JWT as proof
- Remote index caching with 30s TTL, invalidated on login/logout/mutations
- Session broadcast: `SESSION_CHANGED` message to all tabs on login/logout
- Content scripts re-query notes when session changes (no page reload needed)
- SPA navigation detection via injected `url-change-detector.js` (intercepts pushState/replaceState)
- Notes cleared and re-queried when URL changes (works on Bluesky and other SPAs)
- `pendingNoteIds` state disables action buttons while syncing
- Published icon rendered as static (non-interactive) indicator
- Publish flow: local note kept visible until remote publish confirmed, then deleted
- Notes draggable: click and drag anywhere on note to reposition (temporary, not persisted)
- Remote notes display author avatar (clickable link to their Bluesky profile)
- Rich content in notes: URLs auto-detected and rendered as inline images (png/jpg/jpeg/gif/webp) or clickable links
- Images constrained to note width (260px max), non-draggable, don't interfere with note dragging
- CSP configured to allow loading images from HTTPS sources
- Security limits enforced: content (300 chars), selectors (500 chars), page URLs (2000 chars)
- Multi-layer validation: client-side (selector generation), UI (disabled buttons), service layer, database constraints
- Character counter in editor (subtle date-style display, turns red when over limit)
- Oversized local notes show character count and disable publish button (local saves unrestricted)
- Selector length validation returns `null` for fallback to click position
- Database migration files: 001 (table structure), 002 (CHECK constraints), 003 (OAuth tables)
- Notes use fixed positioning + scroll listeners: anchor to elements without affecting page layout or causing scrollbars
- Note rendering: `white-space: pre-wrap` removed from `.mustard-note-content` (was causing markdown-it's inter-tag `\n` to render as visible blank lines)
- Note rendering: empty/whitespace-only `<p>` tags stripped from markdown-it output via `EMPTY_P_REGEX` (CSS `p:empty` missed `<p>\n</p>`)
- Note content trimmed before render and before save to prevent trailing newlines creating phantom `<br>` elements
- `knip` added as devDep with `knip.json` config; `nr knip` / `nr knip:fix` scripts available for dead code detection
- Context invalidation detection: app unmounts and shows refresh banner when extension is reloaded while a tab is open
- Content script icons inlined as base64 data URIs via `inlineIcons` Vite plugin (bypasses host page `img-src` CSP in both dev and prod)
- Minimize notes: global preference (popup toggle + options checkbox), persisted via `chrome.storage.local`; notes collapse to small pills showing avatar/gradient corner, expand on hover with staggered width→height animation
- Show anchor in editor: options page checkbox (default off), controls whether anchor data (URL + selector) is displayed in the note editor
- Options page preferences synced to content scripts via `chrome.storage.onChanged` (same pattern as publish warning)

## AT Protocol OAuth Flow (BFF Pattern)

```mermaid
sequenceDiagram
    participant User
    participant Popup as Extension Popup
    participant SW as Service Worker
    participant Bridge as auth-bridge<br/>(Edge Function)
    participant DB as Supabase DB
    participant Chrome as chrome.identity
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
    AS->>User: Show login form
    User->>AS: Enter credentials, approve
    AS->>Chrome: Redirect with ?code=...&state=...&iss=...
    Chrome-->>SW: Return callback URL

    Note over SW,AS: Step 3: Callback (server-side)
    SW->>Bridge: POST {action: "callback", code, state, iss}
    Bridge->>DB: Look up state → code_verifier, DPoP keys
    Bridge->>AS: Token exchange + DPoP proof + PKCE verifier
    AS-->>Bridge: {access_token, refresh_token, sub: DID}
    Bridge->>Bridge: Verify DID→PDS→AS matches issuer
    Bridge->>DB: Store session (tokens, DPoP keys)
    Bridge->>Bridge: Mint Supabase JWT (sub: DID)
    Bridge-->>SW: {jwt, expiresAt, did}

    SW->>SW: Cache JWT, broadcast SESSION_CHANGED
    SW-->>Popup: {did}
    Popup->>User: Show "Logged in"
```

### Key Components

- **auth-bridge (BFF)**: Server-side OAuth client — holds DPoP keys and ATProto tokens, extension never sees them
- **client-metadata.json** (GitHub Pages): Public OAuth client configuration. The URL to this file IS the `client_id`
- **redirect_uri** (`chromiumapp.org`): Chrome extension's special OAuth callback URL — Chrome intercepts redirects here
- **PKCE** (Proof Key for Code Exchange): Prevents authorization code interception
- **DPoP** (Demonstrating Proof of Possession): Binds tokens to server-held cryptographic keys
- **PAR** (Pushed Authorization Request): Sends auth params to server before redirect (required by AT Protocol)
- **Identity verification**: After token exchange, auth-bridge independently resolves DID→PDS→AS to confirm the AS is authoritative
