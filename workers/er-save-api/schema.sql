-- SPDX-FileCopyrightText: 2024-2026 Pagefault Games
-- SPDX-License-Identifier: AGPL-3.0-only
--
-- Elite Redux — cloud-save D1 schema (#229).
--
-- Three tables back the username/password account + cloud-save system. Apply with:
--   npx wrangler d1 execute er-saves --file ./schema.sql           (local)
--   npx wrangler d1 execute er-saves --remote --file ./schema.sql  (production)

-- One row per account. Passwords are stored ONLY as a PBKDF2 hash
-- ("pbkdf2$<iterations>$<saltB64>$<hashB64>") — never in plaintext.
CREATE TABLE IF NOT EXISTS users (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  username       TEXT    NOT NULL,                 -- display form (as typed)
  username_lower TEXT    NOT NULL UNIQUE,          -- case-insensitive uniqueness key
  password_hash  TEXT    NOT NULL,
  is_admin       INTEGER NOT NULL DEFAULT 0,
  created_at     INTEGER NOT NULL,                 -- epoch ms
  last_login     INTEGER                           -- epoch ms, null until first login
);

-- One system save per user (pokedex, unlocks, eggs, vouchers, settings).
-- `data` is the raw, client-encrypted save string exactly as the game sends it;
-- the server treats it as an opaque blob.
CREATE TABLE IF NOT EXISTS system_saves (
  user_id    INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  data       TEXT    NOT NULL,
  trainer_id INTEGER,
  secret_id  INTEGER,
  updated_at INTEGER NOT NULL
);

-- Up to 5 session (run) saves per user, one per slot. Composite PK keeps an
-- UPSERT per (user, slot) cheap — one D1 write per sync, which is what keeps
-- us inside the free-tier write budget.
CREATE TABLE IF NOT EXISTS session_saves (
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  slot       INTEGER NOT NULL,
  data       TEXT    NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, slot)
);

-- Run history (#217 ghost teams + balancing analytics). One row per finished run
-- (win or loss), append-only. Winning rows are sampled to build the shared pool of
-- "ghost trainers" other players face. `id` is client-generated (seed+timestamp)
-- so re-uploading a player's local history is idempotent (ON CONFLICT DO NOTHING).
-- `player_team` / `opponent_team` are JSON arrays of serialised party members.
CREATE TABLE IF NOT EXISTS runs (
  id            TEXT    PRIMARY KEY,
  user_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  username      TEXT,
  outcome       TEXT,                  -- 'victory' | 'defeat'
  difficulty    TEXT,                  -- 'ace' | 'elite' | 'hell'
  mode          TEXT,
  wave          INTEGER,
  created_at    INTEGER NOT NULL,
  player_team   TEXT    NOT NULL,
  opponent_name TEXT,
  opponent_team TEXT
);
CREATE INDEX IF NOT EXISTS idx_runs_sample ON runs (difficulty, outcome, created_at);

-- Shared dev TEST-SUITE progress (staging only). So the QA team doesn't re-run
-- each other's scenarios: every Pass / Fail / Send-Logs from the in-game test
-- suite is appended here, and the "passed" set is shared across all browsers and
-- accounts. Append-only event log; the "passed" set is derived as the scenarios
-- whose most-recent PASS/UNPASS event is a PASS (UNPASS = the "undo last pass"
-- button). `by` is a free-text tester label (optional). The worker auto-creates
-- this table on first /devtest hit, so an already-deployed DB needs no migration.
CREATE TABLE IF NOT EXISTS devtest_events (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  kind      TEXT    NOT NULL,   -- 'PASS' | 'FAIL' | 'LOG' | 'UNPASS'
  scenario  TEXT    NOT NULL DEFAULT '',
  comment   TEXT    NOT NULL DEFAULT '',
  by        TEXT    NOT NULL DEFAULT '',
  at        INTEGER NOT NULL    -- epoch ms
);
CREATE INDEX IF NOT EXISTS idx_devtest_scenario ON devtest_events (scenario, at);
CREATE INDEX IF NOT EXISTS idx_devtest_at ON devtest_events (at);
