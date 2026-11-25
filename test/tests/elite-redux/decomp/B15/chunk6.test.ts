/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// B15 chunk 6 probes: what the shared L1 and L2 suites cannot see (World in Pieces, the four halves of ability 5917).
//   - the constructor arguments added for the typed params keep the old literals as defaults, every param round-trips through the declaration
//     (read from the live attr, rebuilt with a new value) and the rebuilt attr really uses it;
//   - Remove a type (Tier B): guards and gate equal the ORIGINAL clause order over every combination of its inputs (the module memory is driven
//     through the real attrs), the one seeded draw, no mutation or draw when simulated, and a swapped gate cannot bypass the safety rules;
//   - Speed: the multiplier follows the number of lost types and only the chosen stat;
//   - Restore: nothing lost means no apply and no draw; a KO gives one type back with one draw;
//   - Summon: the entry reset forgets the lost types and the once-per-turn memory.
import { globalScene } from "#app/global-scene";
import {
  erWorldInPiecesAttached,
  erWorldInPiecesState,
  WorldInPiecesRemoveTypeAbAttr,
  type WorldInPiecesRestoreAbAttr,
  WorldInPiecesSpeedAbAttr,
  type WorldInPiecesSummonAbAttr,
} from "#data/elite-redux/abilities/world-in-pieces";
import { readDeclParams, recomposeAttr } from "#data/elite-redux/ability-studio/build-attr";
import { declRegistry } from "#data/elite-redux/ability-studio/decl-registry";
import { HitResult } from "#enums/hit-result";
import { MoveCategory } from "#enums/move-category";
import { PokemonType } from "#enums/pokemon-type";
import { Stat } from "#enums/stat";
import type { Pokemon } from "#field/pokemon";
import { startWorld } from "#test/tests/elite-redux/decomp/harness/game";
import { liveAbility } from "#test/tests/elite-redux/decomp/harness/twin";
import Phaser from "phaser";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

const WORLD_IN_PIECES = 5917;
const THREE_TYPES = [PokemonType.NORMAL, PokemonType.ROCK, PokemonType.ICE];

function declared(className: string) {
  const module = declRegistry.get(className);
  expect(module, `${className} must be declared`).toBeDefined();
  return module!;
}

function hitParams(holder: Pokemon, foe: Pokemon, category: MoveCategory, hitResult: HitResult, damage: number): never {
  return { pokemon: holder, opponent: foe, move: { category }, hitResult, damage, simulated: false } as never;
}

