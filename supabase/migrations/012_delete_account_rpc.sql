-- Atomic account deletion.
--
-- Disconnecting the LAST identity from a Mustard account deletes the whole
-- account. The content tables (notes/comments/reposts/notifications) key off the
-- user id by value but are NOT FK'd to `users`, so they don't cascade and must be
-- removed explicitly. Doing this as six separate PostgREST calls from the edge
-- function is non-atomic: a failure midway leaves a half-deleted account.
--
-- This function performs the whole deletion in a single statement-level
-- transaction (a plpgsql function body runs atomically), so it either fully
-- succeeds or fully rolls back. Deleting the `users` row cascades the account's
-- `identities` and `oauth_session` rows (FK ON DELETE CASCADE).
--
-- NOTE: author/actor columns are TEXT holding the UUID string (see migration
-- 009), so we compare against p_user_id cast to text.

CREATE OR REPLACE FUNCTION delete_account(p_user_id UUID)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  uid TEXT := p_user_id::text;
BEGIN
  DELETE FROM reposts       WHERE reposter_id  = uid;
  DELETE FROM comments      WHERE author_id    = uid;
  DELETE FROM notes         WHERE author_id    = uid;
  DELETE FROM notifications WHERE recipient_id = uid OR actor_id = uid;
  -- Cascades identities + oauth_session via FK ON DELETE CASCADE.
  DELETE FROM users WHERE id = p_user_id;
END;
$$;

-- Only the edge function (service_role) may delete accounts. Revoke the default
-- PUBLIC execute grant and hand it to service_role explicitly.
REVOKE EXECUTE ON FUNCTION delete_account(UUID) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION delete_account(UUID) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION delete_account(UUID) TO service_role;
