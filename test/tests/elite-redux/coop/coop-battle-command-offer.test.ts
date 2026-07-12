/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { validateCoopBattleCommand } from "#data/elite-redux/coop/coop-battle-command-offer";
import type { CoopBattleCommandOffer } from "#data/elite-redux/coop/coop-transport";
import { Command } from "#enums/command";
import { MoveUseMode } from "#enums/move-use-mode";
import { describe, expect, it } from "vitest";

const offer: CoopBattleCommandOffer = {
  moves: [
    { slot: 0, moveId: 33, targetSets: [[2], [3]], canTera: true },
    { slot: 2, moveId: 89, targetSets: [[2, 3]], canTera: false },
  ],
  switches: [
    { slot: 2, canNormal: true, canBaton: false },
    { slot: 4, canNormal: false, canBaton: true },
  ],
  ballTypes: [0, 2],
  ballTargets: [2],
  canRun: false,
};

describe("host-authored co-op battle command offers", () => {
  it("accepts only exact move id, normal human use mode, offered target set, and offered tera", () => {
    expect(
      validateCoopBattleCommand(
        { command: Command.FIGHT, cursor: 0, moveId: 33, targets: [3], useMode: MoveUseMode.NORMAL, tera: true },
        offer,
      ).valid,
    ).toBe(true);
    expect(
      validateCoopBattleCommand({ command: Command.FIGHT, cursor: 0, moveId: 89, targets: [3] }, offer).reason,
    ).toBe("move-id-mismatch");
    expect(
      validateCoopBattleCommand({ command: Command.FIGHT, cursor: 0, moveId: 33, targets: [99] }, offer).reason,
    ).toBe("targets-not-offered");
    expect(
      validateCoopBattleCommand(
        { command: Command.FIGHT, cursor: 0, moveId: 33, targets: [2], useMode: MoveUseMode.IGNORE_PP },
        offer,
      ).reason,
    ).toBe("non-human-use-mode");
    expect(
      validateCoopBattleCommand({ command: Command.FIGHT, cursor: 2, moveId: 89, targets: [3, 2], tera: true }, offer)
        .reason,
    ).toBe("tera-not-offered");
  });

  it("validates switch ownership/legality, ball inventory, run, and unknown command kinds", () => {
    expect(validateCoopBattleCommand({ command: Command.POKEMON, cursor: 2 }, offer).valid).toBe(true);
    expect(validateCoopBattleCommand({ command: Command.POKEMON, cursor: 2, baton: true }, offer).reason).toBe(
      "baton-switch-not-offered",
    );
    expect(validateCoopBattleCommand({ command: Command.POKEMON, cursor: 4 }, offer).reason).toBe(
      "normal-switch-not-offered",
    );
    expect(validateCoopBattleCommand({ command: Command.POKEMON, cursor: 4, baton: true }, offer).valid).toBe(true);
    expect(validateCoopBattleCommand({ command: Command.BALL, cursor: 2, targets: [2] }, offer).valid).toBe(true);
    expect(validateCoopBattleCommand({ command: Command.BALL, cursor: 4 }, offer).reason).toBe("ball-type-not-offered");
    expect(validateCoopBattleCommand({ command: Command.RUN, cursor: 0 }, offer).reason).toBe("run-not-offered");
    expect(validateCoopBattleCommand({ command: Command.SHIFT, cursor: 1 }, offer).reason).toBe(
      "command-kind-not-offered",
    );
  });
});
