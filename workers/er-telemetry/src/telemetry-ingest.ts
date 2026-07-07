/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Showdown battle telemetry — PURE ingest validation (Task D5). Zero Cloudflare deps
// so it imports cleanly into a plain vitest (the worker-test pattern from D1). The
// worker (`index.ts`) authenticates + persists; ALL shape/bounds validation lives here.
//
// The client posts a compact JSON payload (match setup + outcome summary + optional
// ReplayTrace). We validate it into a normalized `TelemetryRow` the worker stores;
// anything malformed is rejected loudly rather than written.
// =============================================================================

/** One mon fingerprint in a team six. */
export interface TelemetryMon {
  speciesId: number;
  formIndex: number;
  rootSpeciesId: number;
  item: string;
  shiny: boolean;
  variant: number;
}

/** The normalized row the worker persists (denormalized columns + the JSON blobs). */
export interface TelemetryRow {
  matchId: string | null;
  hostUid: string;
  guestUid: string;
  winner: "host" | "guest" | null;
  reason: string;
  turns: number;
  durationMs: number;
  createdAt: number;
  /** The full payload JSON string (the worker gzips it into the trace_gz blob). */
  traceJson: string;
  /** The denormalized summary JSON string (teams + version + seed) for direct SQL. */
  summaryJson: string;
}

export type IngestResult = { ok: true; row: TelemetryRow } | { ok: false; error: string };

/** Hard cap on the raw POST body (matches the worker's request cap). */
export const TELEMETRY_MAX_BODY = 64 * 1024;

const isInt = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v);
const isStr = (v: unknown): v is string => typeof v === "string";

function validMon(v: unknown): v is TelemetryMon {
  if (typeof v !== "object" || v === null) {
    return false;
  }
  const m = v as Record<string, unknown>;
  return (
    isInt(m.speciesId)
    && isInt(m.formIndex)
    && isInt(m.rootSpeciesId)
    && isStr(m.item)
    && typeof m.shiny === "boolean"
    && isInt(m.variant)
  );
}

function validTeam(v: unknown): v is TelemetryMon[] {
  return Array.isArray(v) && v.length > 0 && v.length <= 6 && v.every(validMon);
}

/**
 * Validate + normalize an authenticated telemetry payload. `authUser` is the poster's
 * username (from the token) — it MUST be one of the two named participants (anti-spoof:
 * you can't file telemetry for a match you weren't in). Returns the row to persist or an error.
 */
export function validateTelemetryPayload(body: unknown, authUser: string): IngestResult {
  if (typeof body !== "object" || body === null) {
    return { ok: false, error: "body must be an object" };
  }
  const p = body as Record<string, unknown>;

  const matchId = p.matchId == null ? null : isStr(p.matchId) ? p.matchId : undefined;
  if (matchId === undefined) {
    return { ok: false, error: "matchId must be a string or null" };
  }
  if (!isStr(p.hostUid) || !isStr(p.guestUid) || p.hostUid.length === 0 || p.guestUid.length === 0) {
    return { ok: false, error: "hostUid/guestUid required" };
  }
  if (authUser !== p.hostUid && authUser !== p.guestUid) {
    return { ok: false, error: "not a participant" };
  }
  const winner = p.winner === "host" || p.winner === "guest" ? p.winner : p.winner == null ? null : undefined;
  if (winner === undefined) {
    return { ok: false, error: "winner must be host/guest/null" };
  }
  if (!isStr(p.reason) || p.reason.length > 32) {
    return { ok: false, error: "reason required" };
  }
  if (!isInt(p.turns) || p.turns < 0 || p.turns > 10_000) {
    return { ok: false, error: "turns out of range" };
  }
  if (!isInt(p.durationMs) || p.durationMs < 0) {
    return { ok: false, error: "durationMs out of range" };
  }
  if (!validTeam(p.hostTeam) || !validTeam(p.guestTeam)) {
    return { ok: false, error: "hostTeam/guestTeam malformed" };
  }
  const seed = p.seed == null ? null : isStr(p.seed) ? p.seed : undefined;
  if (seed === undefined) {
    return { ok: false, error: "seed must be a string or null" };
  }
  const clientVersion = isStr(p.clientVersion) ? p.clientVersion.slice(0, 32) : "";
  const createdAt = isInt(p.createdAt) ? p.createdAt : Date.now();

  const summary = {
    hostTeam: p.hostTeam,
    guestTeam: p.guestTeam,
    clientVersion,
    seed,
  };
  return {
    ok: true,
    row: {
      matchId,
      hostUid: p.hostUid,
      guestUid: p.guestUid,
      winner,
      reason: p.reason,
      turns: p.turns,
      durationMs: p.durationMs,
      createdAt,
      // The whole payload becomes the replayable trace blob; the summary is a compact projection.
      traceJson: JSON.stringify(body),
      summaryJson: JSON.stringify(summary),
    },
  };
}
