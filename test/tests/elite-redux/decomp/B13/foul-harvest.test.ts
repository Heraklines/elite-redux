/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// B13 chunk 1: Foul Harvest (5973). The gate (damage, a landed hit, a move not counted yet) is a legacy closure, so
// the attr cannot be rebuilt from the library and the L2 twin leaves it out. These probes prove, on the original
// attr, the clause ORDER (attack condition first, then the gate), the once-per-move memory, the PP drain, the draw
// count and the cap; and that the attack-condition constructor slot really is swappable.
import type { AbAttr } from "#abilities/ab-attrs";
import { allMoves } from "#data/data-lists";
import {
  type FoulHarvestAbAttr,
  foulHarvestCharges,
  recordSignatureExecutedMove,
} from "#data/elite-redux/abilities/newcomer-signature-mechanics";
import { buildAttr } from "#data/elite-redux/ability-studio/build-attr";
import { declRegistry } from "#data/elite-redux/ability-studio/decl-registry";
import { BattlerIndex } from "#enums/battler-index";
import { HitResult } from "#enums/hit-result";
import { MoveId } from "#enums/move-id";
import { MoveResult } from "#enums/move-result";
import { MoveUseMode } from "#enums/move-use-mode";
import type { Pokemon } from "#field/pokemon";
import { startWorld } from "#test/tests/elite-redux/decomp/harness/game";
import { liveAbility } from "#test/tests/elite-redux/decomp/harness/twin";
import Phaser from "phaser";
import { beforeAll, describe, expect, it, vi } from "vitest";

const FOUL_HARVEST = 5973;

describe("B13 Foul Harvest", () => {
  let phaserGame: Phaser.Game;
  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });

  const original = (): FoulHarvestAbAttr => liveAbility(FOUL_HARVEST).attrs[0] as FoulHarvestAbAttr;

  function holderUses(holder: Pokemon, move = MoveId.TACKLE): void {
    holder.pushMoveHistory({
      move,
      targets: [BattlerIndex.ENEMY],
      useMode: MoveUseMode.NORMAL,
      result: MoveResult.SUCCESS,
    });
  }

  const params = (
    holder: Pokemon,
    foe: Pokemon,
    moveId = MoveId.TACKLE,
    damage = 10,
    hitResult = HitResult.EFFECTIVE,
    simulated = false,
  ): never => ({ pokemon: holder, opponent: foe, move: allMoves[moveId], damage, hitResult, simulated }) as never;

  it("clause order and memory: attack condition, then damage and landed hit, then a move not counted yet", async () => {
    const { holder, foe } = await startWorld(phaserGame);
    const attr = original();
    // No move of mine on record: the last clause says no.
    expect(attr.canApply(params(holder, foe))).toBe(false);
    holderUses(holder);
    expect(attr.canApply(params(holder, foe))).toBe(true);
    expect(attr.canApply(params(holder, foe, MoveId.SWORDS_DANCE))).toBe(false); // clause 1: a status move
    expect(attr.canApply(params(holder, foe, MoveId.TACKLE, 0))).toBe(false); // clause 2
    expect(attr.canApply(params(holder, foe, MoveId.TACKLE, 10, HitResult.NO_EFFECT))).toBe(false); // clause 3
    attr.apply(params(holder, foe));
    // The same move record is spent; a new move of mine is a new chance.
    expect(attr.canApply(params(holder, foe))).toBe(false);
    holderUses(holder);
    expect(attr.canApply(params(holder, foe))).toBe(true);
  });

  it("drains 1 PP from the remembered move without a draw, from a random one with a draw, and caps at 3 charges", async () => {
    const { game, holder, foe } = await startWorld(phaserGame);
    const attr = original();
    const draws = vi.spyOn(game.scene, "randBattleSeedInt");
    // The enemy moveset override rebuilds the moves (and their PP) on every getMoveset call; build them once, then let
    // the real moveset array take over so PP can be observed.
    foe.getMoveset();
    game.override.enemyMoveset([]);
    const splash = foe.getMoveset()[0];
    expect(splash).toBeDefined();
    const before = splash.ppUsed;

    // The foe has no remembered move: exactly one random draw picks it.
    holderUses(holder);
    draws.mockClear();
    attr.apply(params(holder, foe));
    expect(draws).toHaveBeenCalledTimes(1);
    expect(splash.ppUsed).toBe(before + 1);
    expect(foulHarvestCharges(holder)).toBe(1);

    // The foe's last executed move is remembered: no random draw.
    recordSignatureExecutedMove(foe, allMoves[MoveId.SPLASH]);
    holderUses(holder);
    draws.mockClear();
    attr.apply(params(holder, foe));
    expect(draws).not.toHaveBeenCalled();
    expect(splash.ppUsed).toBe(before + 2);
    expect(foulHarvestCharges(holder)).toBe(2);

    // Two more hits fill the counter to its cap of 3.
    for (let i = 0; i < 2; i++) {
      holderUses(holder);
      attr.apply(params(holder, foe));
    }
    expect(foulHarvestCharges(holder)).toBe(3);
  });

  it("a simulated call stores the move record but changes nothing else (oddity recorded in the notes)", async () => {
    const { game, holder, foe } = await startWorld(phaserGame);
    const attr = original();
    foe.getMoveset();
    game.override.enemyMoveset([]);
    const splash = foe.getMoveset()[0];
    const before = splash.ppUsed;
    const chargesBefore = foulHarvestCharges(holder);
    holderUses(holder);
    expect(attr.canApply(params(holder, foe))).toBe(true);
    attr.apply(params(holder, foe, MoveId.TACKLE, 10, HitResult.EFFECTIVE, true));
    expect(splash.ppUsed).toBe(before);
    expect(foulHarvestCharges(holder)).toBe(chargesBefore);
    // ...but the once-per-move memory was spent.
    expect(attr.canApply(params(holder, foe))).toBe(false);
  });

  it("the attack condition is a swappable constructor slot, in front of the gate", async () => {
    const { holder, foe } = await startWorld(phaserGame);
    const module = declRegistry.get("FoulHarvestAbAttr")!;
    const attr = original();
    const gate = (p: never): boolean => attr.gate(p);
    // The original rule rebuilt: ctor:0 = the library form of the default condition, gate = the class's own.
    const same = buildAttr(
      module,
      {},
      { "ctor:0": { block: "move.damaging", params: {} }, gate: gate as never },
    ) as AbAttr;
    // The opposite condition: status moves instead of damaging ones.
    const flipped = buildAttr(
      module,
      {},
      { "ctor:0": { not: { block: "move.damaging", params: {} } }, gate: gate as never },
    ) as AbAttr;
    holderUses(holder);
    for (const moveId of [MoveId.TACKLE, MoveId.SWORDS_DANCE]) {
      expect(same.canApply(params(holder, foe, moveId))).toBe(attr.canApply(params(holder, foe, moveId)));
    }
    expect(flipped.canApply(params(holder, foe, MoveId.TACKLE))).toBe(false);
    expect(flipped.canApply(params(holder, foe, MoveId.SWORDS_DANCE))).toBe(true);
  });
});
