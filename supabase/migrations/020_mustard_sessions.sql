-- Mustard session table backing short-lived JWTs + rotating refresh tokens.
--
-- Replaces the old model where the Supabase JWT itself doubled as a 180-day
-- refresh credential (mint once, "refresh" by re-verifying the same token for
-- up to another year). Now:
--   * the JWT (`sid` claim) is a thin, short-lived (24h) capability;
--   * this table holds the actual session, identified by a hashed opaque
--     refresh token, which is revocable and rotates on every use.
--
-- Only the hash is stored (never the raw token) so a DB read can't be used to
-- mint sessions. `prev_token_hash` gives a short grace window after rotation
-- so a service-worker restart that raced a refresh doesn't strand the caller
-- with an already-rotated-out token.
CREATE TABLE IF NOT EXISTS mustard_sessions (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(), -- == JWT `sid` claim
  user_id            UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  refresh_token_hash TEXT NOT NULL UNIQUE,
  prev_token_hash    TEXT UNIQUE,
  prev_valid_until   TIMESTAMPTZ,
  created_at         TIMESTAMPTZ DEFAULT now() NOT NULL,
  last_refreshed_at  TIMESTAMPTZ DEFAULT now() NOT NULL,
  expires_at         TIMESTAMPTZ NOT NULL -- sliding: now() + 90d on every refresh
);

CREATE INDEX IF NOT EXISTS idx_mustard_sessions_user_id ON mustard_sessions(user_id);

-- Expired sessions are cleaned up lazily (auth-bridge treats an expired row as
-- absent); this index keeps a periodic manual sweep cheap if ever needed.
CREATE INDEX IF NOT EXISTS idx_mustard_sessions_expires_at ON mustard_sessions(expires_at);

-- RLS: service_role only (auth-bridge). No client-facing policies.
ALTER TABLE mustard_sessions ENABLE ROW LEVEL SECURITY;
