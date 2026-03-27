-- Temporary state during the OAuth login flow (~10 min lifetime).
-- Created by auth-bridge "initiate", consumed by auth-bridge "callback".
CREATE TABLE IF NOT EXISTS oauth_login_state (
  state TEXT PRIMARY KEY,
  code_verifier TEXT NOT NULL,
  dpop_jwk JSONB NOT NULL,          -- ES256 private key (JWK format)
  dpop_pub_jwk JSONB NOT NULL,      -- ES256 public key (JWK format)
  as_issuer TEXT NOT NULL,           -- Authorization Server issuer URL
  token_endpoint TEXT NOT NULL,      -- AS token endpoint URL
  redirect_uri TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now() NOT NULL
);

-- Long-lived authenticated sessions.
-- Created by auth-bridge "callback", used by auth-bridge "refresh".
CREATE TABLE IF NOT EXISTS oauth_session (
  did TEXT PRIMARY KEY,              -- AT Protocol DID (matches notes.author_id)
  dpop_jwk JSONB NOT NULL,          -- ES256 private key for DPoP proofs
  dpop_pub_jwk JSONB NOT NULL,      -- ES256 public key
  access_token TEXT NOT NULL,
  refresh_token TEXT,
  token_endpoint TEXT NOT NULL,      -- AS token endpoint (needed for refresh)
  scope TEXT NOT NULL,
  token_expires_at TIMESTAMPTZ,     -- when the access token expires
  created_at TIMESTAMPTZ DEFAULT now() NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT now() NOT NULL
);

-- RLS: these tables are only accessed by auth-bridge (service_role), never by clients.
ALTER TABLE oauth_login_state ENABLE ROW LEVEL SECURITY;
ALTER TABLE oauth_session ENABLE ROW LEVEL SECURITY;

-- No client-facing policies — service_role bypasses RLS automatically.
