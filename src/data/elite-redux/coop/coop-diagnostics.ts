/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// CO-OP CONTROL-PLANE SNAPSHOT for bug reports (#diagnostics).
//
// A live co-op hang is a distributed-systems bug: the interesting state is not the game render but
// the CONTROL PLANE - which role this client is, what its phase queue looks like, which interaction /
// rendezvous it is parked on, and whether the partner's frames are still arriving. None of that is in
// a screenshot or the plain state header, so a triaged report used to be un-diagnosable ("it froze").
//
// This module assembles a COMPACT, self-describing text block from the LIVE runtime AT REPORT TIME
// (never continuously - zero hot-path cost) and is attached to BOTH report paths (the in-game "Report a
// bug" button via er-bug-report.ts, and the dev-tools "Send Logs" button). Every read is PASSIVE:
// it only reads already-tracked runtime fields (no protocol frames, no state mutation), and the whole
// thing is guarded so a capture failure never breaks a report. Returns "" when not in a co-op run.
// =============================================================================

import { globalScene } from "#app/global-scene";
import { formatCoopCausalTrace } from "#data/elite-redux/coop/coop-causal-trace";
import {
  type CoopReportCorrelationV1,
  createCoopReportCorrelation,
  formatCoopReportCorrelation,
} from "#data/elite-redux/coop/coop-report-correlation";
import {
  type CoopRuntime,
  coopSessionGeneration,
  getCoopNetcodeMode,
  getCoopRuntime,
} from "#data/elite-redux/coop/coop-runtime";
import type { CoopTransport } from "#data/elite-redux/coop/coop-transport";
import { formatCoopUiRelayTrace } from "#data/elite-redux/coop/coop-ui-relay-trace";
import { getErBuildIdentity } from "#utils/build-identity";

/** The fenced header that opens the control-plane block (kept stable so a triage tool can key off it). */
export const COOP_CONTROL_PLANE_MARKER = "----- CO-OP CONTROL PLANE -----";

/** Format a transport's last-inbound-frame age as a compact `<n>s` / `never` token. */
function formatLastRx(transport: CoopTransport | undefined): string {
  if (transport == null) {
    return "-";
  }
  const ms = transport.lastRxMs?.();
  return ms == null ? "never" : `${Math.round(ms / 1000)}s`;
}

/**
 * Capture only the immutable axes needed to pair the two clients' reports. Account ids, display names,
 * signaling bearers and arbitrary environment values are deliberately absent.
 */
export function captureCoopReportCorrelation(): CoopReportCorrelationV1 | null {
  const runtime = getCoopRuntime();
  if (runtime == null) {
    return null;
  }
  try {
    const controller = runtime.controller;
    const binding = safe(() => controller.authenticatedBinding) ?? null;
    const localRole = controller.role;
    const localSeat = safe(() => controller.localSeatId) ?? safe(() => controller.seat) ?? null;
    let partnerSeat =
      binding?.seatMap.seats.find(seat => seat.seatId !== localSeat)?.seatId
      ?? safe(() => runtime.membership.snapshot().members.find(member => member.seatId !== localSeat)?.seatId)
      ?? null;
    if (!Number.isSafeInteger(partnerSeat) || (partnerSeat as number) < 0) {
      partnerSeat = null;
    }
    return createCoopReportCorrelation({
      runId: safe(() => controller.runId) ?? null,
      epoch: safe(() => controller.sessionEpoch) ?? null,
      seed: safe(() => globalScene.seed) ?? null,
      bindingId: binding?.bindingId ?? null,
      sessionId: binding?.sessionId ?? null,
      bindingSource: binding?.source ?? null,
      authoritySeat: binding?.authoritySeatId ?? safe(() => controller.authoritySeatId) ?? null,
      localRole,
      localSeat,
      partnerRole: localRole === "host" ? "guest" : "host",
      partnerSeat,
      build: getErBuildIdentity(),
    });
  } catch {
    return null;
  }
}

/** Fenced one-line JSON for the plain-text Send Logs path, or `""` outside a live co-op session. */
export function formatLiveCoopReportCorrelation(): string {
  const correlation = captureCoopReportCorrelation();
  return correlation == null ? "" : formatCoopReportCorrelation(correlation);
}

function formatSessionLine(runtime: CoopRuntime): string {
  const controller = runtime.controller;
  const binding = safe(() => controller.authenticatedBinding);
  const mismatches = [
    controller.versionMismatch ? "VERSION-MISMATCH" : null,
    controller.functionalFingerprintMismatch ? "FUNCTIONAL-FINGERPRINT-MISMATCH" : null,
    controller.presentationFingerprintMismatch ? "PRESENTATION-FINGERPRINT-MISMATCH" : null,
  ].filter(value => value != null);
  return (
    `session:  role=${controller.role} seat=${safe(() => String(controller.localSeatId ?? controller.seat))}`
    + ` gen=${coopSessionGeneration()}g epoch=${safe(() => controller.sessionEpoch) ?? "-"}`
    + ` run=${safe(() => controller.runId) || "-"} binding=${binding?.bindingId ?? "-"}`
    + ` sessionId=${binding?.sessionId ?? "-"} netcode=${getCoopNetcodeMode()}`
    + (mismatches.length === 0 ? "" : ` ${mismatches.join(" ")}`)
  );
}

