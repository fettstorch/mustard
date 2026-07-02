-- Server-side cache of each user's resolved follow graph (Mustard userIds, not
-- provider ids). Written only by get-index-v2 (service_role). Eliminates the
-- per-request Bluesky/GitHub follow fetch: external providers are hit at most
-- once per user per TTL (stale-while-revalidate in the edge function).
--
-- UNLOGGED: skips the write-ahead log (the crash-recovery journal) — faster
-- writes, no backup/replication traffic. Safe for a cache: on a database crash
-- the table is emptied, which just means the next request per user takes the
-- existing cold path (one blocking refresh) and repopulates it.
CREATE UNLOGGED TABLE IF NOT EXISTS follows_cache (
  user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  -- Resolved Mustard userIds (uuid-as-text, matching notes.author_id's TEXT type).
  followed_user_ids TEXT[] NOT NULL DEFAULT '{}',
  -- NULL = never successfully fetched (cold).
  fetched_at TIMESTAMPTZ,
  -- Non-NULL = a refresh is in flight (claim token; stale claims expire via the
  -- claim window in claim_follows_refresh).
  refresh_started_at TIMESTAMPTZ
);

ALTER TABLE follows_cache ENABLE ROW LEVEL SECURITY;
-- No client policies on purpose: only service_role (bypasses RLS) touches it.

-- Atomically claim the right to refresh a user's follows. Returns true when the
-- caller won the claim; no row (NULL via PostgREST) when another refresh is in
-- flight and younger than p_claim_window.
CREATE OR REPLACE FUNCTION claim_follows_refresh(
  p_user_id UUID,
  p_claim_window INTERVAL DEFAULT '2 minutes'
)
RETURNS BOOLEAN
LANGUAGE sql AS $$
  INSERT INTO follows_cache (user_id, followed_user_ids, fetched_at, refresh_started_at)
  VALUES (p_user_id, '{}', NULL, now())
  ON CONFLICT (user_id) DO UPDATE
    SET refresh_started_at = now()
    WHERE follows_cache.refresh_started_at IS NULL
       OR follows_cache.refresh_started_at < now() - p_claim_window
  RETURNING true;
$$;

REVOKE EXECUTE ON FUNCTION claim_follows_refresh(UUID, INTERVAL) FROM PUBLIC, anon, authenticated;
