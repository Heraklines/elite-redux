/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// Unit tests for the in-game bug reporter assembly + console ring buffer (#220).

import { buildBugReport, buildDevLogText } from "#data/elite-redux/er-bug-report";
import {
  COOP_REPORT_CORRELATION_MARKER,
  createCoopReportCorrelation,
} from "#data/elite-redux/coop/coop-report-correlation";
import { resetErDifficulty, setErDifficulty } from "#data/elite-redux/er-run-difficulty";
import { ER_BUILD_IDENTITY_MARKER } from "#utils/build-identity";
import { formatConsoleSnapshot, getConsoleSnapshot, installConsoleRingBuffer } from "#utils/console-ring-buffer";
import { afterEach, describe, expect, it } from "vitest";

describe("ER bug report", () => {
  afterEach(() => {
    resetErDifficulty();
  });

  it("console ring buffer captures recent console output", () => {
    installConsoleRingBuffer();
    const marker = `er-bug-report-test-${Math.floor(performance.now())}`;
    console.log(marker);
    const snapshot = getConsoleSnapshot();
    expect(snapshot.some(e => e.message.includes(marker))).toBe(true);
    expect(formatConsoleSnapshot()).toContain(marker);
  });

  it("buildBugReport bundles description, state and logs", () => {
    setErDifficulty("hell");
    const report = buildBugReport("the game froze after EXP");
    expect(report.description).toBe("the game froze after EXP");
    expect(report.state.erDifficulty).toBe("hell");
    expect(report.state.version).toBeTruthy();
    expect(report.buildIdentity.id).toBeTruthy();
    expect(report.coopCorrelation).toBeNull();
    expect(typeof report.logs).toBe("string");
    // party is captured defensively even with no active scene.
    expect(Array.isArray(report.state.party)).toBe(true);
    const devlog = buildDevLogText(report);
    expect(devlog).toContain(`build:    ${report.buildIdentity.id}`);
    expect(devlog).toContain(ER_BUILD_IDENTITY_MARKER);

    const correlation = createCoopReportCorrelation({
      runId: "run-report-serialization",
      epoch: 1234,
      seed: "paired-seed",
      membershipRevision: 5,
      membershipConnectionGeneration: 2,
      localRole: "host",
      localSeat: 0,
      partnerRole: "guest",
      partnerSeat: 1,
      build: report.buildIdentity,
    });
    const pairedDevlog = buildDevLogText({ ...report, coopCorrelation: correlation });
    const correlationJson = pairedDevlog.split(`${COOP_REPORT_CORRELATION_MARKER}\n`)[1]?.split("\n", 1)[0];
    expect(JSON.parse(correlationJson ?? "null")).toEqual(correlation);
  });
});
