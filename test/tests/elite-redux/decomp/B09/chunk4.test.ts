/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import type { AbAttr } from "#abilities/ab-attrs";
import { allMoves } from "#data/data-lists";
import { readDeclParams, recomposeAttr } from "#data/elite-redux/ability-studio/build-attr";
import { declRegistry } from "#data/elite-redux/ability-studio/decl-registry";
import { IncomingAccuracyMultiplierAbAttr } from "#data/elite-redux/archetypes/incoming-accuracy-multiplier";
import {
  LifestealOnHitAbAttr,
  type LifestealOnKoAbAttr,
  ScavengerLootAbAttr,
} from "#data/elite-redux/archetypes/lifesteal";
import type { MoveCategoryOverrideAbAttr } from "#data/elite-redux/archetypes/move-category-override";
import { BattlerTagType } from "#enums/battler-tag-type";
import { HitResult } from "#enums/hit-result";
import { MoveCategory } from "#enums/move-category";
import { MoveFlags } from "#enums/move-flags";
import { MoveId } from "#enums/move-id";
import { PokemonType } from "#enums/pokemon-type";
import { Stat } from "#enums/stat";
import type { Pokemon } from "#field/pokemon";
import { startWorld } from "#test/tests/elite-redux/decomp/harness/game";
import { type AttrSite, allAttrSites } from "#test/tests/elite-redux/decomp/harness/sites";
import { BooleanHolder, NumberHolder } from "#utils/common";
import Phaser from "phaser";
import { beforeAll, describe, expect, it, vi } from "vitest";

// B09 chunk 4 probes for what the shared L1 and L2 cannot see:
//   1. IncomingAccuracyMultiplier: the "single target only" setting (no ability uses it), the never-miss marker, and the rebuild.
//   2. ScavengerLoot: the order and the ranges of the two random draws, with the guards that must stop before the first one.
//   3. LifestealOnHit: the new guards+gate+residual split agrees with the closure that the constructor still hands to the parent
//      (the old canApply) over every move, damage, target-tag and null-target case; every user reads back; the legacy users throw.
//   4. LifestealOnKo: the rule of who is credited, the biting bonus, and the heal amount of the original and of the rebuild.
//   5. MoveCategoryOverride: both ways of testing the property, and the six users.
//   6. The three type-absorb classes: the settings read back, and apply does the same in the original and in the rebuild.

const sitesOf = (className: string): AttrSite[] => allAttrSites().filter(site => site.className === className);
const moduleOf = (className: string) => declRegistry.get(className)!;

/** The first damaging move that carries the property. */
function moveWith(flag: MoveFlags) {
  const move = allMoves.find(
    m => m != null && m.id !== MoveId.NONE && m.hasFlag(flag) && m.power > 0 && m.category !== MoveCategory.STATUS,
  );
  expect(move, `a ${MoveFlags[flag]} move exists`).toBeDefined();
  return move!;
}

