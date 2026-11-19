/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { allMoves } from "#data/data-lists";
import { recomposeAttr } from "#data/elite-redux/ability-studio/build-attr";
import { declRegistry } from "#data/elite-redux/ability-studio/decl-registry";
// PRECEDENT probes for the memory class (BerserkOnThresholdAbAttr, once per wave). The L1 grid and the L2 twin
// never look at memory (a fresh battle has none), so the rules of memory are proven here, on the ORIGINAL attr and on
// its REBUILD side by side:
//   1. a key that is already in the wave memory blocks both;
//   2. a failing later IF does not use the memory up (the library only writes when the rule applies);
//   3. apply writes the key, a simulated apply does not;
//   4. the library atom and the class share ONE memory (waveData.entryEffectsFired), so a hit that the class
//      remembered is also remembered by the rebuild.
import type { BerserkOnThresholdAbAttr } from "#data/elite-redux/archetypes/berserk-on-threshold";
import { AbilityId } from "#enums/ability-id";
import { HitResult } from "#enums/hit-result";
import { MoveId } from "#enums/move-id";
import type { Pokemon } from "#field/pokemon";
import { startWorld } from "#test/tests/elite-redux/decomp/harness/game";
import { liveAbility } from "#test/tests/elite-redux/decomp/harness/twin";
import type { PostMoveInteractionAbAttrParams } from "#types/ability-types";
import Phaser from "phaser";
import { beforeAll, describe, expect, it } from "vitest";

const KEY = "berserk-on-threshold";

describe("precedent: memory (Berserk, once per wave)", () => {
  let phaserGame: Phaser.Game;
  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });

  function pair(): { original: BerserkOnThresholdAbAttr; rebuilt: BerserkOnThresholdAbAttr } {
    const original = liveAbility(AbilityId.BERSERK).attrs[0] as BerserkOnThresholdAbAttr;
    const module = declRegistry.get("BerserkOnThresholdAbAttr");
    expect(module).toBeDefined();
    const rebuilt = recomposeAttr(module!, original, AbilityId.BERSERK, 0) as BerserkOnThresholdAbAttr;
    expect(rebuilt).not.toBe(original);
    return { original, rebuilt };
  }

  function params(holder: Pokemon, foe: Pokemon, damage: number, simulated = false): PostMoveInteractionAbAttrParams {
    return {
      pokemon: holder,
      opponent: foe,
      move: allMoves[MoveId.TACKLE],
      damage,
      hitResult: HitResult.EFFECTIVE,
      simulated,
    } as PostMoveInteractionAbAttrParams;
  }

  /** Puts the holder exactly on the floored half line, so a hit of any size crosses it. */
  function onTheLine(holder: Pokemon): void {
    holder.hp = Math.floor(holder.getMaxHp() / 2);
  }

  it("a key already in the wave memory blocks the original and the rebuild alike", async () => {
    const { game, holder, foe } = await startWorld(phaserGame);
    const { original, rebuilt } = pair();
    onTheLine(holder);
    expect(original.canApply(params(holder, foe, 10))).toBe(true);
    expect(rebuilt.canApply(params(holder, foe, 10))).toBe(true);
    holder.waveData.entryEffectsFired.add(KEY);
    expect(original.canApply(params(holder, foe, 10))).toBe(false);
    expect(rebuilt.canApply(params(holder, foe, 10))).toBe(false);
    expect(game.scene).toBeDefined();
  });

  it("a failing later IF does not use the memory up; passing and applying does; a simulated apply never writes", async () => {
    const { holder, foe } = await startWorld(phaserGame);
    const { rebuilt } = pair();
    // Not on the line: the HP test (the LAST IF) fails after once-per was already satisfied.
    holder.hp = holder.getMaxHp();
    expect(rebuilt.canApply(params(holder, foe, 10))).toBe(false);
    expect(holder.waveData.entryEffectsFired.has(KEY)).toBe(false);
    // On the line: passes, but the memory is only written when the rule really applies.
    onTheLine(holder);
    expect(rebuilt.canApply(params(holder, foe, 10))).toBe(true);
    expect(holder.waveData.entryEffectsFired.has(KEY)).toBe(false);
    // A simulated pass never writes.
    expect(rebuilt.canApply(params(holder, foe, 10, true))).toBe(true);
    rebuilt.apply(params(holder, foe, 10, true));
    expect(holder.waveData.entryEffectsFired.has(KEY)).toBe(false);
    // The real apply writes it, and the next hit is blocked.
    expect(rebuilt.canApply(params(holder, foe, 10))).toBe(true);
    rebuilt.apply(params(holder, foe, 10));
    expect(holder.waveData.entryEffectsFired.has(KEY)).toBe(true);
    expect(rebuilt.canApply(params(holder, foe, 10))).toBe(false);
  });

  it("the original and the rebuild share one memory: what one remembers the other honours", async () => {
    const { holder, foe } = await startWorld(phaserGame);
    const { original, rebuilt } = pair();
    onTheLine(holder);
    original.apply(params(holder, foe, 10));
    expect(holder.waveData.entryEffectsFired.has(KEY)).toBe(true);
    expect(rebuilt.canApply(params(holder, foe, 10))).toBe(false);
    holder.waveData.entryEffectsFired.delete(KEY);
    rebuilt.canApply(params(holder, foe, 10));
    rebuilt.apply(params(holder, foe, 10));
    expect(original.canApply(params(holder, foe, 10))).toBe(false);
  });
});
