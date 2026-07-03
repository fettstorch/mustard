-- Computes the full get-index-v2 response in one statement. Reads the viewer's
-- follows from follows_cache (maintained by the edge function). Returns the
-- exact JSON contract the extension client expects, plus followsFetchedAt
-- (stripped by the edge function; drives its stale-while-revalidate decision).
-- Service-role only: EXECUTE is revoked from client roles because the function
-- reads notifications (recipient-private) for the given p_user_id.
CREATE OR REPLACE FUNCTION get_index_payload(p_user_id TEXT)
RETURNS JSONB
LANGUAGE sql
STABLE
AS $$
WITH viewer_account_ids AS (
  SELECT coalesce(array_agg(provider_account_id), '{}') AS ids
  FROM identities WHERE user_id = p_user_id::uuid
),
cache AS (
  SELECT followed_user_ids, fetched_at
  FROM follows_cache WHERE user_id = p_user_id::uuid
),
official AS (
  -- Mustard official account: always visible to everyone (skipped if not signed up).
  SELECT user_id::text AS uid FROM identities
  WHERE provider = 'atproto'
    AND provider_account_id = 'did:plc:sxwohckesqi25evf7jxfshdz'
  LIMIT 1
),
all_user_ids AS (
  SELECT p_user_id AS uid
  UNION SELECT unnest(followed_user_ids) FROM cache
  UNION SELECT uid FROM official
),
visible_notes AS (
  SELECT n.id, n.author_id, n.page_url, n.updated_at
  FROM notes n JOIN all_user_ids a ON n.author_id = a.uid
),
reposted_ids AS (
  SELECT DISTINCT r.note_id
  FROM reposts r JOIN all_user_ids a ON r.reposter_id = a.uid
),
mentioned_ids AS (
  SELECT n.id AS note_id FROM notes n
  WHERE n.mentions && (SELECT ids FROM viewer_account_ids)
  UNION
  SELECT c.note_id FROM comments c
  WHERE c.mentions && (SELECT ids FROM viewer_account_ids)
),
visible_note_ids AS (
  SELECT id AS note_id FROM visible_notes
  UNION SELECT note_id FROM reposted_ids
  UNION SELECT note_id FROM mentioned_ids
),
reposters AS (
  SELECT r.note_id, jsonb_agg(DISTINCT r.reposter_id) AS reposter_ids
  FROM reposts r JOIN visible_note_ids v ON r.note_id = v.note_id
  GROUP BY r.note_id
),
my_unread AS (
  SELECT n.page_url, count(*) AS cnt
  FROM notifications x JOIN notes n ON n.id = x.note_id
  WHERE x.recipient_id = p_user_id AND n.author_id = p_user_id
  GROUP BY n.page_url
)
SELECT jsonb_build_object(
  'index', coalesce(
    (SELECT jsonb_object_agg(author_id, pages) FROM (
      SELECT author_id, jsonb_agg(DISTINCT page_url) AS pages
      FROM visible_notes GROUP BY author_id
    ) t), '{}'::jsonb),
  -- Compat-only for pre-2.2.0 clients (2.2.0+ computes unread from the
  -- notifications table). Remove this key AND the edge's IndexPayload field
  -- once min_client_version >= 2.2.0 — see specs/performance/post-release-cleanup.md.
  'myUnreadByPage', coalesce(
    (SELECT jsonb_object_agg(page_url, cnt) FROM my_unread), '{}'::jsonb),
  'latestNoteAtByPage', coalesce(
    (SELECT jsonb_object_agg(page_url, ms) FROM (
      SELECT page_url, (extract(epoch FROM max(updated_at)) * 1000)::bigint AS ms
      FROM visible_notes WHERE author_id = p_user_id GROUP BY page_url
    ) t), '{}'::jsonb),
  'repostedNoteIds', coalesce(
    (SELECT jsonb_agg(note_id) FROM reposted_ids), '[]'::jsonb),
  'mentionedNoteIds', coalesce(
    (SELECT jsonb_agg(note_id) FROM mentioned_ids), '[]'::jsonb),
  'repostersByNoteId', coalesce(
    (SELECT jsonb_object_agg(note_id, reposter_ids) FROM reposters), '{}'::jsonb),
  'followsFetchedAt', (SELECT fetched_at FROM cache)
);
$$;

REVOKE EXECUTE ON FUNCTION get_index_payload(TEXT) FROM PUBLIC, anon, authenticated;
