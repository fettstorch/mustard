# Supabase Backend Setup

This directory contains the Supabase backend for Mustard: database migrations and Edge Functions.

## Initial Setup

### 1. Create Supabase Project

1. Go to [supabase.com](https://supabase.com) and sign in (or create account)
2. Click "New Project"
3. Fill in:
   - **Name**: `mustard` (or your choice)
   - **Database Password**: Choose a strong password (save it!)
   - **Region**: Choose closest to you
4. Wait for project to be created (~2 minutes)

### 2. Get API Credentials

1. In your project dashboard, go to **Settings** → **API**
2. Copy these values:
   - **Project URL** (e.g., `https://xxxxx.supabase.co`)
   - **anon public** key (long string starting with `eyJ...`)

### 3. Configure Extension

Add these to your `.env.local` file (create it from `.env.example`):

```bash
VITE_SUPABASE_URL=https://xxxxx.supabase.co
VITE_SUPABASE_ANON_KEY=eyJ...
```

The extension will use these to call Edge Functions.

## Directory Structure

- `migrations/` - SQL migrations for database schema
- `functions/` - Edge Functions (Deno TypeScript)
  - `_shared/` - Shared utilities (auth, db helpers)
  - `notes/` - Notes API endpoints
  - `index/` - Index API endpoint

## Development

Edge Functions run on Supabase's servers. To deploy:

```bash
# Install Supabase CLI (if not already installed)
npm install -g supabase

# Login
supabase login

# Link to your project
supabase link --project-ref your-project-ref

# Deploy a function
supabase functions deploy notes
```

For local development, you can use `supabase start` to run a local instance.
