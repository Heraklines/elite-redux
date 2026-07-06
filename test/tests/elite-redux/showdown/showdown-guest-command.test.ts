/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Showdown 1v1 GUEST command construction (C5) - PURE, engine-free, ungated.
// The versus guest turns a menu pick into the SerializedCommand the relay ships; the host
// validates authoritatively. These assert the WIRE SHAPE (command / cursor / moveId / target).
// =============================================================================

import {
  buildShowdownFightCommand,
  buildShowdownSwitchCommand,
  SHOWDOWN_GUEST_FIGHT_TARGET,
} from "#app/data/elite-redux/showdown/showdown-guest-command";
import { BattlerIndex } from "#enums/battler-index";
import { Command } from "#enums/command";
import { MoveId } from "#enums/move-id";
import { MoveUseMode } from "#enums/move-use-mode";
import { describe, expect, it } from "vitest";

describe("buildShowdownFightCommand", () => {
  it("ships a FIGHT keyed by move slot + move id, targeting the host's active mon", () => {
    const cmd = buildShowdownFightCommand(2, MoveId.TACKLE);
    expect(cmd).toEqual({
      command: Command.FIGHT,
      cursor: 2,
      moveId: MoveId.TACKLE,
      targets: [BattlerIndex.PLAYER],
      useMode: MoveUseMode.NORMAL,
    });
  });

  it("targets the single 1v1 opposing slot (BattlerIndex.PLAYER)", () => {
    expect(SHOWDOWN_GUEST_FIGHT_TARGET).toBe(BattlerIndex.PLAYER);
    expect(buildShowdownFightCommand(0, MoveId.SURF).targets).toEqual([BattlerIndex.PLAYER]);
  });
});

describe("buildShowdownSwitchCommand", () => {
  it("ships a POKEMON switch keyed by party index, never a baton switch", () => {
    const cmd = buildShowdownSwitchCommand(3);
    expect(cmd).toEqual({
      command: Command.POKEMON,
      cursor: 3,
      baton: false,
    });
  });
});
