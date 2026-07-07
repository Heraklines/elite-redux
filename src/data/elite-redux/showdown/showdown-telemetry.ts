/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Showdown 1v1 BATTLE TELEMETRY (Task D5) — HOST-side recorder for balance analytics.
// The host is the sole authoritative engine, so it alone records. At battle start it
// captures the immutable match setup (both manifests + seed + client version); at
// result/void it seals a compact record + summary and fire-and-forgets it to the
// telemetry worker (`workers/er-telemetry`, POST /telemetry/battle).
//
// SCOPE: records the match SETUP (both full manifests + seed → the STARTING state is
// reproducible) + the OUTCOME summary (winner, reason, turns, duration, per-side species/
// form/item sixes) + the FULL per-turn ReplayTrace. Recording is begun for the showdown HOST
// at EncounterPhase (coop-runtime.maybeBeginReplayRecording); the host's own player-side
// commands ride the existing single-player command tap (fires for any non-coop recording run),
// and the ENEMY side's per-turn command (relayed-or-AI) is tapped in EnemyCommandPhase's versus
// branch — so `getReplayTrace()` at seal carries BOTH sides' decisions and every stat is derivable
// offline by replaying (see the plan doc's "showdown replay loader" follow-up for the re-drive tool).
//
// GZIP SIDE (decision): the payload is sent as PLAIN JSON (a 30-turn match is well under
// the worker's 64KB body cap); the WORKER gzips it into the `trace_gz` blob before storing.
// This keeps the recorder pure + testable (no client CompressionStream).
//
// Fire-and-forget: a telemetry POST NEVER blocks or throws into the result flow. A failure
// or an absent endpoint is logged only.
// =============================================================================

import { SESSION_ID_COOKIE_NAME } from "#app/constants";
import { globalScene } from "#app/global-scene";
import { getReplayTrace } from "#data/elite-redux/replay-recorder";
import type { ShowdownMonManifest } from "#data/elite-redux/showdown/showdown-team";
import { version } from "#package.json";
import { getCookie } from "#utils/cookies";

/** One mon's telemetry fingerprint (what won/lost with what). */
export interface TelemetryMon {
  speciesId: number;
  formIndex: number;
  rootSpeciesId: number;
  item: string;
  shiny: boolean;
  variant: number;
}

/** The denormalized summary row the worker stores for direct SQL. */
export interface ShowdownTelemetrySummary {
  matchId: string | null;
  hostUid: string;
  guestUid: string;
  winner: "host" | "guest" | null;
  reason: string;
  voided: boolean;
  turns: number;
  durationMs: number;
  clientVersion: string;
  seed: string | null;
  hostTeam: TelemetryMon[];
  guestTeam: TelemetryMon[];
}

/** The full record posted to the telemetry worker (summary + optional replay trace). */
export interface ShowdownTelemetryPayload extends ShowdownTelemetrySummary {
  createdAt: number;
  /** The opportunistically-attached ReplayTrace, when the recorder was on; else null. */
  replayTrace: unknown | null;
}

/** The immutable match setup captured at battle start (host-side). */
interface TelemetryRecord {
  matchId: string | null;
  hostUid: string;
  guestUid: string;
  hostTeam: ShowdownMonManifest[];
  guestTeam: ShowdownMonManifest[];
  seed: string | null;
  clientVersion: string;
  startedAt: number;
}

let record: TelemetryRecord | null = null;

/** PURE: a mon manifest → its telemetry fingerprint. */
export function toTelemetryMon(m: ShowdownMonManifest): TelemetryMon {
  return {
    speciesId: m.speciesId,
    formIndex: m.formIndex,
    rootSpeciesId: m.rootSpeciesId,
    item: m.item,
    shiny: m.shiny,
    variant: m.variant,
  };
}

/**
 * PURE: build the sealed telemetry payload from the captured record + the outcome. Extracted so
 * the record-building + summary shape is unit-testable without a scene / network.
 */
export function buildShowdownTelemetryPayload(
  rec: TelemetryRecord,
  outcome: { winner: "host" | "guest" | null; reason: string; voided: boolean; turns: number },
  now: number,
  replayTrace: unknown | null,
): ShowdownTelemetryPayload {
  return {
    matchId: rec.matchId,
    hostUid: rec.hostUid,
    guestUid: rec.guestUid,
    winner: outcome.voided ? null : outcome.winner,
    reason: outcome.reason,
    voided: outcome.voided,
    turns: outcome.turns,
    durationMs: Math.max(0, now - rec.startedAt),
    clientVersion: rec.clientVersion,
    seed: rec.seed,
    hostTeam: rec.hostTeam.map(toTelemetryMon),
    guestTeam: rec.guestTeam.map(toTelemetryMon),
    createdAt: now,
    replayTrace,
  };
}

/**
 * Begin a HOST-side telemetry record at battle start. No-op for the guest (only the host runs the
 * authoritative engine). `hostTeam`/`guestTeam` are the two full manifests; `matchId` is the escrow
 * id (null for a friendly). Idempotent overwrite (a rematch supersedes).
 */
export function beginShowdownTelemetry(input: {
  role: "host" | "guest";
  matchId: string | null;
  hostUid: string;
  guestUid: string;
  hostTeam: ShowdownMonManifest[];
  guestTeam: ShowdownMonManifest[];
}): void {
  if (input.role !== "host") {
    record = null;
    return;
  }
  record = {
    matchId: input.matchId,
    hostUid: input.hostUid,
    guestUid: input.guestUid,
    hostTeam: input.hostTeam,
    guestTeam: input.guestTeam,
    seed: globalScene?.seed ?? null,
    clientVersion: version,
    startedAt: Date.now(),
  };
}

/** Drop the record without sending (a non-host / no-active-record teardown). */
export function clearShowdownTelemetry(): void {
  record = null;
}

/** The telemetry worker base URL, or null when unconfigured. Own env, else the save-API host. */
function telemetryBase(): string | null {
  const env = import.meta.env as { VITE_SERVER_URL_TELEMETRY?: string; VITE_SERVER_URL?: string };
  const url = env.VITE_SERVER_URL_TELEMETRY ?? env.VITE_SERVER_URL ?? "";
  return url ? url.replace(/\/$/, "") : null;
}

/**
 * Seal + fire-and-forget the HOST's telemetry for this match. No-op when no host record is active.
 * NEVER throws / blocks: a POST failure or absent endpoint is logged only. Clears the record after.
 */
export function sealShowdownTelemetry(outcome: {
  winner: "host" | "guest" | null;
  reason: string;
  voided: boolean;
}): void {
  const rec = record;
  record = null;
  if (rec == null) {
    return;
  }
  try {
    const turns = globalScene?.currentBattle?.turn ?? 0;
    // Attach the ReplayTrace opportunistically (best-effort — present only if recording was on).
    let replayTrace: unknown | null = null;
    try {
      replayTrace = getReplayTrace();
    } catch {
      replayTrace = null;
    }
    const payload = buildShowdownTelemetryPayload(rec, { ...outcome, turns }, Date.now(), replayTrace);
    const base = telemetryBase();
    if (base == null) {
      return; // no endpoint configured (local dev) — nothing to send
    }
    void fetch(`${base}/telemetry/battle`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: getCookie(SESSION_ID_COOKIE_NAME) },
      body: JSON.stringify(payload),
    }).catch(err => console.warn("[showdown-telemetry] send failed (non-fatal):", err));
  } catch (err) {
    console.warn("[showdown-telemetry] seal failed (non-fatal):", err);
  }
}
