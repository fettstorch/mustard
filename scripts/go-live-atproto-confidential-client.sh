#!/usr/bin/env bash
# Cuts atproto over to the confidential client (private_key_jwt). Run this ONCE,
# from a clean checkout of `main`, during a low-traffic window — see
# specs/atproto-auth/sketch.md "Migration & rollout" for why steps 1+2 must
# happen back-to-back (the AS checks the *live* client-metadata.json's
# declared auth method against every request; old-code+new-metadata or
# new-code+old-metadata both break atproto login/refresh for the gap duration).
#
# Prerequisites: migrations 020-022 already applied (`supabase db push`),
# logged in via `supabase login`, project linked via `supabase link`.
set -euo pipefail

if [[ $(git branch --show-current) != "main" ]]; then
  echo "Run this from main, not $(git branch --show-current)." >&2
  exit 1
fi
if ! git diff --quiet || ! git diff --cached --quiet; then
  echo "Working tree not clean — commit or stash first." >&2
  exit 1
fi
git pull --ff-only origin main

echo "==> Deploying auth-bridge..."
supabase functions deploy auth-bridge

echo "==> Flipping docs/client-metadata.json to the confidential-client version..."
cp docs/client-metadata.confidential.json docs/client-metadata.json
git add docs/client-metadata.json
git commit -m "chore(auth): go live with atproto confidential client_id

Deployed immediately after auth-bridge, per specs/atproto-auth/sketch.md."
git push origin main

echo "==> Done. Watch for auth errors: supabase functions logs auth-bridge --tail"
echo "    Looking for: 'Client authentication method mismatch' (expected briefly, then zero)"
