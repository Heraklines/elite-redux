/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// AUTHORITY V2 - the faint-replacement `terminal` successor must ADMIT the surviving battle's next
// command-open (campaign DIRTY deadlock, public run 29944796250 wave 3).
//
// THE BUG: on a CONTINUING wave, a replacement whose immediate command frontier is suppressed
// (`hasCoopV2ImmediateCommandSuccessor` == false - e.g. a wave-3 trainer double where a SECOND same-wave
// faint co-fainted an enemy seat that has a living off-field reserve) is authored with the `terminal`
// successor. That successor is an AWAIT_SUCCESSOR whose allowedKinds OMITTED CONTROL_COMMIT, so the host's
// own turn-N+1 command-open (a CONTROL_COMMIT command-open) was REFUSED by successorWaitAllows
// (`!wait.allowedKinds.includes("CONTROL_COMMIT")` -> false). The command-open was never admitted/committed,
// the guest reached the next turn with no admissible control, the recovery bundle could not correlate, and
// the session correctly failed closed ("material could not be applied exactly").
//
// THE FIX (faint-replacement.ts successorControl "terminal"): broaden allowedKinds to mirror the sibling
// turn-command no-immediate-frontier wait (turn-command.ts) - CONTROL_COMMIT for the surviving battle's next
// command-open, plus the already-legal REPLACEMENT_COMMIT / INTERACTION_COMMIT / WAVE_ADVANCE / TERMINAL_COMMIT.
//
// This is the node-pure proof of the exact authored successor + its admission (the modules are engine-free).
// RED before the fix: the surviving command-open is REFUSED; GREEN after: it is admitted at turn N+1, while
// the won-wave WAVE_ADVANCE / game-over TERMINAL_COMMIT successors remain admitted (no regression) and a
// same-turn / wrong-turn command-open stays rejected.
//
//   pnpm test:node   (or: npx vitest run --config test/node/vitest.config.ts authority-v2-faint-replacement-command-open)
// =============================================================================

import {
  type ReplacementSourceAddress,
  successorControl,
} from "#data/elite-redux/coop/authority-v2/adapters/faint-replacement";
import { successorWaitAllows } from "#data/elite-redux/coop/authority-v2/next-control";
import { describe, expect, it } from "vitest";

describe("authority-v2 faint-replacement terminal successor admits the surviving command-open", () => {
  // A mid-wave own-faint at wave 3 turn 2 whose immediate command frontier was suppressed (a further
  // same-wave replacement / co-faint), so the authority states the `terminal` successor.
  const address: ReplacementSourceAddress = { epoch: 1, wave: 3, turn: 2, occurrence: 3, fieldIndex: 1 };
  const sourceOperationId = "RC/e1/w3/t2/o3/f1/s1";

  const terminalWait = () => {
    const control = successorControl(address, sourceOperationId, { kind: "terminal" });
    if (control.kind !== "AWAIT_SUCCESSOR") {
      throw new Error(`expected a terminal AWAIT_SUCCESSOR, got ${control.kind}`);
    }
    return control;
  };

  /** A surviving battle's command-open CONTROL_COMMIT material at turn N+1 (payload wave/turn). */
  const commandOpenMaterial = (wave: number, turn: number) => ({ kind: "command-open", wave, turn });

  it("the authored terminal successor allows CONTROL_COMMIT (the surviving battle's next command-open)", () => {
    // RED before the fix: allowedKinds was ["INTERACTION_COMMIT", "WAVE_ADVANCE", "TERMINAL_COMMIT"].
    expect(terminalWait().allowedKinds).toContain("CONTROL_COMMIT");
    // A same-wave continuation, never a wave crossing.
    expect(terminalWait().allowNextWaveStart).toBe(false);
  });

  it("ADMITS the surviving battle's next command-open at turn N+1", () => {
    const wait = terminalWait();
    // The refilled slot resumes at the faint's turn + 1 (turn 3). broadWaitAllowsControlCommitTurn pins a
    // command-open to waitTurn + 1 (the terminal wait does not allow TURN_COMMIT, so no same-turn edge).
    expect(
      successorWaitAllows(
        wait,
        sourceOperationId,
        "CONTROL_COMMIT",
        "V2/CONTROL/COMMAND/e1/w3/t3",
        address.epoch,
        commandOpenMaterial(3, 3),
      ),
      "the surviving battle's turn-3 command-open is admitted (the DIRTY deadlock is cleared)",
    ).toBe(true);
  });

  it("still REJECTS a same-turn / wrong-turn command-open (the fix does not open a same-turn reopen)", () => {
    const wait = terminalWait();
    // A command-open at the SAME turn (turn 2) is not the surviving successor - it must stay rejected.
    expect(
      successorWaitAllows(
        wait,
        sourceOperationId,
        "CONTROL_COMMIT",
        "V2/CONTROL/COMMAND/e1/w3/t2",
        1,
        commandOpenMaterial(3, 2),
      ),
    ).toBe(false);
    // A command-open two turns later (turn 4) is not the immediate successor either.
    expect(
      successorWaitAllows(
        wait,
        sourceOperationId,
        "CONTROL_COMMIT",
        "V2/CONTROL/COMMAND/e1/w3/t4",
        1,
        commandOpenMaterial(3, 4),
      ),
    ).toBe(false);
  });

  it("still admits the genuine won-wave / game-over settlement (no regression)", () => {
    const wait = terminalWait();
    // A WON wave crosses via WAVE_ADVANCE (the settlement N/N+1 rule); a game-over via TERMINAL_COMMIT.
    expect(
      successorWaitAllows(wait, sourceOperationId, "WAVE_ADVANCE", "V2/WAVE/e1/w3", 1, { wave: 3, turn: 2 }),
      "the won-wave WAVE_ADVANCE successor is still admitted",
    ).toBe(true);
    expect(
      successorWaitAllows(wait, sourceOperationId, "TERMINAL_COMMIT", "V2/TERMINAL/e1/w3", 1, { wave: 3, turn: 2 }),
      "the game-over TERMINAL_COMMIT successor is still admitted",
    ).toBe(true);
  });
});
