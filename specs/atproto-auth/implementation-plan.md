# Implementation Plan (prio-learning mode)

Companion to `sketch.md` (the design). This file tracks the **step-by-step
teach-then-build workflow** we agreed on: each step gets a short explanation
before any code, only that step's scope gets implemented, and we don't move
on until the step is explicitly `approved`.

Status legend: `pending` / `in progress` / `approved`

## Steps

```mermaid
graph TD
    S1["1. Data model<br/>mustard_sessions table"] --> S2["2. Session logic<br/>mint / rotate / revoke"]
    S2 --> S3["3. Refresh endpoint<br/>short JWT + dual-path refresh"]
    S3 --> S4["4. Confidential client<br/>private_key_jwt upgrade"]
    S3 --> S5["5. Client storage<br/>SupabaseAuth.ts rewrite"]
    S5 --> S6["6. Wire-through + tests<br/>login flows, e2e"]
    S4 -.optional dependency.-> S6
```

| #   | Step                 | What                                                                                             | Why it matters                                                                             | Status       |
| --- | -------------------- | ------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------ | ------------ |
| 1   | Data model           | `mustard_sessions` table (hashed refresh tokens, sliding expiry)                                 | Foundation: how we store a revocable session server-side instead of trusting the JWT alone | **approved** |
| 2   | Session logic        | mint/rotate/revoke functions                                                                     | The actual rotation mechanics — why hashing, why a grace window                            | **approved** |
| 3   | Refresh endpoint     | 24h JWT + dual-path `refresh` action (new refresh-token path _and_ one-time legacy-JWT exchange) | How existing users silently upgrade with no re-login                                       | **approved** |
| 4   | Confidential client  | `private_key_jwt` signing + `client-metadata.json` upgrade                                       | Lets Bluesky sessions survive long-term (needed for future PDS writes)                     | **approved** |
| 5   | Client storage       | `SupabaseAuth.ts` rewrite                                                                        | How the extension stores/rotates the pair, thundering-herd handling                        | **approved** |
| 6   | Wire-through + tests | Login/logout call sites, unit + e2e tests                                                        | Ties it together and proves it works                                                       | in progress  |

## Notes on existing scaffolding

These files already exist on disk from an earlier (too-fast) pass and were
**not** reverted (they're untracked, so `git checkout`/revert didn't touch
them). Treat them as drafts to review/rebuild properly within their
corresponding step above, not as done:

- `supabase/migrations/020_mustard_sessions.sql` → Step 1
- `supabase/functions/auth-bridge/sessions.ts` → Step 2
- `supabase/functions/auth-bridge/client-assertion.ts` → Step 4

A local `supabase/functions/.env` was also created with a real generated
ES256 keypair for the confidential-client upgrade (gitignored, never
committed). Relevant again at Step 4.

## Rules for this plan (from the prio-learning skill)

- Explain the concept/approach before writing code, every step.
- Implement only the current step's scope.
- Wait for explicit `approved` before starting the next step.
- Update this file's status column as steps complete.
