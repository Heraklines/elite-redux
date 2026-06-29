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
  opponent_team TEXT,
  -- Added post-launch via lazy ALTER (ensureRunStatColumns); listed here so a
  -- fresh DB matches. starters/challenges: usage-tier inputs (#384).
  starters            TEXT,
  challenges          TEXT,
  -- ER (Colosseum): the run-ending ghost. killed_by_ghost=1 when a fielded
  -- ghost trainer dealt the final defeat; ghost_source_run_id joins back to
  -- that winning run's team. Powers the deadliest-ghost leaderboard.
  killed_by_ghost     INTEGER,
  ghost_source_name   TEXT,
  ghost_source_run_id TEXT
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

-- Rolling backups of the previous system_saves blob (KeeganDB92 incident, 2026-06).
-- Before an accepted system-save overwrite the worker snapshots the about-to-be-
-- replaced save here (rate-limited per user) and prunes to the most recent few, so
-- a bad write is recoverable with one query instead of D1 Time Travel. The worker
-- auto-creates this table on first system-save write, so a deployed DB needs no
-- migration.
CREATE TABLE IF NOT EXISTS system_save_backups (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  data         TEXT    NOT NULL,
  trainer_id   INTEGER,
  secret_id    INTEGER,
  saved_at     INTEGER NOT NULL,   -- updated_at of the snapshotted (previous) save
  backed_up_at INTEGER NOT NULL    -- epoch ms when the snapshot was taken
);
CREATE INDEX IF NOT EXISTS idx_ssb_user ON system_save_backups (user_id, backed_up_at);

-- General per-player notifications (reward grants + announcements), polled by the
-- client inbox at /savedata/notifications?since=. `payload` is optional JSON the
-- client renders (e.g. {species,shiny,variant} for a reward icon). Auto-created by
-- the worker on first hit, so a deployed DB needs no migration.
CREATE TABLE IF NOT EXISTS notifications (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  username   TEXT    NOT NULL,         -- target player (matched case-insensitively)
  kind       TEXT    NOT NULL DEFAULT 'system',   -- 'system' | 'reward'
  title      TEXT    NOT NULL DEFAULT '',
  body       TEXT    NOT NULL DEFAULT '',
  payload    TEXT,                     -- optional JSON (icon/extra)
  created_at INTEGER NOT NULL          -- epoch ms
);
CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications (username, created_at);

-- Community challenges (P1). Player-authored run configs that other trainers
-- browse, play, bookmark, and clear. All three tables are auto-created by the
-- worker on first /community/* hit (ensureCommunityTables), so an already-deployed
-- DB needs no migration; they are listed here so a fresh DB matches.

-- The challenge DEFINITION + denormalized counters so browse/donut/clear-rate are
-- O(1) reads. `config_json` is the run-config source of truth (the config-match
-- anti-cheat key). A challenge is 'draft' until its founder clear publishes it;
-- browse/featured only ever read 'active', so a zero-challenge launch returns an
-- empty feed cleanly with no placeholder rows.
CREATE TABLE IF NOT EXISTS community_challenges (
  id               TEXT    PRIMARY KEY,            -- creator/slug-generated
  title            TEXT    NOT NULL DEFAULT '',
  subtitle         TEXT    NOT NULL DEFAULT '',
  description      TEXT    NOT NULL DEFAULT '',
  config_json      TEXT    NOT NULL,               -- the run-config (verification source of truth)
  seed             TEXT,                           -- non-null = fixed-seed challenge
  difficulty       TEXT,                           -- denormalized for filter; ErDifficulty
  game_mode_id     INTEGER,                        -- GameModes.CHALLENGE / COOP
  target_wave      INTEGER,                        -- a clear must reach this (<=200)
  tags             TEXT,                           -- JSON string[] (chips)
  art_json         TEXT,                           -- deterministic card-art recipe
  emblem_json      TEXT,                           -- crest/difficulty-emblem recipe
  created_by       TEXT,                           -- author display name
  created_by_uid   INTEGER,                        -- author users.id (MY CHALLENGES filter)
  created_at       INTEGER NOT NULL,
  published_at     INTEGER,                        -- set when the founder clear publishes it
  status           TEXT    NOT NULL DEFAULT 'draft', -- 'draft'|'active'|'hidden'|'rejected'
  founder_clear_id TEXT,                           -- the creator's proving victory
  featured_rank    INTEGER NOT NULL DEFAULT 0,     -- admin curation; >0 = FEATURED slot order
  trending_score   REAL    NOT NULL DEFAULT 0,     -- decayed recent-attempt score (nightly cron)
  attempts_total   INTEGER NOT NULL DEFAULT 0,     -- distinct participants
  cleared_count    INTEGER NOT NULL DEFAULT 0,
  failed_count     INTEGER NOT NULL DEFAULT 0,
  inprogress_count INTEGER NOT NULL DEFAULT 0,
  best_wave        INTEGER,
  fastest_clear_ms INTEGER,
  first_clear_user TEXT,
  first_clear_at   INTEGER,                         -- "First Clear by ..."
  updated_at       INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_cc_browse ON community_challenges (status, featured_rank DESC, trending_score DESC);
CREATE INDEX IF NOT EXISTS idx_cc_newest ON community_challenges (status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_cc_author ON community_challenges (created_by_uid, created_at DESC);

-- ONE current attempt-record per (challenge,user). Status is a 3-way partition so
-- the donut sums to 100%. The UPSERT keeps it idempotent + one write/sync;
-- 'cleared' is sticky (never downgrades).
CREATE TABLE IF NOT EXISTS community_challenge_attempts (
  challenge_id  TEXT    NOT NULL,
  user_id       INTEGER NOT NULL,
  username      TEXT,
  status        TEXT    NOT NULL,           -- 'in_progress'|'cleared'|'failed'
  wave          INTEGER,                    -- best wave reached
  clear_time_ms INTEGER,                    -- fastest verified clear (for the board)
  player_team   TEXT,                       -- JSON GhostMember[] (only on a verified clear)
  challenges    TEXT,                       -- [[id,value,severity]] actually run
  run_seed      TEXT,                       -- the run's seed (config-match for fixed-seed)
  verified      INTEGER NOT NULL DEFAULT 0, -- 1 = passed config-match + IV + ban checks (P1-G)
  replay_trace  TEXT,                       -- OPTIONAL opaque ReplayTrace blob
  started_at    INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL,
  PRIMARY KEY (challenge_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_cca_board  ON community_challenge_attempts (challenge_id, verified, status, wave DESC, clear_time_ms ASC);
CREATE INDEX IF NOT EXISTS idx_cca_recent ON community_challenge_attempts (challenge_id, status, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_cca_user   ON community_challenge_attempts (user_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS community_challenge_bookmarks (
  user_id      INTEGER NOT NULL,
  challenge_id TEXT    NOT NULL,
  created_at   INTEGER NOT NULL,
  PRIMARY KEY (user_id, challenge_id)
);
CREATE INDEX IF NOT EXISTS idx_ccb_user ON community_challenge_bookmarks (user_id, created_at DESC);