describe("B15 chunk 6 (World in Pieces)", () => {
  let phaserGame: Phaser.Game;
  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("defaults equal the old literals, the class names are unchanged, and all four are attrs 0 to 3 of 5917", async () => {
    await startWorld(phaserGame);
    const remove = new WorldInPiecesRemoveTypeAbAttr();
    expect(remove.protectedType).toBe(PokemonType.NORMAL);
    const speed = new WorldInPiecesSpeedAbAttr();
    expect([speed.stat, speed.bonusPerMissingType, speed.multiplier]).toEqual([Stat.SPD, 0.2, 1]);
    expect(liveAbility(WORLD_IN_PIECES).attrs.map(attr => attr.constructor.name)).toEqual([
      "WorldInPiecesSummonAbAttr",
      "WorldInPiecesRemoveTypeAbAttr",
      "WorldInPiecesSpeedAbAttr",
      "WorldInPiecesRestoreAbAttr",
    ]);
  });

  it("every param reads from the live attr and rebuilds with a new value", async () => {
    await startWorld(phaserGame);
    const attrs = liveAbility(WORLD_IN_PIECES).attrs;
    const remove = attrs[1];
    expect(readDeclParams(declared("WorldInPiecesRemoveTypeAbAttr"), remove)).toEqual({ protectedType: "NORMAL" });
    const rock = recomposeAttr(declared("WorldInPiecesRemoveTypeAbAttr"), remove, WORLD_IN_PIECES, 1, {
      params: { protectedType: "ROCK" },
    }) as WorldInPiecesRemoveTypeAbAttr;
    expect(rock.protectedType).toBe(PokemonType.ROCK);
    expect(rock.constructor.name).toBe("WorldInPiecesRemoveTypeAbAttr");

    const speed = attrs[2];
    expect(readDeclParams(declared("WorldInPiecesSpeedAbAttr"), speed)).toEqual({
      stat: "SPD",
      bonusPerMissingType: 0.2,
    });
    const atk = recomposeAttr(declared("WorldInPiecesSpeedAbAttr"), speed, WORLD_IN_PIECES, 2, {
      params: { stat: "ATK", bonusPerMissingType: 0.5 },
    }) as WorldInPiecesSpeedAbAttr;
    expect([atk.stat, atk.bonusPerMissingType]).toEqual([Stat.ATK, 0.5]);

    for (const [index, className] of [
      [0, "WorldInPiecesSummonAbAttr"],
      [3, "WorldInPiecesRestoreAbAttr"],
    ] as const) {
      expect(declared(className).decl.params).toEqual([]);
      expect(recomposeAttr(declared(className), attrs[index], WORLD_IN_PIECES, index).constructor.name).toBe(className);
    }
  });

  describe("Remove a type: guards and gate equal the original clause order", () => {
    /** The ORIGINAL canApply, copied from the source before the split (clause order: status or no damage, immune hit, once per turn, a removable type). */
    function originalCanApply(holder: Pokemon, category: MoveCategory, hitResult: HitResult, damage: number): boolean {
      if (category === MoveCategory.STATUS || damage <= 0) {
        return false;
      }
      if (hitResult === HitResult.NO_EFFECT || hitResult === HitResult.IMMUNE) {
        return false;
      }
      const battle = globalScene.currentBattle;
      const key = `${battle?.waveIndex ?? 0}:${battle?.turn ?? 0}`;
      if (erWorldInPiecesState(holder)?.removedThisTurn === key) {
        return false;
      }
      return (erWorldInPiecesAttached(holder) ?? []).filter(t => t !== PokemonType.NORMAL).length > 0;
    }

    it("every combination of move category, hit result, damage, memory and types gives the original answer, and none draws", async () => {
      const { holder, foe } = await startWorld(phaserGame);
      const attrs = liveAbility(WORLD_IN_PIECES).attrs;
      const summon = attrs[0] as WorldInPiecesSummonAbAttr;
      const original = attrs[1] as WorldInPiecesRemoveTypeAbAttr;
      const rebuilt = recomposeAttr(declared("WorldInPiecesRemoveTypeAbAttr"), original, WORLD_IN_PIECES, 1);
      let draws = 0;
      vi.spyOn(globalScene, "randBattleSeedInt").mockImplementation(() => {
        draws++;
        return 0;
      });
      let combos = 0;
      // state: 0 whole holder with three types, 1 after one hit this turn (memory set), 2 only Normal left to keep
      for (const state of [0, 1, 2]) {
        summon.apply({ pokemon: holder, simulated: false } as never);
        holder.summonData.types = state === 2 ? [PokemonType.NORMAL] : [...THREE_TYPES];
        if (state === 1) {
          original.apply({ pokemon: holder, simulated: false } as never);
          expect(erWorldInPiecesState(holder)?.removed.length).toBe(1);
        }
        for (const category of [MoveCategory.STATUS, MoveCategory.PHYSICAL, MoveCategory.SPECIAL]) {
          for (const hitResult of [HitResult.EFFECTIVE, HitResult.NO_EFFECT, HitResult.IMMUNE, HitResult.MISS]) {
            for (const damage of [0, 1, 40]) {
              draws = 0;
              const params = hitParams(holder, foe, category, hitResult, damage);
              const expected = originalCanApply(holder, category, hitResult, damage);
              expect(original.canApply(params), `original ${state} ${category} ${hitResult} ${damage}`).toBe(expected);
              expect(rebuilt.canApply(params as never), `rebuilt ${state} ${category} ${hitResult} ${damage}`).toBe(
                expected,
              );
              expect(draws).toBe(0);
              combos++;
            }
          }
        }
      }
      expect(combos).toBe(108);
    });

    it("apply makes exactly one seeded draw, queues the memory, and a simulated call changes nothing and draws nothing", async () => {
      const { holder } = await startWorld(phaserGame);
      const attrs = liveAbility(WORLD_IN_PIECES).attrs;
      const summon = attrs[0] as WorldInPiecesSummonAbAttr;
      const original = attrs[1] as WorldInPiecesRemoveTypeAbAttr;
      let draws = 0;
      vi.spyOn(globalScene, "randBattleSeedInt").mockImplementation(() => {
        draws++;
        return 1;
      });
      summon.apply({ pokemon: holder, simulated: false } as never);
      holder.summonData.types = [...THREE_TYPES];
      original.apply({ pokemon: holder, simulated: true } as never);
      expect(draws).toBe(0);
      expect(erWorldInPiecesState(holder)!.removed).toEqual([]);
      expect(erWorldInPiecesState(holder)!.removedThisTurn).toBeNull();
      original.apply({ pokemon: holder, simulated: false } as never);
      expect(draws).toBe(1);
      const state = erWorldInPiecesState(holder)!;
      // removable = [ROCK, ICE]; the draw returned 1, so ICE is lost and Normal and Rock stay.
      expect(state.removed).toEqual([PokemonType.ICE]);
      expect(erWorldInPiecesAttached(holder)).toEqual([PokemonType.NORMAL, PokemonType.ROCK]);
      expect(state.removedThisTurn).not.toBeNull();
    });

    it("a rebuilt rule that protects Rock keeps Rock and may strip Normal", async () => {
      const { holder } = await startWorld(phaserGame);
      const attrs = liveAbility(WORLD_IN_PIECES).attrs;
      (attrs[0] as WorldInPiecesSummonAbAttr).apply({ pokemon: holder, simulated: false } as never);
      holder.summonData.types = [...THREE_TYPES];
      const rock = recomposeAttr(declared("WorldInPiecesRemoveTypeAbAttr"), attrs[1], WORLD_IN_PIECES, 1, {
        params: { protectedType: "ROCK" },
      }) as WorldInPiecesRemoveTypeAbAttr;
      vi.spyOn(globalScene, "randBattleSeedInt").mockReturnValue(0);
      rock.apply({ pokemon: holder, simulated: false } as never);
      // removable = [NORMAL, ICE]; draw 0 strips Normal.
      expect(erWorldInPiecesState(holder)!.removed).toEqual([PokemonType.NORMAL]);
    });

    it("a swapped gate follows the new gate but the safety rules (damage, immune hit, once per turn) stay locked", async () => {
      const { holder, foe } = await startWorld(phaserGame);
      const attrs = liveAbility(WORLD_IN_PIECES).attrs;
      (attrs[0] as WorldInPiecesSummonAbAttr).apply({ pokemon: holder, simulated: false } as never);
      holder.summonData.types = [...THREE_TYPES];
      const anyMove = recomposeAttr(declared("WorldInPiecesRemoveTypeAbAttr"), attrs[1], WORLD_IN_PIECES, 1, {
        conds: { gate: { all: [] } },
      }) as WorldInPiecesRemoveTypeAbAttr;
      expect(anyMove.canApply(hitParams(holder, foe, MoveCategory.STATUS, HitResult.EFFECTIVE, 5))).toBe(true);
      expect(anyMove.canApply(hitParams(holder, foe, MoveCategory.STATUS, HitResult.EFFECTIVE, 0))).toBe(false);
      expect(anyMove.canApply(hitParams(holder, foe, MoveCategory.STATUS, HitResult.IMMUNE, 5))).toBe(false);
      expect(anyMove.canApply(hitParams(holder, foe, MoveCategory.STATUS, HitResult.NO_EFFECT, 5))).toBe(false);
      vi.spyOn(globalScene, "randBattleSeedInt").mockReturnValue(0);
      anyMove.apply({ pokemon: holder, simulated: false } as never);
      expect(anyMove.canApply(hitParams(holder, foe, MoveCategory.PHYSICAL, HitResult.EFFECTIVE, 5))).toBe(false);
    });
  });

  it("Speed grows with the number of lost types and only for the chosen stat", async () => {
    const { holder } = await startWorld(phaserGame);
    const attrs = liveAbility(WORLD_IN_PIECES).attrs;
    const summon = attrs[0] as WorldInPiecesSummonAbAttr;
    const remove = attrs[1] as WorldInPiecesRemoveTypeAbAttr;
    const speed = attrs[2] as WorldInPiecesSpeedAbAttr;
    const atk = recomposeAttr(declared("WorldInPiecesSpeedAbAttr"), speed, WORLD_IN_PIECES, 2, {
      params: { stat: "ATK", bonusPerMissingType: 0.5 },
    }) as WorldInPiecesSpeedAbAttr;
    summon.apply({ pokemon: holder, simulated: false } as never);
    holder.summonData.types = [...THREE_TYPES];
    const statParams = (stat: Stat, value: number) => ({ pokemon: holder, stat, statVal: { value } }) as never;
    const spd = statParams(Stat.SPD, 100);
    expect(speed.canApply(spd)).toBe(true);
    speed.apply(spd);
    expect((spd as { statVal: { value: number } }).statVal.value).toBe(100);
    vi.spyOn(globalScene, "randBattleSeedInt").mockReturnValue(0);
    remove.apply({ pokemon: holder, simulated: false } as never);
    expect(erWorldInPiecesState(holder)!.removed.length).toBe(1);
    const spd1 = statParams(Stat.SPD, 100);
    speed.apply(spd1);
    expect((spd1 as { statVal: { value: number } }).statVal.value).toBeCloseTo(120);
    expect(speed.canApply(statParams(Stat.ATK, 100))).toBe(false);
    expect(atk.canApply(statParams(Stat.SPD, 100))).toBe(false);
    const atk1 = statParams(Stat.ATK, 100);
    expect(atk.canApply(atk1)).toBe(true);
    atk.apply(atk1);
    expect((atk1 as { statVal: { value: number } }).statVal.value).toBeCloseTo(150);
  });

  it("Restore needs a lost type, spends one draw, gives one type back; Summon forgets everything", async () => {
    const { holder } = await startWorld(phaserGame);
    const attrs = liveAbility(WORLD_IN_PIECES).attrs;
    const summon = attrs[0] as WorldInPiecesSummonAbAttr;
    const remove = attrs[1] as WorldInPiecesRemoveTypeAbAttr;
    const restore = attrs[3] as WorldInPiecesRestoreAbAttr;
    const rebuiltRestore = recomposeAttr(declared("WorldInPiecesRestoreAbAttr"), restore, WORLD_IN_PIECES, 3);
    let draws = 0;
    vi.spyOn(globalScene, "randBattleSeedInt").mockImplementation(() => {
      draws++;
      return 0;
    });
    summon.apply({ pokemon: holder, simulated: false } as never);
    holder.summonData.types = [...THREE_TYPES];
    const params = { pokemon: holder, simulated: false } as never;
    expect(restore.canApply(params)).toBe(false);
    expect(rebuiltRestore.canApply(params)).toBe(false);
    remove.apply(params);
    expect(erWorldInPiecesState(holder)!.removed).toEqual([PokemonType.ROCK]);
    expect(restore.canApply(params)).toBe(true);
    draws = 0;
    restore.apply({ pokemon: holder, simulated: true } as never);
    expect(draws).toBe(0);
    expect(erWorldInPiecesState(holder)!.removed.length).toBe(1);
    restore.apply(params);
    expect(draws).toBe(1);
    expect(erWorldInPiecesState(holder)!.removed).toEqual([]);
    expect(restore.canApply(params)).toBe(false);
    // Entering again forgets a loss and the once-per-turn memory.
    remove.apply({ pokemon: holder, simulated: false } as never);
    expect(erWorldInPiecesState(holder)!.removedThisTurn).not.toBeNull();
    summon.apply({ pokemon: holder, simulated: true } as never);
    expect(erWorldInPiecesState(holder)!.removed.length).toBe(1);
    summon.apply(params);
    expect(erWorldInPiecesState(holder)!.removed).toEqual([]);
    expect(erWorldInPiecesState(holder)!.removedThisTurn).toBeNull();
  });
});
