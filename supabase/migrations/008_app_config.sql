-- Client-version guard: a single server-controlled row the extension reads to
-- decide whether it is too old to keep talking to the backend safely.
--
-- Why this exists: the extension auto-updates on the store's schedule, with no
-- in-app "force update" channel. Before a future breaking backend change ships,
-- this lets the backend declare a minimum supported client version; gate-aware
-- clients below it switch to a read-only "please update" mode instead of failing
-- silently or writing data the new model can't understand.
--
-- Seeded at '0.0.0' so the guard is DORMANT on release: no client is below it.
-- The breaking release bumps this value (UPDATE app_config SET ...).

CREATE TABLE IF NOT EXISTS app_config (
  id                 INT PRIMARY KEY DEFAULT 1,
  min_client_version TEXT NOT NULL DEFAULT '0.0.0',
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- Singleton: there is only ever one config row.
  CONSTRAINT app_config_singleton CHECK (id = 1)
);

INSERT INTO app_config (id, min_client_version)
VALUES (1, '0.0.0')
ON CONFLICT (id) DO NOTHING;

-- Public read: the value is non-sensitive and every client (logged in or not)
-- needs it on startup. Writes stay service-role only (no client-facing policy).
ALTER TABLE app_config ENABLE ROW LEVEL SECURITY;
CREATE POLICY "app_config public read" ON app_config FOR SELECT USING (true);
