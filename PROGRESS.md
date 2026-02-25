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
- Supabase Edge Functions: `auth-bridge` (mints JWTs from DIDs), `get-index` (fetches follows + notes index)
- `SupabaseAuth.ts`: JWT caching with 55min TTL, automatic refresh
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
- Database migration files: 001 (table structure), 002 (CHECK constraints)
- Notes use fixed positioning + scroll listeners: anchor to elements without affecting page layout or causing scrollbars
- Note rendering: `white-space: pre-wrap` removed from `.mustard-note-content` (was causing markdown-it's inter-tag `\n` to render as visible blank lines)
- Note rendering: empty/whitespace-only `<p>` tags stripped from markdown-it output via `EMPTY_P_REGEX` (CSS `p:empty` missed `<p>\n</p>`)
- Note content trimmed before render and before save to prevent trailing newlines creating phantom `<br>` elements
- `knip` added as devDep with `knip.json` config; `nr knip` / `nr knip:fix` scripts available for dead code detection

## AT Protocol OAuth Flow

```mermaid
sequenceDiagram
    participant User
    participant Popup as Extension Popup
    participant Auth as AtprotoAuth.ts
    participant Client as BrowserOAuthClient
    participant IDB as IndexedDB
    participant Chrome as chrome.identity
    participant BSky as bsky.social
    participant GH as GitHub Pages<br/>(client-metadata.json)

    User->>Popup: Enter handle, click Login
    Popup->>Auth: login(handle)

    Note over Auth,Client: Step 1: Initialize OAuth Client
    Auth->>Client: BrowserOAuthClient.load({clientId})
    Client->>GH: Fetch client-metadata.json
    GH-->>Client: {client_id, redirect_uris, scope, ...}

    Note over Auth,IDB: Step 2: Generate Auth URL
    Auth->>Client: authorize(handle, {redirect_uri})
    Client->>Client: Generate PKCE verifier/challenge
    Client->>Client: Generate DPoP keypair
    Client->>IDB: Store PKCE verifier, DPoP keys, state
    Client->>BSky: PAR Request (POST /oauth/par)<br/>+ DPoP proof header
    BSky-->>Client: {request_uri}
    Client-->>Auth: Authorization URL

    Note over Auth,BSky: Step 3: User Authentication
    Auth->>Chrome: launchWebAuthFlow({url, interactive: true})
    Chrome->>BSky: Open popup to auth URL
    BSky->>User: Show login form
    User->>BSky: Enter credentials, approve
    BSky->>Chrome: Redirect to chromiumapp.org/callback#code=...
    Chrome-->>Auth: Return callback URL with code

    Note over Auth,BSky: Step 4: Token Exchange
    Auth->>Auth: Extract code, state, iss from URL hash
    Auth->>Client: callback(params, {redirect_uri})
    Client->>IDB: Retrieve stored PKCE verifier, DPoP keys
    Client->>BSky: Token request (POST /oauth/token)<br/>+ code + PKCE verifier + DPoP proof
    BSky-->>Client: {access_token, refresh_token, ...}
    Client->>IDB: Store session tokens
    Client-->>Auth: OAuthSession

    Auth-->>Popup: session (did, handle, tokens)
    Popup->>User: Show "Logged in as {handle}"
```

### Key Components

- **client-metadata.json** (GitHub Pages): Public OAuth client configuration. The URL to this file IS the `client_id`
- **redirect_uri** (`chromiumapp.org`): Chrome extension's special OAuth callback URL - Chrome intercepts redirects here
- **PKCE**: Proof Key for Code Exchange - prevents authorization code interception
- **DPoP**: Demonstrating Proof of Possession - binds tokens to cryptographic keys
- **PAR**: Pushed Authorization Request - sends auth params to server before redirect (required by AT Protocol)
