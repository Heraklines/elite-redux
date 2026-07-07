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