/**
 * Assemble the co-op CONTROL-PLANE snapshot as a compact text block, or `""` when there is no live
 * co-op session (a solo run / menu report attaches nothing). Read ON DEMAND from the live runtime:
 *  - session identifiers: role / seat / session-generation / netcode
 *  - the phase manager: the running phase + the queued phase names IN ORDER
 *  - the interaction plane: the interaction counter + every currently-awaited pick (seq, accepted
 *    kinds, wait age) - a growing wait here is the pending interaction the whole session is blocked on
 *  - the rendezvous plane: which sync points this client / the partner have arrived at + which are awaited
 *  - the transport: per-peer connection state + the last-received-frame age (a dead/suspended tab that
 *    stopped even keepalives reads a growing lastRx, distinguishing it from a merely dropped operation)
 * Fully guarded - any read failing degrades to a partial block, never a thrown report.
 */
export function formatCoopControlPlane(): string {
  const runtime = getCoopRuntime();
  if (runtime == null) {
    return "";
  }
  try {
    const controller = runtime.controller;
    const lines: string[] = [COOP_CONTROL_PLANE_MARKER];

    // --- Session identifiers ---
    lines.push(formatSessionLine(runtime));
    const membership = safe(() => runtime.membership.snapshot());
    if (membership != null) {
      lines.push(
        `members:  rev=${membership.revision} state=${membership.state} connectionGen=${membership.connectionGeneration} `
          + `present=[${membership.members.map(member => `${member.seatId}:${member.role}=${member.present}`).join(", ")}]`,
      );
    }

    // --- Phase manager (running + queued, in run order) ---
    const running = safe(() => globalScene.phaseManager?.getCurrentPhase?.()?.phaseName) ?? "-";
    const queued = safe(() => globalScene.phaseManager?.getQueuedPhaseNames?.()) ?? [];
    lines.push(`phase:    running=${running} queue=[${queued.join(", ")}]`);

    // --- Interaction plane (counter + awaited picks) ---
    const counter = safe(() => controller.interactionCounter());
    const awaited = safe(() => runtime.interactionRelay.describeAwaitedInteractions()) ?? [];
    const awaitedStr =
      awaited.length === 0
        ? "none"
        : awaited
            .map(
              a =>
                `seq${a.seq}[${a.expectedKinds.length > 0 ? a.expectedKinds.join("/") : "any"}]@${Math.round(a.ageMs / 1000)}s`,
            )
            .join(", ");
    lines.push(`interact: counter=${counter ?? "-"} awaiting=${awaitedStr}`);

    const commands = safe(() => runtime.battleSync.describePendingRequests()) ?? [];
    lines.push(
      `commands: pending=[${commands
        .map(command => `${command.owner ?? command.fieldIndex}@t${command.turn}{${command.moveSlots.join("/")}}`)
        .join(", ")}]`,
    );

    // --- Rendezvous plane (arrivals + awaited barriers) ---
    const rv = safe(() => runtime.rendezvous.describeArrivals());
    if (rv != null) {
      lines.push(
        `rendez:   awaiting=[${rv.awaiting.join(", ")}] localArrived=[${rv.localArrived.join(", ")}] partnerArrived=[${rv.partnerArrived.join(", ")}]`,
      );
    }

    // --- Transport (state + last-received-frame per peer) ---
    const local = runtime.localTransport;
    lines.push(
      `transport(local): state=${safe(() => local.state) ?? "-"} generation=${local.connectionGeneration?.() ?? "-"} lastRx=${formatLastRx(local)}`,
    );
    if (runtime.partnerTransport != null) {
      const partner = runtime.partnerTransport;
      lines.push(`transport(partner): state=${safe(() => partner.state) ?? "-"} lastRx=${formatLastRx(partner)}`);
    }

    // --- Structured causality (commit -> materialize -> apply, lobby decisions, recovery edges) ---
    lines.push(formatCoopCausalTrace());
    lines.push(formatCoopUiRelayTrace());

    return lines.join("\n");
  } catch (err) {
    return `${COOP_CONTROL_PLANE_MARKER}\ncontrol-plane capture failed: ${String(err)}`;
  }
}

/** Run `fn`, swallowing any throw (a single failing read must not abort the whole block). */
function safe<T>(fn: () => T): T | undefined {
  try {
    return fn();
  } catch {
    return;
  }
}
