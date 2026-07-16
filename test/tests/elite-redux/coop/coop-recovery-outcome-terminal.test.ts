/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import type { CoopStateSyncFailure } from "#data/elite-redux/coop/coop-battle-stream";
import type { CoopRuntime } from "#data/elite-redux/coop/coop-runtime";
import { failCoopRecoveryOutcome, isCoopSharedTerminalFrozen } from "#data/elite-redux/coop/coop-runtime";
import { readFileSync } from "node:fs";
import { resolve as resolvePath } from "node:path";
import { describe, expect, it } from "vitest";

function stubRuntime(): CoopRuntime {
  return {
    controller: {
      sessionEpoch: 4,
      role: "guest",
      interactionCounter: () => 0,
    },
    membership: { terminate: () => {} },
    battleSync: { freezeForTerminal: () => {} },
    interactionRelay: { cancelWaiters: () => {} },
  } as unknown as CoopRuntime;
}

describe("closed recovery outcomes", () => {
  it("routes rejoin, stall, Mystery checksum, and turn checksum failures through the terminal helper", () => {
    const runtime = readFileSync(resolvePath(process.cwd(), "src/data/elite-redux/coop/coop-runtime.ts"), "utf8");
    const replay = readFileSync(resolvePath(process.cwd(), "src/phases/coop-replay-phases.ts"), "utf8");
    for (const reason of ["rejoin", "stall", "mystery-checksum"]) {
      expect(runtime).toMatch(
        new RegExp(
          `requestStateSync\\("${reason}"\\)\\.then\\(result => \\{[\\s\\S]{0,600}?failCoopRecoveryOutcome\\(runtime, result,`,
          "u",
        ),
      );
    }
    expect(replay).toMatch(
      /requestStateSync\("turn-checksum"\)\.then\(result => \{[\s\S]{0,600}?failCoopRecoveryOutcome\(runtime, result,/u,
    );
  });

  it.each([
    ["guest/host frontier mismatch", { kind: "superseded" }],
    ["host snapshot unavailable", { kind: "unavailable" }],
    ["request deadline", { kind: "timeout" }],
    ["connection generation changed", { kind: "reconnect-cancelled" }],
  ] satisfies [
    string,
    CoopStateSyncFailure,
  ][])("%s freezes the shared session synchronously and cannot continue mechanics", (_label, outcome) => {
    const runtime = stubRuntime();
    let mechanicsContinued = false;

    if (!failCoopRecoveryOutcome(runtime, outcome, `Regression ${outcome.kind}`)) {
      mechanicsContinued = true;
    }

    expect(mechanicsContinued).toBe(false);
    expect(isCoopSharedTerminalFrozen(runtime)).toBe(true);
  });
});