describe("B09 chunk 4 (absorb a type, incoming accuracy, lifesteal, loot, category override)", () => {
  let phaserGame: Phaser.Game;
  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });

  // -------------------------------------------------------------------------------------------------------------------
  it("IncomingAccuracyMultiplier: both users rebuild; the never-miss marker and the single-target setting behave like the class", async () => {
    await startWorld(phaserGame);
    const sites = sitesOf("IncomingAccuracyMultiplierAbAttr");
    expect(sites.map(site => site.abilityName).sort()).toEqual(["Bad Luck", "Scarecrow"]);
    const module = moduleOf("IncomingAccuracyMultiplierAbAttr");
    const spread = allMoves[MoveId.EARTHQUAKE];
    const single = allMoves[MoveId.TACKLE];
    for (const site of sites) {
      const original = site.attr as IncomingAccuracyMultiplierAbAttr;
      expect(readDeclParams(module, original), site.abilityName).toEqual({ multiplier: 0.95, singleTargetOnly: false });
      const rebuilt = recomposeAttr(
        module,
        original,
        site.abilityId,
        site.attrIndex,
      ) as IncomingAccuracyMultiplierAbAttr;
      for (const move of [single, spread, allMoves[MoveId.THUNDER_WAVE]]) {
        for (const accuracy of [100, 50, 1, 0, -1]) {
          const a = { move, accuracy: new NumberHolder(accuracy) } as never;
          const b = { move, accuracy: new NumberHolder(accuracy) } as never;
          expect(rebuilt.canApply(b), `${site.abilityName} ${move.name} ${accuracy}`).toBe(original.canApply(a));
        }
      }
      // Truth table of the original: never-miss (-1) is left alone, everything else is multiplied.
      const sure = { move: single, accuracy: new NumberHolder(-1) } as never;
      expect(original.canApply(sure)).toBe(false);
      const normal = { move: single, accuracy: new NumberHolder(100) } as never;
      expect(original.canApply(normal)).toBe(true);
      (rebuilt as AbAttr).apply({ move: single, accuracy: (normal as { accuracy: NumberHolder }).accuracy } as never);
      expect((normal as { accuracy: NumberHolder }).accuracy.value).toBeCloseTo(95, 10);
    }
    // The setting no ability uses: a single-target-only rule keeps the accuracy of a spread move. Built from the declaration.
    const spreadOnly = new IncomingAccuracyMultiplierAbAttr({ multiplier: 0.8, singleTargetOnly: true });
    expect(readDeclParams(module, spreadOnly)).toEqual({ multiplier: 0.8, singleTargetOnly: true });
    expect(spreadOnly.canApply({ move: spread, accuracy: new NumberHolder(100) } as never)).toBe(false);
    expect(spreadOnly.canApply({ move: single, accuracy: new NumberHolder(100) } as never)).toBe(true);
    // Every spread target counts, not only the one used here.
    expect(spreadOnly.canApply({ move: allMoves[MoveId.ROCK_SLIDE], accuracy: new NumberHolder(100) } as never)).toBe(
      false,
    );
  });

  // -------------------------------------------------------------------------------------------------------------------
  describe("ScavengerLoot", () => {
    const koParams = (holder: Pokemon, foe: Pokemon, extra: Record<string, unknown> = {}) => {
      foe.turnData.attacksReceived = [
        {
          move: MoveId.TACKLE,
          result: HitResult.EFFECTIVE,
          damage: 10,
          critical: false,
          sourceId: holder.id,
          sourceBattlerIndex: holder.getBattlerIndex(),
        },
      ];
      return { pokemon: holder, victim: foe, simulated: false, ...extra } as never;
    };

    it("draws the loot roll first and the item pick second, with the same ranges in the original and in the rebuild", async () => {
      const { game, holder, foe } = await startWorld(phaserGame);
      const sites = sitesOf("ScavengerLootAbAttr");
      expect(sites.map(site => site.abilityName).sort()).toEqual(["Bandit", "Scavenger"]);
      const module = moduleOf("ScavengerLootAbAttr");
      const items = [{ isTransferable: true }, { isTransferable: true }, { isTransferable: true }];
      const noItems: unknown[] = [];
      let held: unknown[] = items;
      vi.spyOn(game.scene, "findModifiers").mockImplementation(() => held as never);
      vi.spyOn(game.scene, "canTransferHeldItemModifier").mockReturnValue(true);
      let log: number[] = [];
      let next = 0;
      vi.spyOn(game.scene, "randBattleSeedInt").mockImplementation((range: number) => {
        log.push(range);
        return Math.min(next, range - 1);
      });
      for (const site of sites) {
        const original = site.attr as ScavengerLootAbAttr;
        expect(readDeclParams(module, original), site.abilityName).toEqual({ chance: 50 });
        const rebuilt = recomposeAttr(module, original, site.abilityId, site.attrIndex) as ScavengerLootAbAttr;
        const cases: {
          label: string;
          roll: number;
          held: unknown[];
          simulated: boolean;
          fainted: boolean;
          ranges: number[];
          result: boolean;
        }[] = [
          // roll 49 < 50 passes, then the pick draws over the 3 items
          {
            label: "roll passes, items",
            roll: 49,
            held: items,
            simulated: false,
            fainted: false,
            ranges: [100, 3],
            result: true,
          },
          // roll 50 >= 50 fails: only the first draw
          {
            label: "roll fails",
            roll: 50,
            held: items,
            simulated: false,
            fainted: false,
            ranges: [100],
            result: false,
          },
          // the roll is drawn even when the foe holds nothing, and there is no second draw
          {
            label: "roll passes, no items",
            roll: 0,
            held: noItems,
            simulated: false,
            fainted: false,
            ranges: [100],
            result: false,
          },
          // the guards stop before the first draw
          { label: "simulated", roll: 0, held: items, simulated: true, fainted: false, ranges: [], result: false },
        ];
        for (const testCase of cases) {
          held = testCase.held;
          next = testCase.roll;
          const results: boolean[] = [];
          const logs: number[][] = [];
          for (const attr of [original, rebuilt]) {
            log = [];
            results.push(attr.canApply(koParams(holder, foe, { simulated: testCase.simulated })));
            logs.push([...log]);
          }
          expect(logs[0], `${site.abilityName} ${testCase.label}: original draws`).toEqual(testCase.ranges);
          expect(logs[1], `${site.abilityName} ${testCase.label}: rebuild draws`).toEqual(testCase.ranges);
          expect(results, `${site.abilityName} ${testCase.label}: results`).toEqual([testCase.result, testCase.result]);
        }
        // Not credited with the knock-out (the victim's latest attack came from somebody else): no draw at all.
        held = items;
        next = 0;
        for (const attr of [original, rebuilt]) {
          log = [];
          foe.turnData.attacksReceived = [];
          expect(attr.canApply({ pokemon: holder, victim: foe, simulated: false } as never)).toBe(false);
          expect(log, "no credit, no draw").toEqual([]);
        }
        // A fainted holder never rolls.
        const hp = holder.hp;
        holder.hp = 0;
        for (const attr of [original, rebuilt]) {
          log = [];
          expect(attr.canApply(koParams(holder, foe))).toBe(false);
          expect(log, "fainted, no draw").toEqual([]);
        }
        holder.hp = hp;
      }
    });

    it("the chance setting moves the roll boundary of the rebuild", async () => {
      const { game, holder, foe } = await startWorld(phaserGame);
      const site = sitesOf("ScavengerLootAbAttr")[0];
      const module = moduleOf("ScavengerLootAbAttr");
      vi.spyOn(game.scene, "findModifiers").mockImplementation(() => [{ isTransferable: true }] as never);
      vi.spyOn(game.scene, "canTransferHeldItemModifier").mockReturnValue(true);
      let next = 0;
      vi.spyOn(game.scene, "randBattleSeedInt").mockImplementation((range: number) => Math.min(next, range - 1));
      const twenty = recomposeAttr(module, site.attr, site.abilityId, site.attrIndex, {
        params: { chance: 20 },
      }) as ScavengerLootAbAttr;
      const original = new ScavengerLootAbAttr({ chance: 0.2 });
      for (const roll of [0, 19, 20, 21, 49, 99]) {
        next = roll;
        expect(twenty.canApply(koParams(holder, foe)), `roll ${roll}`).toBe(original.canApply(koParams(holder, foe)));
        expect(original.canApply(koParams(holder, foe)), `roll ${roll} original`).toBe(roll < 20);
      }
    });
  });

  // -------------------------------------------------------------------------------------------------------------------
  it("LifestealOnHit: guards + gate + residual equals the closure the constructor still hands to the parent, for every user", async () => {
    const { holder, foe } = await startWorld(phaserGame);
    const sites = sitesOf("LifestealOnHitAbAttr");
    expect(sites.map(site => site.abilityName).sort()).toEqual([
      "Energy Horns",
      "Energy Siphon",
      "Energy Tap",
      "Hydro Circuit",
      "Nosferatu",
      "Pure Love",
      "Twin Lion Fists",
      "Vitality Strike",
    ]);
    const module = moduleOf("LifestealOnHitAbAttr");
    const legacy = new Set(["Nosferatu", "Vitality Strike", "Energy Horns", "Twin Lion Fists"]);
    const moves = [
      allMoves[MoveId.TACKLE],
      allMoves[MoveId.WATER_GUN],
      allMoves[MoveId.EMBER],
      allMoves[MoveId.SWORDS_DANCE],
      moveWith(MoveFlags.PUNCHING_MOVE),
      moveWith(MoveFlags.HORN_BASED),
      moveWith(MoveFlags.BITING_MOVE),
    ];
    const tagGetter = vi.spyOn(foe, "getTag");
    for (const site of sites) {
      const original = site.attr as LifestealOnHitAbAttr;
      const oldClosure = (
        original as unknown as { attackCondition: (u: Pokemon, t: Pokemon | null, m: unknown) => boolean }
      ).attackCondition;
      const rebuilt = legacy.has(site.abilityName)
        ? undefined
        : (recomposeAttr(module, original, site.abilityId, site.attrIndex) as LifestealOnHitAbAttr);
      if (rebuilt === undefined) {
        expect(() => recomposeAttr(module, original, site.abilityId, site.attrIndex), site.abilityName).toThrow(
          /no library binding for gate/,
        );
      }
      let passes = 0;
      let blocks = 0;
      for (const infatuated of [false, true]) {
        tagGetter.mockImplementation(((tag: BattlerTagType) =>
          infatuated && tag === BattlerTagType.INFATUATED ? {} : undefined) as never);
        for (const move of moves) {
          for (const damage of [0, 1, 12]) {
            const params = {
              pokemon: holder,
              opponent: foe,
              move,
              damage,
              hitResult: HitResult.EFFECTIVE,
              simulated: false,
            } as never;
            const expected = oldClosure(holder, foe, move) && damage > 0;
            const label = `${site.abilityName} ${move.name} damage ${damage} infatuated ${infatuated}`;
            expect(original.canApply(params), label).toBe(expected);
            if (rebuilt !== undefined) {
              expect(rebuilt.canApply(params), `${label} (rebuilt)`).toBe(expected);
            }
            passes += expected ? 1 : 0;
            blocks += expected ? 0 : 1;
          }
        }
      }
      // A missing target (pokerogue's nullable signature) never heals, and the guard answers before the gate looks at it.
      const noTarget = {
        pokemon: holder,
        opponent: null,
        move: moves[0],
        damage: 10,
        hitResult: HitResult.EFFECTIVE,
        simulated: false,
      } as never;
      expect(original.canApply(noTarget)).toBe(false);
      expect(oldClosure(holder, null, moves[0])).toBe(false);
      expect(rebuilt?.canApply(noTarget) ?? false).toBe(false);
      // The agreement is not vacuous: every user passes some case and blocks some case.
      expect(passes, `${site.abilityName} passes something`).toBeGreaterThan(0);
      expect(blocks, `${site.abilityName} blocks something`).toBeGreaterThan(0);
    }
    tagGetter.mockRestore();
  });

  it("LifestealOnHit: the settings read back for every user and the filter text round-trips", async () => {
    await startWorld(phaserGame);
    const module = moduleOf("LifestealOnHitAbAttr");
    const expected: Record<string, { healPercent: number; filter: string }> = {
      "Energy Siphon": { healPercent: 25, filter: "any damaging move" },
      "Energy Tap": { healPercent: 12.5, filter: "any damaging move" },
      "Hydro Circuit": { healPercent: 25, filter: "type=WATER" },
      "Pure Love": { healPercent: 25, filter: "targetTag=INFATUATED" },
      Nosferatu: { healPercent: 50, filter: "flag=MAKES_CONTACT" },
      "Vitality Strike": { healPercent: 25, filter: "flag=PUNCHING_MOVE" },
      "Energy Horns": { healPercent: 12.5, filter: "flag=HORN_BASED" },
      "Twin Lion Fists": { healPercent: 25, filter: "flag=PUNCHING_MOVE" },
    };
    for (const site of sitesOf("LifestealOnHitAbAttr")) {
      const params = readDeclParams(module, site.attr);
      expect(params, site.abilityName).toMatchObject({
        ...expected[site.abilityName],
        bonusTypes: "",
        bonusPercent: 0,
      });
    }
    // The bonus share (no ability uses it) is kept by a rebuild and reaches the constructor as a fraction.
    const bonus = new LifestealOnHitAbAttr({
      healFraction: 0.25,
      boostedTargetTypes: [PokemonType.GRASS, PokemonType.BUG],
      boostedHealFraction: 0.5,
    });
    expect(readDeclParams(module, bonus)).toMatchObject({ bonusTypes: "GRASS,BUG", bonusPercent: 50 });
  });

  it("LifestealOnHit: the bigger share against the chosen foe types is used by a rebuild exactly like the class", async () => {
    const { game, holder, foe } = await startWorld(phaserGame);
    const unshift = vi.spyOn(game.scene.phaseManager, "unshiftNew").mockImplementation((() => {}) as never);
    const original = new LifestealOnHitAbAttr({
      healFraction: 0.25,
      boostedTargetTypes: [PokemonType.WATER],
      boostedHealFraction: 0.5,
    });
    const site = sitesOf("LifestealOnHitAbAttr").find(s => s.abilityName === "Energy Siphon")!;
    const rebuilt = recomposeAttr(
      moduleOf("LifestealOnHitAbAttr"),
      original,
      site.abilityId,
      site.attrIndex,
    ) as LifestealOnHitAbAttr;
    const hit = {
      pokemon: holder,
      opponent: foe,
      move: allMoves[MoveId.TACKLE],
      damage: 40,
      hitResult: HitResult.EFFECTIVE,
      simulated: false,
    } as never;
    for (const types of [[PokemonType.WATER], [PokemonType.FIRE]]) {
      vi.spyOn(foe, "getTypes").mockReturnValue(types);
      unshift.mockClear();
      original.apply(hit);
      const fromOriginal = unshift.mock.calls.map(call => call[2]);
      unshift.mockClear();
      rebuilt.apply(hit);
      expect(unshift.mock.calls.map(call => call[2])).toEqual(fromOriginal);
      expect(fromOriginal).toEqual([types[0] === PokemonType.WATER ? 20 : 10]);
    }
  });

  // -------------------------------------------------------------------------------------------------------------------
  it("LifestealOnKo: only the holder whose direct hit was the last attack heals, only below full HP, and the biting bonus follows the move", async () => {
    const { game, holder, foe } = await startWorld(phaserGame);
    const sites = sitesOf("LifestealOnKoAbAttr");
    expect(sites).toHaveLength(18);
    const module = moduleOf("LifestealOnKoAbAttr");
    const unshift = vi.spyOn(game.scene.phaseManager, "unshiftNew").mockImplementation((() => {}) as never);
    const biting = moveWith(MoveFlags.BITING_MOVE);
    const maxHp = holder.getMaxHp();
    holder.hp = maxHp - 1;
    const credited = (move: MoveId, source: Pokemon = holder) => {
      foe.turnData.attacksReceived = [
        {
          move,
          result: HitResult.EFFECTIVE,
          damage: 10,
          critical: false,
          sourceId: source.id,
          sourceBattlerIndex: source.getBattlerIndex(),
        },
      ];
      return { pokemon: holder, victim: foe, simulated: false } as never;
    };
    const healOf = (attr: AbAttr, params: never): number[] => {
      unshift.mockClear();
      attr.apply(params);
      return unshift.mock.calls.filter(call => call[0] === "PokemonHealPhase").map(call => call[2] as number);
    };
    const bonusUsers = new Set(["Hungry Maws", "Jaws of Carnage", "World-Eater"]);
    for (const site of sites) {
      const original = site.attr as LifestealOnKoAbAttr;
      const rebuilt = recomposeAttr(module, original, site.abilityId, site.attrIndex) as LifestealOnKoAbAttr;
      const params = readDeclParams(module, original);
      expect(params, site.abilityName).toEqual({
        healPercent: 25,
        flagBonus: bonusUsers.has(site.abilityName) ? "biting=50" : "",
      });
      for (const attr of [original, rebuilt]) {
        expect(attr.canApply(credited(MoveId.TACKLE)), `${site.abilityName} credited`).toBe(true);
        expect(attr.canApply(credited(MoveId.TACKLE, foe)), `${site.abilityName} not credited`).toBe(false);
        holder.hp = maxHp;
        expect(attr.canApply(credited(MoveId.TACKLE)), `${site.abilityName} full HP`).toBe(false);
        holder.hp = 0;
        expect(attr.canApply(credited(MoveId.TACKLE)), `${site.abilityName} fainted`).toBe(false);
        holder.hp = maxHp - 1;
      }
      const quarter = Math.floor(maxHp / 4);
      const half = Math.floor(maxHp / 2);
      expect(healOf(original, credited(MoveId.TACKLE))).toEqual([quarter]);
      expect(healOf(rebuilt, credited(MoveId.TACKLE))).toEqual([quarter]);
      const expectedBite = bonusUsers.has(site.abilityName) ? half : quarter;
      expect(healOf(original, credited(biting.id)), `${site.abilityName} biting (original)`).toEqual([expectedBite]);
      expect(healOf(rebuilt, credited(biting.id)), `${site.abilityName} biting (rebuilt)`).toEqual([expectedBite]);
      // A simulated call changes nothing.
      expect(healOf(original, { ...(credited(MoveId.TACKLE) as object), simulated: true } as never)).toEqual([]);
    }
    // The bonus setting accepts a word, a bad word is a plain error, and 0 percent is refused.
    const bonus = recomposeAttr(module, sites[0].attr, sites[0].abilityId, sites[0].attrIndex, {
      params: { flagBonus: "punching=40" },
    }) as LifestealOnKoAbAttr;
    expect(healOf(bonus, credited(moveWith(MoveFlags.PUNCHING_MOVE).id))).toEqual([Math.floor(maxHp * 0.4)]);
    expect(() =>
      recomposeAttr(module, sites[0].attr, sites[0].abilityId, sites[0].attrIndex, {
        params: { flagBonus: "nonsense=40" },
      }),
    ).toThrow(/not a known move property/);
    expect(() =>
      recomposeAttr(module, sites[0].attr, sites[0].abilityId, sites[0].attrIndex, {
        params: { flagBonus: "biting=0" },
      }),
    ).toThrow(/percent/);
  });

  // -------------------------------------------------------------------------------------------------------------------
  it("MoveCategoryOverride: the six users read back and rebuild; the property test counts injected properties only when the user is known", async () => {
    const { holder } = await startWorld(phaserGame);
    const sites = sitesOf("MoveCategoryOverrideAbAttr");
    expect(sites.map(site => site.abilityName).sort()).toEqual([
      "Best Offense",
      "Blade's Essence",
      "Magus Blades",
      "Mystic Blades",
      "Sinister Claws",
      "Spiritual Saber",
    ]);
    const module = moduleOf("MoveCategoryOverrideAbAttr");
    const slicing = moveWith(MoveFlags.SLICING_MOVE);
    const tackle = allMoves[MoveId.TACKLE];
    for (const site of sites) {
      const original = site.attr as MoveCategoryOverrideAbAttr;
      expect(readDeclParams(module, original), site.abilityName).toEqual({ flag: "SLICING_MOVE", category: "SPECIAL" });
      const rebuilt = recomposeAttr(module, original, site.abilityId, site.attrIndex) as MoveCategoryOverrideAbAttr;
      expect(rebuilt.showAbility, `${site.abilityName} keeps showAbility false`).toBe(false);
      for (const attr of [original, rebuilt]) {
        expect(attr.resolveCategory(slicing, holder)).toBe(MoveCategory.SPECIAL);
        expect(attr.resolveCategory(slicing)).toBe(MoveCategory.SPECIAL);
        expect(attr.resolveCategory(slicing, null)).toBe(MoveCategory.SPECIAL);
        expect(attr.resolveCategory(tackle, holder)).toBeNull();
        expect(attr.resolveCategory(tackle)).toBeNull();
      }
    }
    // The settings move the rule: punching moves become physical.
    const punch = recomposeAttr(module, sites[0].attr, sites[0].abilityId, sites[0].attrIndex, {
      params: { flag: "PUNCHING_MOVE", category: "PHYSICAL" },
    }) as MoveCategoryOverrideAbAttr;
    expect(punch.resolveCategory(moveWith(MoveFlags.PUNCHING_MOVE), holder)).toBe(MoveCategory.PHYSICAL);
    expect(punch.resolveCategory(slicing, holder)).toBeNull();
  });

  // -------------------------------------------------------------------------------------------------------------------
  it("TypeAbsorbHeal, TypeAbsorbStatBoost, TypeAbsorbHighestAttackStatBoost: settings read back, and the rebuild applies like the original", async () => {
    const { game, holder } = await startWorld(phaserGame);
    const unshift = vi.spyOn(game.scene.phaseManager, "unshiftNew").mockImplementation((() => {}) as never);
    const maxHp = holder.getMaxHp();
    const run = (attr: AbAttr, simulated = false) => {
      const typeMultiplier = new NumberHolder(1);
      const cancelled = new BooleanHolder(false);
      unshift.mockClear();
      attr.apply({ pokemon: holder, typeMultiplier, cancelled, simulated } as never);
      return {
        multiplier: typeMultiplier.value,
        cancelled: cancelled.value,
        phases: unshift.mock.calls.map(call => [call[0], ...call.slice(2)]),
      };
    };

    // Heal: Poison Absorb and Ice Plumes.
    const heal = sitesOf("TypeAbsorbHealAbAttr");
    expect(heal.map(site => site.abilityName).sort()).toEqual(["Ice Plumes", "Poison Absorb"]);
    const healModule = moduleOf("TypeAbsorbHealAbAttr");
    const types = { "Poison Absorb": "POISON", "Ice Plumes": "ROCK" } as Record<string, string>;
    for (const site of heal) {
      expect(readDeclParams(healModule, site.attr), site.abilityName).toEqual({
        type: types[site.abilityName],
        healPercent: 25,
      });
      const rebuilt = recomposeAttr(healModule, site.attr, site.abilityId, site.attrIndex);
      for (const hp of [maxHp - 1, maxHp]) {
        holder.hp = hp;
        expect(run(rebuilt), `${site.abilityName} hp ${hp}`).toEqual(run(site.attr));
      }
      holder.hp = maxHp - 1;
      expect(run(site.attr).phases).toEqual([["PokemonHealPhase", Math.floor(maxHp / 4), null, true]]);
      expect(run(site.attr).cancelled).toBe(true);
      holder.hp = maxHp;
      expect(run(site.attr)).toMatchObject({ multiplier: 0, cancelled: false, phases: [] }); // full HP: blocked, no heal, normal message
      expect(run(site.attr, true)).toMatchObject({ multiplier: 0, phases: [] });
    }

    // Stat: Aerodynamics and Fluttering Spirit.
    const stat = sitesOf("TypeAbsorbStatBoostAbAttr");
    expect(stat.map(site => site.abilityName).sort()).toEqual(["Aerodynamics", "Fluttering Spirit"]);
    const statModule = moduleOf("TypeAbsorbStatBoostAbAttr");
    for (const site of stat) {
      expect(readDeclParams(statModule, site.attr), site.abilityName).toEqual({
        type: "FLYING",
        stat: "SPD",
        stages: 1,
      });
      const rebuilt = recomposeAttr(statModule, site.attr, site.abilityId, site.attrIndex);
      expect(run(rebuilt)).toEqual(run(site.attr));
      expect(run(site.attr)).toMatchObject({ multiplier: 0, cancelled: true });
      expect(run(site.attr, true).phases).toEqual([]);
    }

    // Highest attacking stat: Ice Dew, Heat Sink, Alluring Skull. The stat is chosen at the moment of the hit, a tie picks Attack.
    const best = sitesOf("TypeAbsorbHighestAttackStatBoostAbAttr");
    expect(best.map(site => site.abilityName).sort()).toEqual(["Alluring Skull", "Heat Sink", "Ice Dew"]);
    const bestModule = moduleOf("TypeAbsorbHighestAttackStatBoostAbAttr");
    const typeOf = { "Ice Dew": "ICE", "Heat Sink": "FIRE", "Alluring Skull": "GHOST" } as Record<string, string>;
    for (const site of best) {
      expect(readDeclParams(bestModule, site.attr), site.abilityName).toEqual({
        type: typeOf[site.abilityName],
        stages: 1,
      });
      const rebuilt = recomposeAttr(bestModule, site.attr, site.abilityId, site.attrIndex);
      for (const [atk, spatk, chosen] of [
        [100, 90, Stat.ATK],
        [90, 100, Stat.SPATK],
        [100, 100, Stat.ATK],
      ] as const) {
        vi.spyOn(holder, "getStat").mockImplementation(((s: Stat) =>
          s === Stat.ATK ? atk : s === Stat.SPATK ? spatk : 1) as never);
        const fromOriginal = run(site.attr);
        expect(run(rebuilt), `${site.abilityName} ${atk}/${spatk}`).toEqual(fromOriginal);
        expect(fromOriginal.phases).toEqual([["StatStageChangePhase", true, [chosen], 1]]);
      }
    }
  });
});
