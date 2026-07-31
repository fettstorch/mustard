-- Migration 020 created mustard_sessions but (unlike 016's explicit grants for
-- every other service_role-only table) never granted service_role access to
-- it. Supabase doesn't auto-grant new tables to API roles, so every call from
-- auth-bridge failed with "permission denied for table mustard_sessions"
-- until this ships. Caught by the authenticated E2E suite.
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE mustard_sessions TO service_role;
