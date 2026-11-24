/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// B08 chunk 3, the three Tier B gate classes: CopyMoveByFilterAbAttr, CounterAttackOnHitAbAttr, CowardOnceProtectAbAttr.
// What the shared L1 grid and L2 twin cannot show:
//   1. every user's rebuild equals the original, draw for draw, over the guard states the grid never reaches (own move,
//      semi-invulnerable holder, fainted attacker, an indirect counter) and over EVERY registered move (copy);
//   2. the one-time memory of Coward behaves the same through entry, second entry and the next battle;
//   3. Lunar Affinity is NOT rebuilt (legacy closure, custom moves) and its preset still reads back from the live list.
import { allMoves } from "#data/data-lists";
import { readDeclParams, recomposeAttr } from "#data/elite-redux/ability-studio/build-attr";
import { lunarMoveIds } from "#data/elite-redux/ability-studio/decl/B08/chunk3-choices";
import { declRegistry } from "#data/elite-redux/ability-studio/decl-registry";
import { PokemonMove } from "#data/moves/pokemon-move";
import { PokemonBattleData } from "#data/pokemon/pokemon-data";
import { BattlerTagType } from "#enums/battler-tag-type";
import { HitResult } from "#enums/hit-result";
import { MoveId } from "#enums/move-id";
import { MoveUseMode } from "#enums/move-use-mode";
import { startWorld } from "#test/tests/elite-redux/decomp/harness/game";
import { allAttrSites } from "#test/tests/elite-redux/decomp/harness/sites";
import Phaser from "phaser";
import { beforeAll, describe, expect, it, vi } from "vitest";

