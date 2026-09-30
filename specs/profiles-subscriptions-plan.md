# Profiles and subscriptions

## Product contract

- A page subscription targets the exact canonical page key already used for
  note storage, queries, visibility, and deep links.
- Page subscriptions are unavailable when that key is an AT Protocol post URI
  (`at://...`). There are no section, wildcard, or domain-wide subscriptions.
- A user subscription targets the author's stable Mustard account UUID and
  includes their notes on AT Protocol posts.
- Matching both a page and user subscription creates one unread notification.
- Subscription notifications use the existing notifications table, action
  badge, popup list, native delivery, acknowledgment, and deep-link flow.
- Clicking a remote note author's avatar opens a compact Mustard profile card.
  The card keeps the external Bluesky/GitHub profile link and adds the user
  subscription control.

## Data model

Add `subscriptions` with:

- `subscriber_id UUID REFERENCES users(id) ON DELETE CASCADE`
- `kind TEXT CHECK (kind IN ('page', 'user'))`
- `page_key TEXT`
- `target_user_id UUID REFERENCES users(id) ON DELETE CASCADE`
- `created_at TIMESTAMPTZ`

A shape constraint requires exactly one target. Partial unique indexes prevent
duplicate page and user subscriptions. RLS exposes only the current subscriber's
rows and mutations.

Extend `notifications.type` with `subscription`. An `AFTER INSERT` note trigger
matches page and author subscriptions, skips the author, and inserts one row per
recipient. A partial unique index on `(recipient_id, note_id)` deduplicates the
two match reasons.

## Client slices

1. Add subscription models, Supabase service, background handlers, typed
   messages, outdated-client write guards, and focused unit tests.
2. Generalize the existing popup notification list so subscription rows render
   alongside mentions through the same notification query and acknowledgment
   path.
3. Add an expandable popup Subscriptions section:
   - subscribe/unsubscribe the active canonical page;
   - search the existing mention candidates and subscribe to the resolved
     Mustard account;
   - list and remove existing page and user subscriptions.
4. Replace the author's external-link avatar with an accessible profile-card
   trigger containing profile details, the subscription control, and the
   external provider link.

## Verification

- Migration tests: RLS, page match, user match, overlap deduplication,
  self-notification suppression, and AT-URI page rejection.
- Unit tests: services, notification copy, message classification, and page-key
  support.
- Component/E2E coverage: popup subscription management, notification opening,
  profile-card keyboard/click behavior, and user subscription toggling.
- Run the repository quality gate plus authenticated Chromium E2E. Record
  Firefox and Safari UI checks as manual release verification.
