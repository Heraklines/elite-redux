-- SPDX-FileCopyrightText: 2024-2026 Pagefault Games
-- SPDX-License-Identifier: AGPL-3.0-only
--
-- Elite Redux - co-op signaling + run-relay D1 schema (#633, P5/P6).
--
-- The co-op run itself is peer-to-peer (WebRTC DataChannel); Cloudflare is ONLY
-- the matchmaking / signaling + a thin host-authoritative save relay. So this is
-- intentionally small: one row per co-op run, keyed by the human-shareable pairing
-- code the host hands the guest. Apply with:
--   npx wrangler d1 execute er-coop --file ./schema.sql            (local)
--   npx wrangler d1 execute er-coop --remote --file ./schema.sql   (production)

-- One row per co-op run. `code` is the pairing code (see coop-pairing.ts). The
-- WebRTC offer/answer/ICE candidates are exchanged through `host_signal` /
-- `guest_signal` (opaque SDP/JSON the peers poll for, then clear). `save_blob` is
-- the host-authoritative session save (opaque, client-encrypted) used to RESUME a
-- run; resume is gated on BOTH peers being seen recently (#639). `state` mirrors
-- the client CoopLifecycle: lobby -> active -> (grace) -> abandoned | ended.
CREATE TABLE IF NOT EXISTS coop_runs (
  code           TEXT    PRIMARY KEY,                  -- pairing code (host shares with guest)
  host_username  TEXT    NOT NULL,
  guest_username TEXT,                                 -- null until a guest joins
  seed           TEXT,                                 -- run seed (host sets at create)
  host_signal    TEXT,                                 -- host's pending WebRTC signal (SDP/ICE), opaque
  guest_signal   TEXT,                                 -- guest's pending WebRTC signal, opaque
  save_blob      TEXT,                                 -- host-authoritative session blob (opaque), for resume
  state          TEXT    NOT NULL DEFAULT 'lobby',     -- lobby | active | grace | abandoned | ended
  host_seen_at   INTEGER NOT NULL,                     -- last host heartbeat (epoch ms)
  guest_seen_at  INTEGER,                              -- last guest heartbeat (epoch ms)
  created_at     INTEGER NOT NULL,
  updated_at     INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_coop_runs_updated ON coop_runs (updated_at);

-- Matchmaking lobby (#633): one row per player WAITING to be matched. Players
-- announce a name, poll for the list of OTHER waiting players, and pick one. The
-- WORKER then matches the pair and ASSIGNS roles (the picked player hosts, the
-- picker joins - invisible to both), writing the run `code` + each side's `role`
-- back here so each client reads its pairing on its next poll. Rows are dropped
-- once stale (no poll within the live-presence window); the cron sweeps leftovers.
CREATE TABLE IF NOT EXISTS coop_lobby (
  id          TEXT    PRIMARY KEY,   -- worker-minted presence id (client keeps it)
  name        TEXT    NOT NULL,      -- display name shown to other players
  seen_at     INTEGER NOT NULL,      -- last poll/announce (epoch ms) = presence
  paired_code TEXT,                  -- run code once matched (null while waiting)
  paired_role TEXT,                  -- 'host' | 'guest' once matched
  created_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_coop_lobby_seen ON coop_lobby (seen_at);
