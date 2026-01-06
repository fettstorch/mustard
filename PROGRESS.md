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
        NoteEditor["Note Editor (SKELETON)"]
    end

    subgraph Page["Web Page"]
        Elements["Page Elements"]
        Notes["Injected Notes (PLANNED)"]
    end

    subgraph Backend["Backend (PLANNED)"]
        API["REST API (PLANNED)"]
        DB[("PostgreSQL (PLANNED)")]
        Auth["Auth (PLANNED)<br/>Atproto/Google"]
    end

    Click -->|"opens"| Popup
    RightClick -->|"opens"| CtxMenu
    CtxMenu -->|"opens"| NoteEditor

    Popup <-->|"chrome.runtime (PLANNED)"| BG
    Options <-->|"chrome.storage"| BG
    BG <-->|"chrome.runtime"| CS

    CS -->|"MutationObserver (PLANNED)"| Elements
    CS -->|"DOM injection (PLANNED)"| Notes
    Notes -->|"anchored to"| Elements

    BG <-->|"fetch (PLANNED)"| API
    API <--> DB
    API <--> Auth

    style Notes stroke-dasharray: 5 5
    style Backend stroke-dasharray: 5 5
    style API stroke-dasharray: 5 5
    style DB stroke-dasharray: 5 5
    style Auth stroke-dasharray: 5 5
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
