/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Elite Redux — in-game bug report assembly + submission (#220).
//
// Collects the player's free-text description plus a concise game-state snapshot
// and the recent console-log ring buffer, then:
//   1. POSTs it to a configurable form-to-email relay (VITE_BUGREPORT_ENDPOINT,
//      e.g. a Web3Forms submit URL) so it lands in the maintainer's inbox with
//      no account required from the player; and ALWAYS
//   2. copies the report to the clipboard and downloads it as a .json file, as
//      an offline fallback the player can paste/attach manually.
//
// Backend-less by design — works in a static (Guest-mode) deploy. Never throws.
// =============================================================================

import { globalScene } from "#app/global-scene";
import { version } from "#package.json";
import {
  captureCoopReportCorrelation,
  formatCoopControlPlane,
} from "#data/elite-redux/coop/coop-diagnostics";
import {
  formatCoopReportCorrelation,
  type CoopReportCorrelationV1,
} from "#data/elite-redux/coop/coop-report-correlation";
import { captureDeviceInfo, formatBootDiagnostics } from "#data/elite-redux/er-boot-diagnostics";
import { getErDifficulty } from "#data/elite-redux/er-run-difficulty";
import { getReplayTrace } from "#data/elite-redux/replay-recorder";
import {
  formatErBuildIdentity,
  getErBuildIdentity,
  type ErBuildIdentityV1,
} from "#utils/build-identity";
import { formatConsoleSnapshot } from "#utils/console-ring-buffer";

interface BugReportState {
  version: string;
  url: string;
  userAgent: string;
  /** #ios-stability: device fingerprint fields for mobile crash triage. */
  platform: string;
  screen: string;
  devicePixelRatio: number;
  deviceMemory: number | null;
  /** #ios-stability: boot-milestone breadcrumb + previous-session verdict (crash-then-reload). */
  bootMilestones: string;
  lastSession: string;
  timestamp: string;
  gameModeId: number | null;
  waveIndex: number | null;
  erDifficulty: string;
  seed: string | null;
  party: { species: string; level: number; hp: string }[];
}

export interface BugReport {
  description: string;
  state: BugReportState;
  /** Exact source/workflow/deployment identity. Contains no environment dump or credentials. */
  buildIdentity: ErBuildIdentityV1;
  /** Shared run/session axes for automatically pairing the host and guest reports from one incident. */
  coopCorrelation: CoopReportCorrelationV1 | null;
  logs: string;
  /**
   * #record-replay (Phase 2): the captured deterministic replay trace (JSON of a {@linkcode ReplayTrace}),
   * or `null` when nothing was recorded (single-player with the recorder off, or a menu report). The
   * recorder ring-buffers to the last few waves, so this stays small + bounded. A reported co-op bug thus
   * ships with a replayable trace the duo harness can re-run to reproduce + verify a fix.
   */
  replayTrace: string | null;
  /**
   * #diagnostics: the co-op CONTROL-PLANE snapshot (role / phase queue / awaited interaction / rendezvous
   * / transport lastRx), or `""` for a solo run / menu report. Assembled at report time from the live
   * runtime so a hung co-op session ships with the distributed-systems state a hang is actually diagnosed
   * from (a screenshot / the plain state header cannot show it).
   */
  controlPlane: string;
}

export interface BugReportResult {
  /** True if the report was successfully POSTed to the configured endpoint. */
  sent: boolean;
  /** True if the report was downloaded as a file. */
  downloaded: boolean;
  /** True if the report was copied to the clipboard. */
  copied: boolean;
}

function readEnv(name: string): string {
  const value = (import.meta.env as unknown as Record<string, unknown> | undefined)?.[name];
  return typeof value === "string" ? value : "";
}

/** Capture a concise snapshot of the current run state. Guards everything. */
function captureState(): BugReportState {
  const party =
    globalScene
      ?.getPlayerParty?.()
      ?.map(p => ({
        species: p?.species?.name ?? "?",
        level: p?.level ?? 0,
        hp: `${p?.hp ?? "?"}/${typeof p?.getMaxHp === "function" ? p.getMaxHp() : "?"}`,
      }))
      .slice(0, 6) ?? [];

  const device = captureDeviceInfo();
  const milestones = getBootMilestonesText();

  return {
    version,
    url: typeof location !== "undefined" ? location.href : "",
    userAgent: device.userAgent,
    platform: device.platform,
    screen: `${device.screenWidth}x${device.screenHeight} @${device.devicePixelRatio}x`,
    devicePixelRatio: device.devicePixelRatio,
    deviceMemory: device.deviceMemory,
    bootMilestones: milestones.trail,
    lastSession: milestones.lastSession,
    timestamp: new Date().toISOString(),
    gameModeId: globalScene?.gameMode?.modeId ?? null,
    waveIndex: globalScene?.currentBattle?.waveIndex ?? null,
    erDifficulty: getErDifficulty(),
    seed: globalScene?.seed ?? null,
    party,
  };
}

/**
 * #ios-stability: split the boot-diagnostics block into the milestone trail + last-session verdict
 * for the structured JSON state. Falls back to safe strings; never throws.
 */
function getBootMilestonesText(): { trail: string; lastSession: string } {
  try {
    const text = formatBootDiagnostics();
    const bootLine = text.split("\n").find(l => l.startsWith("boot:")) ?? "";
    const lastLine = text.split("\n").find(l => l.startsWith("lastSess:")) ?? "";
    return {
      trail: bootLine.replace(/^boot:\s*/, ""),
      lastSession: lastLine.replace(/^lastSess:\s*/, ""),
    };
  } catch {
    return { trail: "", lastSession: "" };
  }
}

/**
 * #record-replay (Phase 2): serialize the captured replay trace for the report, or `null` if nothing was
 * recorded. Guarded so a serialize failure never breaks the bug-report path (the report still ships
 * without a trace).
 */
function captureReplayTrace(): string | null {
  try {
    const trace = getReplayTrace();
    return trace == null ? null : JSON.stringify(trace);
  } catch {
    return null;
  }
}

/** Assemble the full bug report payload. */
export function buildBugReport(description: string): BugReport {
  return {
    description,
    state: captureState(),
    buildIdentity: getErBuildIdentity(),
    coopCorrelation: captureCoopReportCorrelation(),
    logs: formatConsoleSnapshot(),
    replayTrace: captureReplayTrace(),
    controlPlane: captureControlPlane(),
  };
}

/**
 * #diagnostics: capture the co-op control-plane snapshot for the report, or `""` (solo / capture
 * failure). Guarded so a snapshot failure never breaks the bug-report path (the report still ships).
 */
function captureControlPlane(): string {
  try {
    return formatCoopControlPlane();
  } catch {
    return "";
  }
}

/** A human-readable subject line for the report. */
function reportSubject(report: BugReport): string {
  const { waveIndex, erDifficulty } = report.state;
  const where = waveIndex != null ? `wave ${waveIndex}` : "menu";
  return `[ER bug] ${erDifficulty} @ ${where}: ${report.description.slice(0, 60)}`;
}

function downloadReport(report: BugReport): boolean {
  if (typeof document === "undefined" || typeof URL?.createObjectURL !== "function") {
    return false;
  }
  try {
    const blob = new Blob([JSON.stringify(report, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `er-bug-report-${Date.now()}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    // Revoke after a tick so the download has a chance to start.
    setTimeout(() => URL.revokeObjectURL(url), 2000);
    return true;
  } catch {
    return false;
  }
}

async function copyReport(report: BugReport): Promise<boolean> {
  try {
    if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(JSON.stringify(report, null, 2));
      return true;
    }
  } catch {
    // Clipboard can reject (permissions / non-secure context) — non-fatal.
  }
  return false;
}

async function postReport(report: BugReport): Promise<boolean> {
  const endpoint = readEnv("VITE_BUGREPORT_ENDPOINT");
  if (!endpoint || typeof fetch !== "function") {
    return false;
  }
  const accessKey = readEnv("VITE_BUGREPORT_KEY");
  // Body shaped to be compatible with form-to-email relays such as Web3Forms
  // (which expect `access_key` + arbitrary fields) while also being a plain,
  // self-describing JSON payload for a custom endpoint / Discord-style webhook.
  const body: Record<string, unknown> = {
    subject: reportSubject(report),
    from_name: "Elite Redux Bug Reporter",
    description: report.description,
    state: report.state,
    buildIdentity: report.buildIdentity,
    coopCorrelation: report.coopCorrelation,
    logs: report.logs,
    // `content` mirrors the Discord-webhook field name so the same endpoint var
    // can target a webhook too (truncated to keep within typical limits).
    content: `${reportSubject(report)}\n\n${report.description}`.slice(0, 1800),
  };
  if (accessKey) {
    body.access_key = accessKey;
  }
  try {
    const res = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(body),
    });
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * The same remote sink the dev-tools "Send Logs" button uses: the er-editor-api
 * worker commits each report onto the repo's `dev-logs` branch, which the
 * maintainer pulls with scripts/pull-dev-logs.mjs. This is the PRIMARY channel for
 * the in-game "Report a bug" button (works in prod with no player account), so
 * every report lands where we already collect Send-Logs captures.
 */
const DEVLOG_SINK_URL = "https://er-editor-api.heraklines.workers.dev/devlog";

/**
 * The delimiter that fences the serialized {@linkcode ReplayTrace} JSON in the devlog capture text, so a
 * headless replay tool (`scripts/replay-run.mjs`) can EXTRACT the trace back out of a plain `.log` and
 * re-drive the run. Exported so the extractor keys off the exact same marker. (#record-replay)
 */
export const DEVLOG_REPLAY_TRACE_MARKER = "----- REPLAY TRACE (JSON) -----";

/** Render the report as the plain-text capture format the /devlog sink stores. */
export function buildDevLogText(report: BugReport): string {
  const s = report.state;
  const party = s.party.map(p => `${p.species}(L${p.level} ${p.hp})`).join(", ");
  return [
    "----- BUG REPORT (in-game) -----",
    `version:  ${s.version}`,
    `build:    ${report.buildIdentity.id}`,
    `url:      ${s.url}`,
    `ua:       ${s.userAgent}`,
    // #ios-stability: device fingerprint + boot breadcrumb (a crash-then-reload reports where the
    // previous session died) — the fields an iOS crash report needs and previously lacked.
    `platform: ${s.platform}`,
    `screen:   ${s.screen}  devmem:${s.deviceMemory != null ? `${s.deviceMemory} GB` : "?"}`,
    `boot:     ${s.bootMilestones || "(none)"}`,
    `lastSess: ${s.lastSession || "n/a"}`,
    `mode:     ${s.gameModeId}  wave:${s.waveIndex}  difficulty:${s.erDifficulty}`,
    `seed:     ${s.seed}`,
    `party:    ${party}`,
    "",
    "----- DESCRIPTION -----",
    report.description.trim() || "(none)",
    "",
    formatErBuildIdentity(report.buildIdentity),
    "",
    ...(report.coopCorrelation == null ? [] : [formatCoopReportCorrelation(report.coopCorrelation), ""]),
    // #diagnostics: the co-op control-plane block (omitted for a solo run / menu report, where it is "").
    ...(report.controlPlane ? [report.controlPlane, ""] : []),
    "----- CONSOLE -----",
    report.logs,
    "",
    // #record-replay: embed the deterministic replay trace (one line of JSON, or "(none)") so the .log
    // capture on the dev-logs branch is self-contained + replayable by scripts/replay-run.mjs.
    DEVLOG_REPLAY_TRACE_MARKER,
    report.replayTrace ?? "(none)",
    "",
  ].join("\n");
}

/** POST the report to the /devlog sink (the Send-Logs pipeline). Never throws. */
async function postToDevLog(report: BugReport): Promise<boolean> {
  if (typeof fetch !== "function") {
    return false;
  }
  try {
    const res = await fetch(DEVLOG_SINK_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        by: "player",
        scenario: "bug-report",
        comment: report.description,
        report: buildDevLogText(report),
      }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * Submit a bug report. PRIMARY channel is the /devlog sink (the same place the
 * Send Logs button delivers to - the repo's dev-logs branch), so it works in prod
 * and the maintainer gets everything via pull-dev-logs.mjs. Also fires the optional
 * email/webhook relay if one is configured, and ALWAYS copies + downloads as an
 * offline fallback. Never throws - returns which channels succeeded.
 */
export async function submitBugReport(description: string): Promise<BugReportResult> {
  const report = buildBugReport(description);
  const [devlogOk, relayOk, copied] = await Promise.all([
    postToDevLog(report),
    postReport(report),
    copyReport(report),
  ]);
  const downloaded = downloadReport(report);
  return { sent: devlogOk || relayOk, downloaded, copied };
}
