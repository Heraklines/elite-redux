/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// #415 - Flash was single-target despite being multi-target in ER, and High
// Jump Kick's description never mentioned its Striker boost. The vanilla
// rebalance now applies ER_VANILLA_TARGET_OVERRIDES (per-move, individually
// verified - a data-driven sweep of ER's spread classes broke Round's
// follow-up chain and Tera Starstorm's form-variable targeting, so the other
// 18 flagged moves are deferred until each is verified), and a systemic pass
// APPENDS ER's "<Ability> boost." notes (Striker, Keen Edge, Iron Fist,
// Strong Jaw, Mighty Horn, Mega Launcher - 85 vanilla moves) to the live
// move descriptions. Gated behind ER_SCENARIO=1.
// =============================================================================

import { allMoves } from "#data/data-lists";
import { MoveId } from "#enums/move-id";
import { MoveTarget } from "#enums/move-target";
import { GameManager } from "#test/framework/game-manager";
import Phaser from "phaser";
import { beforeAll, describe, expect, it } from "vitest";

const RUN = process.env.ER_SCENARIO === "1";

describe.skipIf(!RUN)("ER vanilla move targets + boost notes (#415)", () => {
  let phaserGame: Phaser.Game;

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
    void new GameManager(phaserGame);
  });

  it("Flash hits ALL adjacent enemies (explicit override - dump target is stale)", () => {
    expect(allMoves[MoveId.FLASH].moveTarget).toBe(MoveTarget.ALL_NEAR_ENEMIES);
  });

  it("existing deliberate target pins are untouched (Bulldoze MOVE_PATCHERS pin)", () => {
    expect(allMoves[MoveId.BULLDOZE].moveTarget).toBe(MoveTarget.ALL_NEAR_ENEMIES);
  });

  it("field/self/side moves are NOT retargeted (pokerogue conventions stand)", () => {
    expect(allMoves[MoveId.HAZE].moveTarget).toBe(MoveTarget.USER);
    expect(allMoves[MoveId.ALLY_SWITCH].moveTarget).toBe(MoveTarget.USER);
    expect(allMoves[MoveId.CHILLY_RECEPTION].moveTarget).toBe(MoveTarget.USER);
    expect(allMoves[MoveId.PERISH_SONG].moveTarget).toBe(MoveTarget.ALL);
  });

  it("High Jump Kick's description carries the Striker boost note (live report)", () => {
    const desc = String((allMoves[MoveId.HIGH_JUMP_KICK] as unknown as { effect: string }).effect);
    expect(desc.toLowerCase()).toContain("striker boost");
  });

  it("the other boost families are noted too (Iron Fist / Strong Jaw / Keen Edge)", () => {
    const effectOf = (id: MoveId) => String((allMoves[id] as unknown as { effect: string }).effect).toLowerCase();
    expect(effectOf(MoveId.ICE_PUNCH)).toContain("iron fist boost");
    expect(effectOf(MoveId.BITE)).toContain("strong jaw boost");
    expect(effectOf(MoveId.RAZOR_LEAF)).toContain("keen edge boost");
  });
});