describe("B08 chunk 3: gate classes", () => {
  let phaserGame: Phaser.Game;
  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });

  it("CopyMoveByFilterAbAttr: Parroting and Ball Fetch rebuild to the same answer for every registered move, for the foe and for the holder itself, with and without a semi-invulnerable holder", async () => {
    const world = await startWorld(phaserGame);
    const { holder, foe } = world;
    const module = declRegistry.get("CopyMoveByFilterAbAttr")!;
    const sites = allAttrSites().filter(site => site.className === "CopyMoveByFilterAbAttr");
    expect(sites.map(site => site.abilityName).sort()).toEqual(["Ball Fetch", "Lunar Affinity", "Parroting"]);
    let accepted = 0;
    for (const site of sites.filter(s => s.abilityName !== "Lunar Affinity")) {
      const rebuilt = recomposeAttr(module, site.attr, site.abilityId, site.attrIndex);
      for (const hidden of [false, true]) {
        if (hidden) {
          holder.summonData.tags.push({ tagType: BattlerTagType.UNDERGROUND } as never);
        }
        for (const source of [foe, holder]) {
          for (const move of allMoves) {
            if (move === undefined) {
              continue;
            }
            const params = {
              pokemon: holder,
              source,
              move: new PokemonMove(move.id),
              targets: [holder.getBattlerIndex()],
              simulated: false,
            };
            const original = site.attr.canApply(params as never);
            const library = rebuilt.canApply(params as never);
            if (original !== library) {
              throw new Error(
                `${site.abilityName}: ${MoveId[move.id] ?? move.id} from ${source === foe ? "the foe" : "the holder"} (semi-invulnerable ${hidden}): the original says ${original}, the rebuild ${library}`,
              );
            }
            accepted += original ? 1 : 0;
          }
        }
        if (hidden) {
          holder.summonData.tags.pop();
        }
      }
    }
    // The gate really accepted moves (sound moves for Parroting, ball and throwing moves for Ball Fetch): the true branch was reached.
    expect(accepted).toBeGreaterThan(10);
  });

  it("CopyMoveByFilterAbAttr: Lunar Affinity is a legacy closure (custom moves), not rebuilt, and its move list still reads back from the live list", async () => {
    await startWorld(phaserGame);
    const module = declRegistry.get("CopyMoveByFilterAbAttr")!;
    const site = allAttrSites().find(
      s => s.className === "CopyMoveByFilterAbAttr" && s.abilityName === "Lunar Affinity",
    )!;
    expect(() => recomposeAttr(module, site.attr, site.abilityId, site.attrIndex)).toThrow(/no library binding/);
    expect(readDeclParams(module, site.attr)).toMatchObject({
      moveList: "Every move with star, moon or lunar in its name",
      flag: "None",
      anyFlags: "",
    });
    const live = (site.attr as unknown as { moveIds: number[] }).moveIds;
    expect(live).toEqual(lunarMoveIds());
    expect(live.length).toBe(15);
  });

  it("CounterAttackOnHitAbAttr: all 17 users rebuild to the same answer and the same number of random draws over contact, non-contact, sound and status moves, own hit, fainted attacker and an indirect counter", async () => {
    const world = await startWorld(phaserGame);
    const { game, holder, foe } = world;
    const module = declRegistry.get("CounterAttackOnHitAbAttr")!;
    const sites = allAttrSites().filter(site => site.className === "CounterAttackOnHitAbAttr");
    expect(sites).toHaveLength(17);
    const moves = [MoveId.TACKLE, MoveId.WATER_GUN, MoveId.HYPER_VOICE, MoveId.GROWL, MoveId.SWORDS_DANCE];
    for (const site of sites) {
      const rebuilt = recomposeAttr(module, site.attr, site.abilityId, site.attrIndex);
      let reached = 0;
      for (const attacker of ["foe", "holder", "fainted-foe"] as const) {
        for (const useMode of [MoveUseMode.NORMAL, MoveUseMode.INDIRECT]) {
          for (const roll of ["low", "high"] as const) {
            for (const move of moves) {
              const observe = (attr: typeof site.attr) => {
                const draws: number[] = [];
                const spy = vi.spyOn(game.scene, "randBattleSeedInt").mockImplementation((range: number, min = 0) => {
                  draws.push(range);
                  return roll === "low" ? min : min + range - 1;
                });
                const savedHp = foe.hp;
                if (attacker === "fainted-foe") {
                  foe.hp = 0;
                }
                const can = attr.canApply({
                  pokemon: holder,
                  opponent: attacker === "holder" ? holder : foe,
                  move: allMoves[move],
                  useMode,
                  hitResult: HitResult.EFFECTIVE,
                  damage: 10,
                  simulated: false,
                } as never);
                foe.hp = savedHp;
                spy.mockRestore();
                return { can, draws };
              };
              const original = observe(site.attr);
              const library = observe(rebuilt);
              expect(
                library,
                `${site.abilityName}: ${MoveId[move]}, ${attacker}, ${MoveUseMode[useMode]}, ${roll} roll`,
              ).toEqual(original);
              reached += original.can ? 1 : 0;
            }
          }
        }
      }
      // Every user answers at least once (a low roll on a move that passes its own filter): the true branch is not vacuous.
      expect(reached, `${site.abilityName} never counters in any state`).toBeGreaterThan(0);
    }
  });

  it("CounterAttackOnHitAbAttr: the chance roll is the LAST clause (a hit that fails the contact test draws nothing) and only Brain Mass rolls", async () => {
    const world = await startWorld(phaserGame);
    const { game, holder, foe } = world;
    const sites = allAttrSites().filter(site => site.className === "CounterAttackOnHitAbAttr");
    const rolling = sites.filter(site => (site.attr as unknown as { chance: number }).chance < 100);
    expect(rolling.map(site => site.abilityName)).toEqual(["Brain Mass"]);
    const module = declRegistry.get("CounterAttackOnHitAbAttr")!;
    // Chilling Pellets needs contact; at 50% (the chance setting moved) a Water Gun must still draw nothing.
    const site = sites.find(s => s.abilityName === "Chilling Pellets")!;
    const attr = recomposeAttr(module, site.attr, site.abilityId, site.attrIndex, { params: { chance: 50 } });
    const draws: number[] = [];
    const spy = vi.spyOn(game.scene, "randBattleSeedInt").mockImplementation((range: number, min = 0) => {
      draws.push(range);
      return min;
    });
    const ask = (move: MoveId) =>
      attr.canApply({
        pokemon: holder,
        opponent: foe,
        move: allMoves[move],
        hitResult: HitResult.EFFECTIVE,
        damage: 10,
        simulated: false,
      } as never);
    expect(ask(MoveId.WATER_GUN)).toBe(false);
    expect(draws).toEqual([]);
    expect(ask(MoveId.TACKLE)).toBe(true);
    expect(draws).toEqual([100]);
    spy.mockRestore();
  });

  it("CowardOnceProtectAbAttr: the original and the rebuild protect once per battle and re-arm in the next battle", async () => {
    const world = await startWorld(phaserGame);
    const { holder } = world;
    const module = declRegistry.get("CowardOnceProtectAbAttr")!;
    const site = allAttrSites().find(s => s.className === "CowardOnceProtectAbAttr")!;
    expect(site.abilityName).toBe("Coward");
    const rebuilt = recomposeAttr(module, site.attr, site.abilityId, site.attrIndex);
    const run = (attr: typeof site.attr) => {
      holder.battleData = new PokemonBattleData();
      holder.removeTag(BattlerTagType.PROTECTED);
      const params = { pokemon: holder, simulated: false };
      const steps: boolean[] = [];
      // A simulated look (asked and applied as simulated) changes nothing.
      steps.push(attr.canApply({ pokemon: holder, simulated: true } as never));
      attr.apply({ pokemon: holder, simulated: true } as never);
      steps.push(attr.canApply(params as never));
      attr.apply(params as never);
      const protectedAfterFirst = holder.getTag(BattlerTagType.PROTECTED) !== undefined;
      steps.push(attr.canApply(params as never));
      holder.removeTag(BattlerTagType.PROTECTED);
      // The next battle: a fresh battle data object.
      holder.battleData = new PokemonBattleData();
      steps.push(attr.canApply(params as never));
      attr.apply(params as never);
      const protectedAfterSecond = holder.getTag(BattlerTagType.PROTECTED) !== undefined;
      steps.push(attr.canApply(params as never));
      holder.removeTag(BattlerTagType.PROTECTED);
      return { steps, protectedAfterFirst, protectedAfterSecond, flag: holder.battleData.cowardProtectUsed };
    };
    const original = run(site.attr);
    const library = run(rebuilt);
    expect(library).toEqual(original);
    expect(original.steps).toEqual([true, true, false, true, false]);
    expect(original.protectedAfterFirst).toBe(true);
    expect(original.protectedAfterSecond).toBe(true);
    expect(original.flag).toBe(true);
  });
});
