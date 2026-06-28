-- Generalize oauth_login_state and oauth_session for multiple providers.
--
-- The atproto-era oauth_session was keyed by `did` and stored a single atproto
-- identity. We move to a composite (provider, provider_account_id) PK plus a
-- UUID user_id FK back to `users`.
--
-- Re-login required: the previous model used the DID as the JWT subject. After
-- 009 the JWT subject becomes a UUID, so every cached JWT and stored OAuth
-- session is now stale. We therefore CLEAR all sessions and pending login states
-- up front — every user simply re-authorizes once, and linkIdentity reattaches
-- their existing atproto identity (already mapped to its UUID in 009) on the way
-- back in. This also lets us add the NOT NULL UUID columns to an empty table
-- without back-populating provider ids into a UUID column.

-- ── Clear stale auth state (forces a one-time re-login) ───────────────────────
DELETE FROM oauth_session;
DELETE FROM oauth_login_state;

-- ── oauth_login_state ──────────────────────────────────────────────────────
ALTER TABLE oauth_login_state
  ADD COLUMN IF NOT EXISTS provider TEXT NOT NULL DEFAULT 'atproto';
ALTER TABLE oauth_login_state
  ALTER COLUMN provider DROP DEFAULT;

-- DPoP / AS fields are atproto-specific; nullable so GitHub rows can omit them.
ALTER TABLE oauth_login_state
  ALTER COLUMN dpop_jwk       DROP NOT NULL,
  ALTER COLUMN dpop_pub_jwk   DROP NOT NULL,
  ALTER COLUMN as_issuer      DROP NOT NULL,
  ALTER COLUMN token_endpoint DROP NOT NULL;

-- ── oauth_session ──────────────────────────────────────────────────────────
-- Table is empty (cleared above), so we can add NOT NULL columns directly.
ALTER TABLE oauth_session
  ADD COLUMN IF NOT EXISTS provider             TEXT,
  ADD COLUMN IF NOT EXISTS provider_account_id  TEXT,
  ADD COLUMN IF NOT EXISTS user_id              UUID REFERENCES users(id) ON DELETE CASCADE;

ALTER TABLE oauth_session
  ALTER COLUMN provider            SET NOT NULL,
  ALTER COLUMN provider_account_id SET NOT NULL,
  ALTER COLUMN user_id             SET NOT NULL;

-- DPoP and token_endpoint are atproto-specific; nullable for GitHub rows.
ALTER TABLE oauth_session
  ALTER COLUMN dpop_jwk       DROP NOT NULL,
  ALTER COLUMN dpop_pub_jwk   DROP NOT NULL,
  ALTER COLUMN token_endpoint DROP NOT NULL,
  ALTER COLUMN scope          DROP NOT NULL;

-- Replace the `did` primary key with a composite (provider, provider_account_id).
ALTER TABLE oauth_session DROP CONSTRAINT oauth_session_pkey;
ALTER TABLE oauth_session ADD PRIMARY KEY (provider, provider_account_id);

-- The old `did` column is retained (nullable) so the atproto callback can keep
-- writing it for backward-compat until a later cleanup phase removes it.
ALTER TABLE oauth_session ALTER COLUMN did DROP NOT NULL;

CREATE INDEX IF NOT EXISTS idx_oauth_session_user_id ON oauth_session(user_id);
