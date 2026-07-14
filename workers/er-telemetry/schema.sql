-- SPDX-FileCopyrightText: 2024-2026 Pagefault Games
-- SPDX-License-Identifier: AGPL-3.0-only
--
-- Elite Redux — Showdown battle telemetry D1 schema (Task D5). A DEDICATED database
-- (er-telemetry), separate from er-saves. Apply with:
--   npx wrangler d1 execute er-telemetry --file ./schema.sql            (local)
--   npx wrangler d1 execute er-telemetry --remote --file ./schema.sql   (production)
-- The worker also auto-creates the table on first hit (ensureTables), so a deployed DB
-- needs no migration; it is listed here so a fresh DB matches.

-- One row per finished showdown match. `trace_gz` is the gzipped full payload (both
-- manifests + seed + outcome + optional ReplayTrace) — the replayable "record everything";
-- `summary_json` is the denormalized projection (teams + version + seed) for direct SQL.
CREATE TABLE IF NOT EXISTS showdown_battles (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  match_id     TEXT,                  -- escrow id, or NULL for a friendly match
  host_uid     TEXT    NOT NULL,      -- account username
  guest_uid    TEXT    NOT NULL,
  winner       TEXT,                  -- 'host' | 'guest' | NULL (void)
  reason       TEXT    NOT NULL,      -- victory | forfeit | timeout | checksum | illegalTeam | earlyDisconnect
  turns        INTEGER NOT NULL,
  duration_ms  INTEGER NOT NULL,
  created_at   INTEGER NOT NULL,      -- epoch ms
  trace_gz     BLOB,                  -- gzip(full payload JSON); NULL if compression failed
  summary_json TEXT    NOT NULL       -- denormalized summary (teams/version/seed)
);
CREATE INDEX IF NOT EXISTS idx_sb_created ON showdown_battles (created_at);

-- =============================================================================
-- Showdown TOURNAMENT mode (P1). Single-elimination async brackets on top of the
-- showdown stack. The authoritative match state (the bracket) is stored as JSON on
-- the tournament row (`bracket_json`) — the pure engine in tournament-bracket.ts is
-- the single source of truth. The `tournament_matches` and `tournament_presence`
-- tables are the P2 projection targets (activity wins / last-seen); they are
-- created now (design decision: schema designed up-front) but P1 drives all logic
-- off `bracket_json`. Auto-created on first hit (ensureTournamentTables).
-- =============================================================================

CREATE TABLE IF NOT EXISTS tournaments (
  id              TEXT PRIMARY KEY,       -- caller-supplied or generated id
  name            TEXT    NOT NULL,
  organizer       TEXT    NOT NULL,       -- creating admin's account username
  state           TEXT    NOT NULL,       -- registration | in_progress | complete | cancelled
  round_window_ms INTEGER NOT NULL,       -- per-round self-schedule window
  max_entrants    INTEGER NOT NULL,
  created_at      INTEGER NOT NULL,       -- epoch ms
  started_at      INTEGER,                -- epoch ms registration closed / bracket generated
  champion        TEXT,                   -- winner username once complete
  bracket_json    TEXT                    -- serialized Bracket (null until close)
);
CREATE INDEX IF NOT EXISTS idx_tour_state ON tournaments (state, created_at);

CREATE TABLE IF NOT EXISTS tournament_entrants (
  tournament_id TEXT    NOT NULL,
  participant   TEXT    NOT NULL,         -- entrant account username
  name          TEXT    NOT NULL,
  preset_name   TEXT    NOT NULL,         -- the saved team preset registered with
  seed          INTEGER,                  -- assigned at bracket generation
  registered_at INTEGER NOT NULL,
  PRIMARY KEY (tournament_id, participant)
);
CREATE INDEX IF NOT EXISTS idx_entrant_tour ON tournament_entrants (tournament_id);

-- P2 projection: one row per bracket match (activity/presence joins hang off this).
CREATE TABLE IF NOT EXISTS tournament_matches (
  match_id      TEXT PRIMARY KEY,         -- ${tournament}-r${round}-m${slot}
  tournament_id TEXT    NOT NULL,
  round         INTEGER NOT NULL,
  slot          INTEGER NOT NULL,
  player_a      TEXT,                      -- username or NULL (bye/TBD)
  player_b      TEXT,
  deadline      INTEGER,                   -- epoch ms
  winner        TEXT,                      -- username or NULL
  resolution    TEXT    NOT NULL           -- pending | bye | reported | manual
);
CREATE INDEX IF NOT EXISTS idx_match_tour ON tournament_matches (tournament_id);

-- P2: presence pings (last-seen in the tournament lobby, for activity wins).
CREATE TABLE IF NOT EXISTS tournament_presence (
  match_id    TEXT    NOT NULL,
  participant TEXT    NOT NULL,
  last_seen   INTEGER NOT NULL,           -- epoch ms of the most recent ping
  PRIMARY KEY (match_id, participant)
);
