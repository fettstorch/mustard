-- Supabase no longer auto-grants newly-created public tables/functions to its
-- API roles. Keep the intended Data API surface explicit and portable.

-- Public data. RLS still decides which rows each role can access.
GRANT SELECT ON TABLE notes, comments, reposts, app_config TO anon, authenticated;

-- Authenticated user mutations. Existing RLS policies enforce ownership.
GRANT INSERT, UPDATE, DELETE ON TABLE notes, comments TO authenticated;
GRANT INSERT, DELETE ON TABLE reposts TO authenticated;
GRANT SELECT, DELETE ON TABLE notifications TO authenticated;

-- Trusted Edge Functions and authenticated E2E setup.
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE
  notes,
  oauth_login_state,
  oauth_session,
  comments,
  notifications,
  reposts,
  app_config,
  users,
  identities,
  follows_cache
TO service_role;

GRANT EXECUTE ON FUNCTION claim_follows_refresh(UUID, INTERVAL) TO service_role;
GRANT EXECUTE ON FUNCTION get_index_payload(TEXT) TO service_role;
