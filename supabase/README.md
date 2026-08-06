# Supabase Backend

This directory contains Mustard's database migrations, local Supabase
configuration, and Edge Functions. The authoritative setup instructions live in:

- [`README.md`](../README.md#local-supabase) for local development and E2E
  environment files
- [`SUPABASE_SETUP.md`](../SUPABASE_SETUP.md) for hosted project setup,
  migrations, secrets, deployment, and troubleshooting
- [`specs/atproto-auth/sketch.md`](../specs/atproto-auth/sketch.md#migration--rollout)
  for the one-time confidential AT Protocol client rollout

## Contents

- `migrations/` — the complete, ordered database schema. Use
  `supabase migration up` locally or `supabase db push` for a linked project;
  do not apply individual files manually.
- `functions/auth-bridge/` — Bluesky/GitHub OAuth BFF, identity linking,
  short-lived JWT minting, and rotating Mustard sessions.
- `functions/get-index-v2/` — authenticated multi-provider follow index.
- `functions/link-preview-thumbnail/` — verified, content-addressed thumbnail
  upload and cleanup.
- `functions/.env.example` — template for the ignored local Edge Function
  secrets file, `functions/.env`.
- `functions/.env.e2e` — tracked, non-secret baseline used only by CI's local
  authenticated suites.

Never place private keys, OAuth client secrets, or live account credentials in
tracked environment files.
