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
        RemoteService["MustardNotesServiceRemote (PLANNED)"]
    end

    subgraph Storage["Storage"]
        ChromeStorage[("chrome.storage.local")]
        API["REST API (PLANNED)"]
        DB[("PostgreSQL (PLANNED)")]
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

    CS <-->|"QUERY_NOTES / UPSERT_NOTE / DELETE_NOTE"| BG
    BG --> Manager
    Manager --> ServiceInterface
    ServiceInterface --> LocalService
    ServiceInterface -.-> RemoteService

    LocalService <-->|"serialize via"| DtoNote
    LocalService <-->|"serialize via"| DtoIndex
    LocalService <--> ChromeStorage

    RemoteService -.->|"fetch (PLANNED)"| API
    API -.-> DB

    CS -->|"DOM injection"| Notes
    Notes -->|"anchored to"| Elements

    style RemoteService stroke-dasharray: 5 5
    style API stroke-dasharray: 5 5
    style DB stroke-dasharray: 5 5
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