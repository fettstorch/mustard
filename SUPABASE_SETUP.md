# Supabase Remote Notes Setup

This document describes how to set up the Supabase backend for the Mustard remote notes service.

## Prerequisites

- A Supabase project ([create one here](https://supabase.com))
- Supabase CLI installed (`npm install -g supabase`)

## Setup Steps

### 1. Create Database Table

Execute the SQL commands in `supabase-setup.sql` in your Supabase SQL Editor:

- Navigate to your project → SQL Editor
- Create a new query
- Copy and paste the contents of `supabase-setup.sql`
- Run the query

This will create:

- The `notes` table with proper schema
- Indexes for performance
- Row Level Security (RLS) policies

### 2. Deploy Edge Functions

Deploy the two Edge Functions to your Supabase project:

```bash
# Login to Supabase CLI
supabase login

# Link to your project
supabase link --project-ref your-project-ref

# Deploy auth-bridge function
supabase functions deploy auth-bridge

# Deploy get-index function
supabase functions deploy get-index
```

### 3. Configure Environment Variables

Update the following files with your actual Supabase credentials:

#### `src/background/supabase-client.ts`

Replace:

```typescript
const SUPABASE_URL = 'https://your-project.supabase.co'
const SUPABASE_ANON_KEY = 'your-anon-key'
```

With your actual values from:

- Project Settings → API → Project URL
- Project Settings → API → Project API keys → `anon` `public` key

#### `src/background/auth/SupabaseAuth.ts`

Replace:

```typescript
const AUTH_BRIDGE_URL = 'https://your-project.supabase.co/functions/v1/auth-bridge'
```

With your actual Edge Function URL.

#### `src/background/business/service/MustardNotesServiceRemote.ts`

Replace:

```typescript
const GET_INDEX_URL = 'https://your-project.supabase.co/functions/v1/get-index'
```

With your actual Edge Function URL.

### 4. Verify Setup

Test the setup:

1. Build the extension: `npm run build`
2. Load it in Chrome
3. Log in with your Bluesky account
4. Create a local note and publish it (blue arrow icon)
5. Check your Supabase dashboard → Table Editor → `notes` table to see the note

## Architecture Overview

```
┌─────────────────────┐
│  Chrome Extension   │
│                     │
│  ┌───────────────┐ │
│  │ Local Service │ │  (chrome.storage.local)
│  └───────────────┘ │
│                     │
│  ┌───────────────┐ │
│  │Remote Service │ │
│  └───────┬───────┘ │
└──────────┼─────────┘
           │
           ▼
┌──────────────────────────────────────┐
│         Supabase Backend              │
│                                       │
│  ┌────────────────────────────────┐  │
│  │  Edge Function: auth-bridge     │  │
│  │  - Verifies AT Protocol DID     │  │
│  │  - Mints Supabase JWT           │  │
│  └────────────────────────────────┘  │
│                                       │
│  ┌────────────────────────────────┐  │
│  │  Edge Function: get-index       │  │
│  │  - Fetches Bluesky follows      │  │
│  │  - Queries notes from follows   │  │
│  │  - Returns index                │  │
│  └────────────────────────────────┘  │
│                                       │
│  ┌────────────────────────────────┐  │
│  │  PostgreSQL: notes table        │  │
│  │  - author_id (DID)              │  │
│  │  - page_url, content, anchors   │  │
│  │  - RLS policies                 │  │
│  └────────────────────────────────┘  │
└──────────────────────────────────────┘
           │
           ▼
┌──────────────────────────────────────┐
│     Bluesky Public API                │
│  app.bsky.graph.getFollows            │
└──────────────────────────────────────┘
```

## Security Model

- **Authentication**: Custom JWTs minted by `auth-bridge` Edge Function
- **Authorization**: Row Level Security (RLS) policies in PostgreSQL
- **User Identification**: AT Protocol DID used directly as `author_id`
- **Follow Graph**: Fetched from Bluesky's public API (no auth needed)

## Key Design Decisions

1. **No Supabase Auth users**: We use custom JWTs instead of Supabase Auth's user management
2. **DID as primary identifier**: The AT Protocol DID is stored directly in `author_id`
3. **No follows table**: We query Bluesky's public API for the follow graph
4. **Public read access**: All notes are publicly readable (per Mustard's design)
5. **Write access via JWT**: Only the author can create/update/delete their notes (enforced by RLS)

## Troubleshooting

### Notes not appearing after publishing

1. Check browser console for errors
2. Verify Supabase credentials are correct
3. Check Supabase logs: Functions → Logs
4. Verify RLS policies are enabled

### JWT authentication failing

1. Check `SUPABASE_JWT_SECRET` is set in Edge Function environment
2. Verify the JWT is being fetched: check `chrome.storage.local` for `supabase_jwt` key
3. Check auth-bridge Edge Function logs

### Follows not loading

1. Verify `get-index` Edge Function is deployed
2. Check Edge Function logs for errors
3. Test the Bluesky API directly: `https://public.api.bsky.app/xrpc/app.bsky.graph.getFollows?actor=your-did`
