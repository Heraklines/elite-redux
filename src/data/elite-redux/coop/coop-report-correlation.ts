/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import type { ErBuildIdentityV1 } from "#utils/build-identity";

export const COOP_REPORT_CORRELATION_MARKER = "----- CO-OP REPORT CORRELATION (JSON) -----";

export type CoopReportRole = "host" | "guest";

export interface CoopReportEndpointV1 {
  role: CoopReportRole;
  seat: number | null;
}

export interface CoopReportBindingV1 {
  bindingId: string;
  sessionId: string;
  source: "fresh" | "resume" | "showdown";
  authoritySeat: number;
}

/**
 * Machine-readable axes shared by the two reports from one co-op incident. No display names, account ids,
 * pairing bearers or credentials are accepted by this schema.
 */
export interface CoopReportCorrelationV1 {
  version: 1;
  pairKey: string;
  runId: string | null;
  epoch: number;
  seed: string | null;
  binding: CoopReportBindingV1 | null;
  local: CoopReportEndpointV1;
  partner: CoopReportEndpointV1;
  build: ErBuildIdentityV1;
}

export interface CoopReportCorrelationInput {
  runId?: string | null;
  epoch?: number | null;
  seed?: string | null;
  bindingId?: string | null;
  sessionId?: string | null;
  bindingSource?: "fresh" | "resume" | "showdown" | null;
  authoritySeat?: number | null;
  localRole: CoopReportRole;
  localSeat?: number | null;
  partnerRole: CoopReportRole;
  partnerSeat?: number | null;
  build: ErBuildIdentityV1;
}

function opaque(value: string | null | undefined, maxLength = 256): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const cleaned = [...value]
    .filter(character => {
      const codePoint = character.codePointAt(0) ?? 0;
      return codePoint > 0x1f && codePoint !== 0x7f;
    })
    .join("")
    .trim()
    .slice(0, maxLength);
  return cleaned || null;
}

function coordinate(value: number | null | undefined, fallback: number | null = null): number | null {
  return Number.isSafeInteger(value) && (value as number) >= 0 ? (value as number) : fallback;
}

function pairKey(input: {
  sessionId: string | null;
  runId: string | null;
  epoch: number;
  seed: string | null;
}): string {
  // Build is intentionally absent: two peers on mismatched/stale bundles must still pair as one incident.
  const axes = [
    ["session", input.sessionId],
    ["run", input.runId],
    ["epoch", String(input.epoch)],
    ["seed", input.seed],
  ] as const;
  return `coop-v1|${axes.map(([name, value]) => `${name}=${encodeURIComponent(value ?? "-")}`).join("|")}`;
}

/** Create the immutable correlation payload from already-captured runtime coordinates. */
export function createCoopReportCorrelation(input: CoopReportCorrelationInput): CoopReportCorrelationV1 {
  const runId = opaque(input.runId);
  const epoch = coordinate(input.epoch, 0) ?? 0;
  const seed = opaque(input.seed, 128);
  const bindingId = opaque(input.bindingId);
  const sessionId = opaque(input.sessionId);
  const authoritySeat = coordinate(input.authoritySeat);
  const binding =
    bindingId != null && sessionId != null && input.bindingSource != null && authoritySeat != null
      ? { bindingId, sessionId, source: input.bindingSource, authoritySeat }
      : null;
  return {
    version: 1,
    pairKey: pairKey({ sessionId, runId, epoch, seed }),
    runId,
    epoch,
    seed,
    binding,
    local: { role: input.localRole, seat: coordinate(input.localSeat) },
    partner: { role: input.partnerRole, seat: coordinate(input.partnerSeat) },
    build: input.build,
  };
}

/** Stable fenced JSON for plain-text devlog captures. */
export function formatCoopReportCorrelation(correlation: CoopReportCorrelationV1): string {
  return `${COOP_REPORT_CORRELATION_MARKER}\n${JSON.stringify(correlation)}`;
}
