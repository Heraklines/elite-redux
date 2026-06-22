/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Bug repro (tester): "Retribution Blow still has the recharge turn that
// shouldn't be present." ER Retribution Blow (ability 407) auto-fires a 150 BP
// Hyper Beam when a foe boosts its stats; the dex says the triggered Hyper Beam
// "has no recharge period, allowing normal actions next turn." The port fired the
// real Hyper Beam (which carries RechargeAttr), so the holder was locked into a
// recharge. The scripted cast now strips RechargeAttr (noRecharge) without
// mutating the registered Hyper Beam.
// =============================================================================

import { allMoves } from "#data/data-lists";
import { scriptedPokemonMove } from "#data/elite-redux/archetypes/scripted-move-util";
import { MoveId } from "#enums/move-id";
import { GameManager } from "#test/framework/game-manager";
import Phaser from "phaser";
import { beforeAll, describe, expect, it } from "vitest";

describe("ER Retribution Blow — scripted Hyper Beam has no recharge", () => {
  beforeAll(() => {
    void new GameManager(new Phaser.Game({ type: Phaser.HEADLESS }));
  });

  it("the noRecharge scripted cast strips RechargeAttr (and keeps the power override)", () => {
    const scripted = scriptedPokemonMove(MoveId.HYPER_BEAM, 150, { alwaysHit: true, noRecharge: true });
    const move = scripted.getMove();
    expect(move.hasAttr("RechargeAttr")).toBe(false);
    expect((move as unknown as { power: number }).power).toBe(150);
  });

  it("does NOT mutate the registered Hyper Beam (it still recharges normally)", () => {
    expect(allMoves[MoveId.HYPER_BEAM].hasAttr("RechargeAttr")).toBe(true);
  });

  it("a scripted cast WITHOUT noRecharge keeps the recharge", () => {
    const scripted = scriptedPokemonMove(MoveId.HYPER_BEAM, 150, { alwaysHit: true });
    expect(scripted.getMove().hasAttr("RechargeAttr")).toBe(true);
  });
});
