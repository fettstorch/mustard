-- Migrate legacy @-mention sentinels to the unified multi-provider form.
--
-- Mustard originally baked atproto mentions into note/comment CONTENT as a bare
-- DID sentinel `@[did:plc:xxx]`. With multi-provider mentions the editor now
-- emits `@[p:<provider>:<accountId>]` (e.g. `@[p:github:12345]`), and the client
-- carried a second regex branch only to keep rendering the legacy form.
--
-- Rewriting the historical content to the new form lets us delete that legacy
-- parser branch. This is a pure content rewrite:
--   @[did:plc:xxx]  →  @[p:atproto:did:plc:xxx]
--
-- The `mentions TEXT[]` column is intentionally NOT touched: it stores provider
-- account ids (the DIDs themselves), which are unchanged under the new scheme.
-- DIDs never contain `]` or whitespace, so `[^]]+` safely matches one sentinel.

UPDATE notes
SET content = regexp_replace(content, '@\[(did:[^]]+)\]', '@[p:atproto:\1]', 'g')
WHERE content LIKE '%@[did:%';

UPDATE comments
SET content = regexp_replace(content, '@\[(did:[^]]+)\]', '@[p:atproto:\1]', 'g')
WHERE content LIKE '%@[did:%';
