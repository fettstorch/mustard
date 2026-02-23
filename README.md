# Mustard

A Chrome extension that lets users annotate web pages with "mustard" (notes) and follow others to see their annotations on the same pages.

## Project Vision

### The Concept

The name "mustard" comes from the German saying _"seinen Senf dazu geben"_ (to add one's opinion to something). This extension enables users to add their "mustard" (opinions/notes) to any webpage.

### Core Features

#### Note Creation & Management

- Users can annotate any part of any webpage with notes
- Notes can contain text (up to 300 characters), images planned for future
- **Creation workflow**: Right-click on any element → "Add Mustard" → Note editor opens
- **Two save modes**:
  - **Save locally**: Stored in browser only (no login required)
  - **Publish**: Stored on server, visible to followers (requires Bluesky login)
- Users can delete their own notes

#### Social Graph & Following

- Uses **Bluesky's social graph** - users you follow on Bluesky can see your published mustard
- When visiting a page where a followed user has added mustard, those notes appear at the anchored locations
- Multiple follows' notes can appear on the same page simultaneously
- **Authentication**: AT Protocol OAuth via Bluesky

#### Page Identification & Note Positioning

- **Page matching**: URLs normalized without query parameters
- **Element anchoring**:
  - Primary: CSS selector (generated from element hierarchy)
  - Fallback: Absolute click position (viewport % + scroll offset)
- **SPA support**: Detects client-side navigation (pushState/replaceState) and re-queries notes

## Technical Architecture

### Frontend (Chrome Extension)

- **Content Script**: Injects mustard notes into web pages, handles SPA navigation
- **Background Service Worker**: Manages messaging, authentication, note operations
- **Popup**: Login/logout, user profile display
- **Options Page**: Settings (placeholder)

### Backend (Supabase)

- **PostgreSQL Database**: Stores all published notes with RLS policies
- **Edge Functions**:
  - `auth-bridge`: Mints Supabase JWTs from AT Protocol DIDs
  - `get-index`: Fetches user's Bluesky follows and returns notes index
- **Authentication**: Custom JWT strategy using AT Protocol DIDs as user IDs

### Data Flow

1. User logs in via Bluesky OAuth → Extension receives DID
2. Extension calls `auth-bridge` → Receives Supabase JWT
3. User navigates to page → Extension calls `get-index` with DID
4. `get-index` fetches user's Bluesky follows, queries DB for notes from those users
5. Extension fetches specific notes for current page URL
6. Notes injected into page at anchored positions

## Technical Stack

- **Vue 3** - Frontend framework
- **TypeScript** - Type safety
- **Vite** - Build tool
- **@crxjs/vite-plugin** - Chrome extension build plugin with HMR
- **Tailwind CSS v4** - Styling
- **Supabase** - PostgreSQL database + Edge Functions
- **AT Protocol** - Bluesky authentication and social graph

## Development

### Prerequisites

- Node.js 18+
- A Supabase project (see [SUPABASE_SETUP.md](./SUPABASE_SETUP.md))

### Setup

```sh
npm install
```

### Run Development Server

```sh
npm run dev
```

This starts Vite with HMR. The extension is built to `dist/`.

### Load Extension in Chrome

1. Open `chrome://extensions/`
2. Enable "Developer mode" (top right)
3. Click "Load unpacked"
4. Select the `dist/` folder
5. The extension icon (mustard bottle) appears in toolbar

When running `npm run dev`, changes hot-reload automatically. For manifest changes, click the refresh icon on the extension card.

### Type Check

```sh
npm run type-check
```

### Lint

```sh
npm run lint
```

### Build for Production

```sh
npm run build
```

## Supabase Deployment

### Deploy Edge Functions

The Supabase CLI is required. Install it globally or use npx:

```sh
# Install Supabase CLI (if not installed)
npm install -g supabase

# Login to Supabase
supabase login

# Link to your project (run from project root)
supabase link --project-ref YOUR_PROJECT_REF

# Deploy Edge Functions
supabase functions deploy auth-bridge
supabase functions deploy get-index
```

### Set Edge Function Secrets

The `auth-bridge` function needs the JWT signing secret:

```sh
supabase secrets set JWT_SIGNING_SECRET=your-jwt-secret-from-supabase-dashboard
```

Find your JWT secret in Supabase Dashboard → Settings → API → JWT Settings → JWT Secret.

### Database Migration

Apply the notes table schema:

```sh
supabase db push
```

Or run the SQL manually from `supabase/migrations/001_create_notes.sql`.

See [SUPABASE_SETUP.md](./SUPABASE_SETUP.md) for detailed setup instructions.

## Project Structure

```
src/
├── background/           # Service worker
│   ├── auth/             # AtprotoAuth, SupabaseAuth
│   ├── business/         # MustardNotesManager, services
│   └── service-worker.ts
├── content/              # Content script
│   ├── content-script.ts
│   └── url-change-detector.ts  # SPA navigation detection
├── shared/               # Shared types, DTOs, models
│   ├── dto/
│   ├── model/
│   └── messaging.ts
├── ui/                   # Vue components
│   ├── content/          # Note rendering (MustardNote, MustardContent)
│   ├── popup/            # Extension popup
│   └── options/          # Options page
└── manifest.ts           # Chrome extension manifest

supabase/
├── functions/
│   ├── auth-bridge/      # JWT minting from AT Protocol DIDs
│   └── get-index/        # Fetches follows + notes index
└── migrations/           # Database schema
```

## Implementation Status

See [PROGRESS.md](./PROGRESS.md) for detailed implementation status and architecture diagrams.
