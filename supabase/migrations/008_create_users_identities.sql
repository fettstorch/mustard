-- Unified Mustard user + provider-identity tables.
--
-- Design choice: a Mustard user is an opaque UUID that NEVER encodes a provider
-- id (no DIDs as user_ids). Provider-specific ids (atproto DID, GitHub numeric
-- id, ...) live only in the `identities` table. This lets a single account link
-- and unlink an arbitrary set of providers while its user_id stays stable.
--
-- The identities table is the authoritative map from (provider, external account
-- id) to a Mustard user. It is the only place that stores provider-specific ids.

CREATE TABLE IF NOT EXISTS users (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at TIMESTAMPTZ DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS identities (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id             UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider            TEXT NOT NULL,           -- 'atproto' | 'github' | ...
  provider_account_id TEXT NOT NULL,           -- DID for atproto; numeric string for github
  handle              TEXT,                    -- mutable display handle (@user.bsky.social / github login)
  created_at          TIMESTAMPTZ DEFAULT now() NOT NULL,
  CONSTRAINT identities_provider_account_unique UNIQUE (provider, provider_account_id)
);

CREATE INDEX IF NOT EXISTS idx_identities_user_id ON identities(user_id);
-- Reverse lookup (provider_account_id → user_id) is used by get-index follow
-- resolution and the mention-notification triggers.
CREATE INDEX IF NOT EXISTS idx_identities_provider_account
  ON identities(provider, provider_account_id);

-- RLS: these tables are read by auth-bridge (service_role) and get-index-v2
-- (service_role). No direct client access needed.
ALTER TABLE users      ENABLE ROW LEVEL SECURITY;
ALTER TABLE identities ENABLE ROW LEVEL SECURITY;
-- No client-facing policies — service_role bypasses RLS automatically.
