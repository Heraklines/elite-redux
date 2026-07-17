/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// Unit tests for the in-game bug reporter assembly + console ring buffer (#220).

import {
  captureDeviceInfo,
  formatBootDiagnostics,
  getBootMilestones,
  initBootDiagnostics,
  markBootMilestone,
} from "#data/elite-redux/er-boot-diagnostics";
import { buildBugReport } from "#data/elite-redux/er-bug-report";
import { resetErDifficulty, setErDifficulty } from "#data/elite-redux/er-run-difficulty";
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
    expect(typeof report.logs).toBe("string");
    // party is captured defensively even with no active scene.
    expect(Array.isArray(report.state.party)).toBe(true);
  });

  it("buildBugReport carries the device fingerprint + boot-milestone diagnostics", () => {
    const report = buildBugReport("crashes on load");
    // #ios-stability: the new device/boot fields exist and are typed as expected.
    expect(typeof report.state.platform).toBe("string");
    expect(typeof report.state.screen).toBe("string");
    expect(typeof report.state.devicePixelRatio).toBe("number");
    expect(report.state.deviceMemory === null || typeof report.state.deviceMemory === "number").toBe(true);
    expect(typeof report.state.bootMilestones).toBe("string");
    expect(typeof report.state.lastSession).toBe("string");
  });
});

describe("ER boot diagnostics", () => {
  it("captureDeviceInfo returns a fully-populated, guarded fingerprint", () => {
    const d = captureDeviceInfo();
    expect(typeof d.userAgent).toBe("string");
    expect(typeof d.platform).toBe("string");
    expect(typeof d.screenWidth).toBe("number");
    expect(typeof d.screenHeight).toBe("number");
    expect(typeof d.devicePixelRatio).toBe("number");
    expect(d.deviceMemory === null || typeof d.deviceMemory === "number").toBe(true);
  });

  it("records boot milestones once each and formats a header block", () => {
    initBootDiagnostics();
    markBootMilestone("loading-complete");
    markBootMilestone("loading-complete"); // duplicate is ignored
    markBootMilestone("title-shown");
    const names = getBootMilestones().map(m => m.name);
    expect(names).toContain("boot-start");
    expect(names).toContain("loading-complete");
    expect(names).toContain("title-shown");
    // dedupe: loading-complete appears exactly once.
    expect(names.filter(n => n === "loading-complete")).toHaveLength(1);
    const block = formatBootDiagnostics();
    expect(block).toContain("boot:");
    expect(block).toContain("lastSess:");
    expect(block).toContain("title-shown");
  });
});
