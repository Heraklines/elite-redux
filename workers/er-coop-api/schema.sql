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

-- P33 authenticated signaling. Public clients receive a short-lived HMAC identity
-- ticket from er-save-api; this worker binds each ticket nonce exactly once and
-- stores only the derived bearer hash. Display names never authorize a run seat.
CREATE TABLE IF NOT EXISTS coop_ticket_bindings_p33 (
  ticket_nonce TEXT PRIMARY KEY,
  account_id TEXT NOT NULL,
  client_nonce TEXT NOT NULL,
  presence_id TEXT NOT NULL UNIQUE,
  bearer_hash TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS coop_lobby_p33 (
  presence_id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  canonical_username TEXT NOT NULL,
  ticket_nonce TEXT NOT NULL UNIQUE,
  client_nonce TEXT NOT NULL,
  bearer_hash TEXT NOT NULL,
  seen_at INTEGER NOT NULL,
  paired_code TEXT,
  transport_role TEXT,
  created_at INTEGER NOT NULL,
  req_from TEXT,
  req_at INTEGER,
  declined_name TEXT,
  room TEXT NOT NULL DEFAULT 'default'  -- per-run lobby namespace (#920); '' room-less clients share 'default'
);
CREATE INDEX IF NOT EXISTS idx_coop_lobby_p33_seen ON coop_lobby_p33 (seen_at);
-- Existing deployments migrate additively (the worker's ensureP33SignalingSchema also runs this;
-- ADD COLUMN throws if it already exists and is swallowed):
--   ALTER TABLE coop_lobby_p33 ADD COLUMN room TEXT NOT NULL DEFAULT 'default';

CREATE TABLE IF NOT EXISTS coop_runs_p33 (
  code TEXT PRIMARY KEY,
  offerer_presence_id TEXT NOT NULL,
  answerer_presence_id TEXT NOT NULL,
  offerer_account_id TEXT NOT NULL,
  answerer_account_id TEXT NOT NULL,
  offerer_display_name TEXT NOT NULL,
  answerer_display_name TEXT NOT NULL,
  offerer_canonical_username TEXT NOT NULL,
  answerer_canonical_username TEXT NOT NULL,
  offerer_bearer_hash TEXT NOT NULL,
  answerer_bearer_hash TEXT NOT NULL,
  offerer_generation INTEGER NOT NULL DEFAULT 0,
  answerer_generation INTEGER NOT NULL DEFAULT 0,
  offerer_seen_at INTEGER NOT NULL,
  answerer_seen_at INTEGER NOT NULL,
  state TEXT NOT NULL DEFAULT 'active',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_coop_runs_p33_updated ON coop_runs_p33 (updated_at);

CREATE TABLE IF NOT EXISTS coop_pair_members_p33 (
  presence_id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL UNIQUE,
  code TEXT NOT NULL,
  transport_role TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS coop_signals_p33 (
  code TEXT NOT NULL,
  from_role TEXT NOT NULL,
  signal TEXT NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (code, from_role)
);
