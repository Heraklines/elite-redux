/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// B15 chunk 5 probes: what the shared L1 and L2 suites cannot see.
//   - the constructor arguments added for the typed params keep the old literals as defaults, every param round-trips through the declaration (read from the
//     live attr, rebuilt with a new value) and the engine seams really read the value from the holder's attr (Soulmate shares, Silken Decree turns, Tangled Seed turns);
//   - the Tier B classes (set a terrain when hit, stat change after a move property, after a move category, stat drop after a move property): the guards / gate split
//     gives the same answer, and the same number of random draws, as the ORIGINAL clause order over every combination of its inputs, and a swapped gate cannot bypass
//     the safety rules;
//   - Silken Decree: which foes are sealed and for how many turns; Soulmate: the damage and heal seams; Tangled Seed: the Leech Seed seam.
import { globalScene } from "#app/global-scene";
import { SeedTag } from "#data/battler-tags";
import { formLink, getLinkedAlly } from "#data/elite-redux/abilities/link";
import { SetTerrainOnHitAbAttr } from "#data/elite-redux/abilities/set-arena-effect-on-hit";
import { ShatteredPsycheAbAttr } from "#data/elite-redux/abilities/shattered-psyche";
import { SilkenDecreeAbAttr } from "#data/elite-redux/abilities/silken-decree";
import { erApplySoulmateHealCopy, erApplySoulmateRedirect, SoulmateAbAttr } from "#data/elite-redux/abilities/soulmate";
import { StatBoostOnFlagAttackAbAttr } from "#data/elite-redux/abilities/stat-boost-on-flag-attack";
import { StatChangeOnCategoryAttackAbAttr } from "#data/elite-redux/abilities/stat-change-on-category-attack";
import { StatDebuffOnFlagAttackAbAttr } from "#data/elite-redux/abilities/stat-debuff-on-flag-attack";
import { TangledSeedAbAttr } from "#data/elite-redux/abilities/tangled-seed";
import { readDeclParams, recomposeAttr } from "#data/elite-redux/ability-studio/build-attr";
import { declRegistry } from "#data/elite-redux/ability-studio/decl-registry";
import { TerrainType } from "#data/terrain";
import { BattlerTagType } from "#enums/battler-tag-type";
import { HitResult } from "#enums/hit-result";
import { MoveCategory } from "#enums/move-category";
import { MoveFlags } from "#enums/move-flags";
import { MoveId } from "#enums/move-id";
import { Stat } from "#enums/stat";
import type { Pokemon } from "#field/pokemon";
import { startWorld } from "#test/tests/elite-redux/decomp/harness/game";
import { liveAbility } from "#test/tests/elite-redux/decomp/harness/twin";
import Phaser from "phaser";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

const POWER_LEAK = 5599;
const BRAIN_OVERLOAD = 5655;
const GROWING_TOOTH = 5027;
const HARDENED_SHEATH = 5129;
const DAREDEVIL = 5709;
const DENTING_BLOWS = 5347;
const CHAINSAW = 5623;
const CRUSHING_JAW = 5677;
const AUGUR = 6043;
const CROSSBOW = 6105;
const WHIPLASH = 5425;
const SILKEN_DECREE = 5900;
const TANGLED_SEED = 5903;
const SOULMATE = 5918;
const SHATTERED_PSYCHE = 5968;

function declared(className: string) {
  const module = declRegistry.get(className);
  expect(module, `${className} must be declared`).toBeDefined();
  return module!;
}

/** Makes `holder` carry `attr` as its only active ability attr (the seams find it by constructor name). */
function carry(holder: Pokemon, attr: unknown): void {
  vi.spyOn(holder, "getAllActiveAbilityAttrs").mockReturnValue([attr] as never);
  vi.spyOn(holder, "isActive").mockReturnValue(true);
}

/** A move stand-in: the category and the set of move properties it carries (the same doesFlagEffectApply shape the class calls). */
function fakeMove(category: MoveCategory, flags: readonly MoveFlags[]) {
  return {
    category,
    doesFlagEffectApply: ({ flag }: { flag: MoveFlags }) => flags.includes(flag),
    hasFlag: (flag: MoveFlags) => flags.includes(flag),
  } as never;
}

describe("B15 chunk 5", () => {
  let phaserGame: Phaser.Game;
  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("the constructor arguments keep the old numbers by default and every declaration reads and rebuilds its params", () => {
    it("defaults equal the old literals and the class names are unchanged (the engine seams find them by name)", () => {
      const soulmate = new SoulmateAbAttr();
      expect([soulmate.damageShare, soulmate.healShare]).toEqual([0.25, 0.5]);
      expect(soulmate.showAbility).toBe(false);
      const silken = new SilkenDecreeAbAttr();
      expect(silken.turns).toBe(1);
      expect(silken.showAbility).toBe(true);
      const tangled = new TangledSeedAbAttr();
      expect(tangled.trapTurns).toBe(2);
      expect(tangled.showAbility).toBe(false);
      expect(new ShatteredPsycheAbAttr().showAbility).toBe(false);
      expect([soulmate, silken, tangled, new ShatteredPsycheAbAttr()].map(attr => attr.constructor.name)).toEqual([
        "SoulmateAbAttr",
        "SilkenDecreeAbAttr",
        "TangledSeedAbAttr",
        "ShatteredPsycheAbAttr",
      ]);
    });

    it("the eleven users of the four stat and terrain classes keep their own values after a rebuild", async () => {
      await startWorld(phaserGame);
      // [ability, attr index, class, expected params]
      const users: [number, number, string, Record<string, unknown>][] = [
        [POWER_LEAK, 0, "SetTerrainOnHitAbAttr", { terrain: "ELECTRIC", contactRequired: false }],
        [BRAIN_OVERLOAD, 0, "SetTerrainOnHitAbAttr", { terrain: "PSYCHIC", contactRequired: false }],
        [GROWING_TOOTH, 0, "StatBoostOnFlagAttackAbAttr", { flag: "BITING_MOVE", stat: "ATK", stages: 1 }],
        [HARDENED_SHEATH, 0, "StatBoostOnFlagAttackAbAttr", { flag: "HORN_BASED", stat: "ATK", stages: 1 }],
        [DAREDEVIL, 1, "StatBoostOnFlagAttackAbAttr", { flag: "RECKLESS_MOVE", stat: "ATK", stages: 1 }],
        [
          DENTING_BLOWS,
          0,
          "StatDebuffOnFlagAttackAbAttr",
          { flag: "HAMMER_BASED", stat: "DEF", stages: -1, chance: 100 },
        ],
        [CHAINSAW, 0, "StatDebuffOnFlagAttackAbAttr", { flag: "SLICING_MOVE", stat: "DEF", stages: -1, chance: 100 }],
        [CRUSHING_JAW, 1, "StatDebuffOnFlagAttackAbAttr", { flag: "BITING_MOVE", stat: "DEF", stages: -1, chance: 50 }],
        [AUGUR, 0, "StatDebuffOnFlagAttackAbAttr", { flag: "DRILL_BASED", stat: "DEF", stages: -1, chance: 100 }],
        [CROSSBOW, 0, "StatDebuffOnFlagAttackAbAttr", { flag: "ARROW_BASED", stat: "DEF", stages: -1, chance: 100 }],
        [
          WHIPLASH,
          0,
          "StatChangeOnCategoryAttackAbAttr",
          { category: "PHYSICAL", stat: "DEF", stages: -1, target: "THE_TARGET" },
        ],
      ];
      for (const [id, index, className, expected] of users) {
        const module = declared(className);
        const original = liveAbility(id).attrs[index];
        expect(original.constructor.name, `${id} attr ${index}`).toBe(className);
        const read = readDeclParams(module, original);
        for (const [key, value] of Object.entries(expected)) {
          expect(read[key], `${id} ${key}`).toBe(value);
        }
        const rebuilt = recomposeAttr(module, original, id, index);
        expect(rebuilt.constructor.name).toBe(className);
        expect(readDeclParams(module, rebuilt), `${id} rebuilt`).toEqual(read);
      }
      // Other values go through the codecs: the names staff see become the numbers the constructors want.
      const denting = liveAbility(DENTING_BLOWS).attrs[0];
      const changed = recomposeAttr(declared("StatDebuffOnFlagAttackAbAttr"), denting, DENTING_BLOWS, 0, {
        params: { flag: "KICKING_MOVE", stat: "SPD", stages: -2, chance: 30 },
      }) as unknown as { flag: MoveFlags; stat: Stat; stages: number; chance: number };
      expect([changed.flag, changed.stat, changed.stages, changed.chance]).toEqual([
        MoveFlags.KICKING_MOVE,
        Stat.SPD,
        -2,
        30,
      ]);
      const whip = liveAbility(WHIPLASH).attrs[0];
      const flipped = recomposeAttr(declared("StatChangeOnCategoryAttackAbAttr"), whip, WHIPLASH, 0, {
        params: { category: "SPECIAL", target: "MYSELF", stages: 2 },
      }) as unknown as { category: MoveCategory; target: string; stages: number };
      expect([flipped.category, flipped.target, flipped.stages]).toEqual([MoveCategory.SPECIAL, "self", 2]);
      const leak = liveAbility(POWER_LEAK).attrs[0];
      const grassy = recomposeAttr(declared("SetTerrainOnHitAbAttr"), leak, POWER_LEAK, 0, {
        params: { terrain: "GRASSY" },
      }) as SetTerrainOnHitAbAttr;
      expect(grassy.getTerrain()).toBe(TerrainType.GRASSY);
      expect(grassy.requiresContact()).toBe(false);
    });

    it("Silken Decree, Soulmate and Tangled Seed read, rebuild and keep their numbers; Shattered Psyche has none", async () => {
      await startWorld(phaserGame);
      const silken = liveAbility(SILKEN_DECREE).attrs[0] as SilkenDecreeAbAttr;
      expect(silken.turns).toBe(1);
      const silkenRebuilt = recomposeAttr(declared("SilkenDecreeAbAttr"), silken, SILKEN_DECREE, 0, {
        params: { turns: 3 },
      }) as SilkenDecreeAbAttr;
      expect(silkenRebuilt.turns).toBe(3);
      expect(silkenRebuilt.showAbility).toBe(true);

      const soulmate = liveAbility(SOULMATE).attrs[0] as SoulmateAbAttr;
      expect(readDeclParams(declared("SoulmateAbAttr"), soulmate)).toEqual({ damageShare: 0.25, healShare: 0.5 });
      const soulmateRebuilt = recomposeAttr(declared("SoulmateAbAttr"), soulmate, SOULMATE, 0, {
        params: { damageShare: 0.4, healShare: 0.75 },
      }) as SoulmateAbAttr;
      expect([soulmateRebuilt.damageShare, soulmateRebuilt.healShare, soulmateRebuilt.showAbility]).toEqual([
        0.4,
        0.75,
        false,
      ]);

      const tangled = liveAbility(TANGLED_SEED).attrs[0] as TangledSeedAbAttr;
      expect(tangled.trapTurns).toBe(2);
      const tangledRebuilt = recomposeAttr(declared("TangledSeedAbAttr"), tangled, TANGLED_SEED, 0, {
        params: { trapTurns: 4 },
      }) as TangledSeedAbAttr;
      expect([tangledRebuilt.trapTurns, tangledRebuilt.showAbility]).toEqual([4, false]);

      expect(declared("ShatteredPsycheAbAttr").decl.params).toEqual([]);
      const psyche = liveAbility(SHATTERED_PSYCHE).attrs[0];
      expect(recomposeAttr(declared("ShatteredPsycheAbAttr"), psyche, SHATTERED_PSYCHE, 0).constructor.name).toBe(
        "ShatteredPsycheAbAttr",
      );
    });
  });

  describe("Tier B classes: guards and gate equal the original clause order, including the random draws", () => {
    function hitParams(holder: Pokemon, foe: Pokemon, move: unknown, hitResult: HitResult, simulated = false): never {
      return { pokemon: holder, opponent: foe, move, hitResult, damage: 10, simulated } as never;
    }

    /** The ORIGINAL StatDebuffOnFlagAttackAbAttr.canApply, copied from the source before the split (clause order: damaging, hit connected, first strike, property, chance). */
    function originalDebuffCanApply(attr: StatDebuffOnFlagAttackAbAttr, params: any): boolean {
      const { pokemon, opponent, move, hitResult } = params;
      const own = attr as unknown as { flag: MoveFlags; chance: number };
      if (!(move.category !== MoveCategory.STATUS)) {
        return false;
      }
      if (hitResult >= HitResult.NO_EFFECT) {
        return false;
      }
      if (pokemon.turnData.hitCount !== pokemon.turnData.hitsLeft) {
        return false;
      }
      if (!move.doesFlagEffectApply({ flag: own.flag, user: pokemon, target: opponent })) {
        return false;
      }
      return own.chance >= 100 || pokemon.randBattleSeedInt(100) < own.chance;
    }

    it("stat drop after a move property: every input combination gives the same answer and the same draws as the original order", async () => {
      const { holder, foe } = await startWorld(phaserGame);
      const flagged = MoveFlags.HAMMER_BASED;
      let draws = 0;
      let nextRoll = 10;
      vi.spyOn(holder, "randBattleSeedInt").mockImplementation(() => {
        draws++;
        return nextRoll;
      });
      const module = declared("StatDebuffOnFlagAttackAbAttr");
      let combos = 0;
      for (const chance of [100, 50]) {
        const original = new StatDebuffOnFlagAttackAbAttr({ flag: flagged, stat: Stat.DEF, stages: -1, chance });
        const rebuilt = recomposeAttr(module, original, CRUSHING_JAW, 1, { params: { flag: "HAMMER_BASED", chance } });
        for (const category of [MoveCategory.STATUS, MoveCategory.PHYSICAL]) {
          for (const hitResult of [HitResult.EFFECTIVE, HitResult.NO_EFFECT, HitResult.MISS]) {
            for (const [hitCount, hitsLeft] of [
              [2, 2],
              [2, 1],
            ]) {
              for (const hasFlag of [true, false]) {
                for (const roll of [10, 90]) {
                  nextRoll = roll;
                  holder.turnData.hitCount = hitCount;
                  holder.turnData.hitsLeft = hitsLeft;
                  const params = hitParams(holder, foe, fakeMove(category, hasFlag ? [flagged] : []), hitResult);
                  draws = 0;
                  const expected = originalDebuffCanApply(original, params);
                  const expectedDraws = draws;
                  for (const attr of [original, rebuilt] as StatDebuffOnFlagAttackAbAttr[]) {
                    draws = 0;
                    expect(
                      attr.canApply(params),
                      `${chance}% ${category} ${hitResult} hits ${hitCount}/${hitsLeft} flag ${hasFlag} roll ${roll}`,
                    ).toBe(expected);
                    expect(draws, `draws: ${chance}% ${category} ${hitResult} ${hitCount}/${hitsLeft} ${hasFlag}`).toBe(
                      expectedDraws,
                    );
                  }
                  combos++;
                }
              }
            }
          }
        }
      }
      expect(combos).toBe(96);
    });

    it("stat drop: the one draw happens last, only when every other clause passed, and never at 100%", async () => {
      const { holder, foe } = await startWorld(phaserGame);
      let draws = 0;
      vi.spyOn(holder, "randBattleSeedInt").mockImplementation(() => {
        draws++;
        return 0;
      });
      holder.turnData.hitCount = 1;
      holder.turnData.hitsLeft = 1;
      const jaw = liveAbility(CRUSHING_JAW).attrs[1] as StatDebuffOnFlagAttackAbAttr;
      const rebuiltJaw = recomposeAttr(declared("StatDebuffOnFlagAttackAbAttr"), jaw, CRUSHING_JAW, 1);
      for (const attr of [jaw, rebuiltJaw] as StatDebuffOnFlagAttackAbAttr[]) {
        const biting = fakeMove(MoveCategory.PHYSICAL, [MoveFlags.BITING_MOVE]);
        const plain = fakeMove(MoveCategory.PHYSICAL, []);
        draws = 0;
        expect(attr.canApply(hitParams(holder, foe, plain, HitResult.EFFECTIVE))).toBe(false);
        expect(attr.canApply(hitParams(holder, foe, biting, HitResult.NO_EFFECT))).toBe(false);
        expect(
          attr.canApply(
            hitParams(holder, foe, fakeMove(MoveCategory.STATUS, [MoveFlags.BITING_MOVE]), HitResult.EFFECTIVE),
          ),
        ).toBe(false);
        expect(draws).toBe(0);
        expect(attr.canApply(hitParams(holder, foe, biting, HitResult.EFFECTIVE))).toBe(true);
        expect(draws).toBe(1);
      }
      const denting = liveAbility(DENTING_BLOWS).attrs[0] as StatDebuffOnFlagAttackAbAttr;
      const rebuiltDenting = recomposeAttr(declared("StatDebuffOnFlagAttackAbAttr"), denting, DENTING_BLOWS, 0);
      for (const attr of [denting, rebuiltDenting] as StatDebuffOnFlagAttackAbAttr[]) {
        draws = 0;
        expect(
          attr.canApply(
            hitParams(holder, foe, fakeMove(MoveCategory.PHYSICAL, [MoveFlags.HAMMER_BASED]), HitResult.EFFECTIVE),
          ),
        ).toBe(true);
        expect(draws).toBe(0);
      }
    });

    it("stat drop: a swapped gate follows the new gate but the safety rules (hit connected, first strike) stay locked", async () => {
      const { holder, foe } = await startWorld(phaserGame);
      vi.spyOn(holder, "randBattleSeedInt").mockReturnValue(0);
      const denting = liveAbility(DENTING_BLOWS).attrs[0];
      const anyMove = recomposeAttr(declared("StatDebuffOnFlagAttackAbAttr"), denting, DENTING_BLOWS, 0, {
        conds: { gate: { all: [] } },
      }) as StatDebuffOnFlagAttackAbAttr;
      const plain = fakeMove(MoveCategory.SPECIAL, []);
      holder.turnData.hitCount = 1;
      holder.turnData.hitsLeft = 1;
      expect(anyMove.canApply(hitParams(holder, foe, plain, HitResult.EFFECTIVE))).toBe(true);
      expect(anyMove.canApply(hitParams(holder, foe, plain, HitResult.NO_EFFECT))).toBe(false);
      expect(anyMove.canApply(hitParams(holder, foe, plain, HitResult.MISS))).toBe(false);
      holder.turnData.hitCount = 3;
      holder.turnData.hitsLeft = 2;
      expect(anyMove.canApply(hitParams(holder, foe, plain, HitResult.EFFECTIVE))).toBe(false);
      // The property swapped for "sound move" follows the new property; the flag param moves the gate with it (gateParams).
      holder.turnData.hitCount = 1;
      holder.turnData.hitsLeft = 1;
      const kicking = recomposeAttr(declared("StatDebuffOnFlagAttackAbAttr"), denting, DENTING_BLOWS, 0, {
        params: { flag: "KICKING_MOVE" },
      }) as StatDebuffOnFlagAttackAbAttr;
      expect(
        kicking.canApply(
          hitParams(holder, foe, fakeMove(MoveCategory.PHYSICAL, [MoveFlags.KICKING_MOVE]), HitResult.EFFECTIVE),
        ),
      ).toBe(true);
      expect(
        kicking.canApply(
          hitParams(holder, foe, fakeMove(MoveCategory.PHYSICAL, [MoveFlags.HAMMER_BASED]), HitResult.EFFECTIVE),
        ),
      ).toBe(false);
    });

    it("stat boost after a move property: damaging move then property, no guard; the rebuilt rule and a changed property agree", async () => {
      const { holder, foe } = await startWorld(phaserGame);
      const tooth = liveAbility(GROWING_TOOTH).attrs[0] as StatBoostOnFlagAttackAbAttr;
      const rebuilt = recomposeAttr(declared("StatBoostOnFlagAttackAbAttr"), tooth, GROWING_TOOTH, 0);
      const changed = recomposeAttr(declared("StatBoostOnFlagAttackAbAttr"), tooth, GROWING_TOOTH, 0, {
        params: { flag: "HORN_BASED" },
      });
      for (const category of [MoveCategory.STATUS, MoveCategory.PHYSICAL, MoveCategory.SPECIAL]) {
        for (const hitResult of [HitResult.EFFECTIVE, HitResult.NO_EFFECT, HitResult.MISS]) {
          for (const flags of [[], [MoveFlags.BITING_MOVE], [MoveFlags.HORN_BASED]]) {
            const params = hitParams(holder, foe, fakeMove(category, flags), hitResult);
            // The ORIGINAL clause order: damaging move, then the property. No hit-result and no first-strike clause.
            const expected = category !== MoveCategory.STATUS && flags.includes(MoveFlags.BITING_MOVE);
            expect(tooth.canApply(params), `original ${category} ${hitResult} ${flags}`).toBe(expected);
            expect(rebuilt.canApply(params), `rebuilt ${category} ${hitResult} ${flags}`).toBe(expected);
            expect(changed.canApply(params), `changed ${category} ${hitResult} ${flags}`).toBe(
              category !== MoveCategory.STATUS && flags.includes(MoveFlags.HORN_BASED),
            );
          }
        }
      }
    });

    it("stat change after a move category: damaging move then category, no guard; a changed category moves the gate", async () => {
      const { holder, foe } = await startWorld(phaserGame);
      const whip = liveAbility(WHIPLASH).attrs[0] as StatChangeOnCategoryAttackAbAttr;
      const rebuilt = recomposeAttr(declared("StatChangeOnCategoryAttackAbAttr"), whip, WHIPLASH, 0);
      const special = recomposeAttr(declared("StatChangeOnCategoryAttackAbAttr"), whip, WHIPLASH, 0, {
        params: { category: "SPECIAL" },
      });
      for (const category of [MoveCategory.STATUS, MoveCategory.PHYSICAL, MoveCategory.SPECIAL]) {
        for (const hitResult of [HitResult.EFFECTIVE, HitResult.NO_EFFECT]) {
          const params = hitParams(holder, foe, fakeMove(category, []), hitResult);
          expect(whip.canApply(params)).toBe(category === MoveCategory.PHYSICAL);
          expect(rebuilt.canApply(params)).toBe(category === MoveCategory.PHYSICAL);
          expect(special.canApply(params)).toBe(category === MoveCategory.SPECIAL);
        }
      }
    });

    it("set a terrain when hit: the hit must connect, then a contact move is needed only when contact is required; a rebuilt rule follows its own gate", async () => {
      const { holder, foe } = await startWorld(phaserGame);
      const module = declared("SetTerrainOnHitAbAttr");
      const anyHit = liveAbility(POWER_LEAK).attrs[0] as SetTerrainOnHitAbAttr;
      const contactOnly = new SetTerrainOnHitAbAttr({ terrain: TerrainType.ELECTRIC, contactRequired: true });
      const rebuiltAny = recomposeAttr(module, anyHit, POWER_LEAK, 0) as SetTerrainOnHitAbAttr;
      const contact = fakeMove(MoveCategory.PHYSICAL, [MoveFlags.MAKES_CONTACT]);
      const noContact = fakeMove(MoveCategory.SPECIAL, []);
      for (const attr of [anyHit, rebuiltAny]) {
        expect(attr.canApply(hitParams(holder, foe, contact, HitResult.EFFECTIVE))).toBe(true);
        expect(attr.canApply(hitParams(holder, foe, noContact, HitResult.EFFECTIVE))).toBe(true);
        expect(attr.canApply(hitParams(holder, foe, contact, HitResult.NO_EFFECT))).toBe(false);
        expect(attr.canApply(hitParams(holder, foe, contact, HitResult.MISS))).toBe(false);
      }
      expect(contactOnly.canApply(hitParams(holder, foe, contact, HitResult.EFFECTIVE))).toBe(true);
      expect(contactOnly.canApply(hitParams(holder, foe, noContact, HitResult.EFFECTIVE))).toBe(false);
      expect(contactOnly.canApply(hitParams(holder, foe, contact, HitResult.NO_EFFECT))).toBe(false);
      // The gate swapped for the contact block: contact moves only; the guard still blocks a hit that did not connect.
      const swapped = recomposeAttr(module, anyHit, POWER_LEAK, 0, {
        conds: { gate: { block: "move.flag", params: { flag: "MAKES_CONTACT" } } },
      }) as SetTerrainOnHitAbAttr;
      expect(swapped.canApply(hitParams(holder, foe, contact, HitResult.EFFECTIVE))).toBe(true);
      expect(swapped.canApply(hitParams(holder, foe, noContact, HitResult.EFFECTIVE))).toBe(false);
      expect(swapped.canApply(hitParams(holder, foe, contact, HitResult.NO_EFFECT))).toBe(false);
    });
  });

  describe("effects: what apply queues, for whom, and never in a preview", () => {
    function hitParams(holder: Pokemon, foe: Pokemon, move: unknown, simulated = false): never {
      return { pokemon: holder, opponent: foe, move, hitResult: HitResult.EFFECTIVE, damage: 10, simulated } as never;
    }

    it("the stat classes queue one stat phase on the right Pokemon with their own stat and stages; nothing in a preview", async () => {
      const { holder, foe } = await startWorld(phaserGame);
      const spy = vi.spyOn(globalScene.phaseManager, "unshiftNew").mockImplementation((() => {}) as never);
      const move = fakeMove(MoveCategory.PHYSICAL, []);

      const boost = new StatBoostOnFlagAttackAbAttr({ flag: MoveFlags.BITING_MOVE, stat: Stat.SPD, stages: 2 });
      boost.apply(hitParams(holder, foe, move, true));
      expect(spy).not.toHaveBeenCalled();
      boost.apply(hitParams(holder, foe, move));
      expect(spy).toHaveBeenLastCalledWith("StatStageChangePhase", holder.getBattlerIndex(), true, [Stat.SPD], 2);

      const debuff = new StatDebuffOnFlagAttackAbAttr({ flag: MoveFlags.BITING_MOVE, stat: Stat.SPDEF, stages: -2 });
      spy.mockClear();
      debuff.apply(hitParams(holder, foe, move, true));
      expect(spy).not.toHaveBeenCalled();
      debuff.apply(hitParams(holder, foe, move));
      expect(spy).toHaveBeenLastCalledWith("StatStageChangePhase", foe.getBattlerIndex(), false, [Stat.SPDEF], -2);

      for (const [target, subject, selfTarget] of [
        ["opponent", foe, false],
        ["self", holder, true],
      ] as const) {
        const category = new StatChangeOnCategoryAttackAbAttr({
          category: MoveCategory.SPECIAL,
          stat: Stat.SPATK,
          stages: 1,
          target,
        });
        spy.mockClear();
        category.apply(hitParams(holder, foe, move, true));
        expect(spy).not.toHaveBeenCalled();
        category.apply(hitParams(holder, foe, move));
        expect(spy).toHaveBeenLastCalledWith(
          "StatStageChangePhase",
          subject.getBattlerIndex(),
          selfTarget,
          [Stat.SPATK],
          1,
        );
      }
      // Zero or fractional stages and an out-of-range chance are refused when the ability is built.
      expect(
        () => new StatBoostOnFlagAttackAbAttr({ flag: MoveFlags.BITING_MOVE, stat: Stat.ATK, stages: 0 }),
      ).toThrow();
      expect(
        () => new StatDebuffOnFlagAttackAbAttr({ flag: MoveFlags.BITING_MOVE, stat: Stat.ATK, stages: 1.5 }),
      ).toThrow();
      expect(
        () =>
          new StatDebuffOnFlagAttackAbAttr({ flag: MoveFlags.BITING_MOVE, stat: Stat.ATK, stages: -1, chance: 101 }),
      ).toThrow();
      expect(
        () =>
          new StatChangeOnCategoryAttackAbAttr({
            category: MoveCategory.PHYSICAL,
            stat: Stat.DEF,
            stages: 0,
            target: "opponent",
          }),
      ).toThrow();
    });

    it("set a terrain when hit asks the arena for its own terrain without forcing it, with me as the source, and never in a preview", async () => {
      const { holder, foe } = await startWorld(phaserGame);
      const trySetTerrain = vi.spyOn(globalScene.arena, "trySetTerrain").mockReturnValue(true as never);
      const attr = new SetTerrainOnHitAbAttr({ terrain: TerrainType.PSYCHIC });
      attr.apply(hitParams(holder, foe, fakeMove(MoveCategory.PHYSICAL, []), true));
      expect(trySetTerrain).not.toHaveBeenCalled();
      attr.apply(hitParams(holder, foe, fakeMove(MoveCategory.PHYSICAL, [])));
      expect(trySetTerrain).toHaveBeenCalledTimes(1);
      expect(trySetTerrain).toHaveBeenCalledWith(TerrainType.PSYCHIC, false, holder);
    });
  });

  describe("Silken Decree: which foes are sealed, and for how many turns", () => {
    function foeStub(moves: { moveId: MoveId; out?: boolean }[], fainted = false) {
      return {
        isFainted: () => fainted,
        getMoveset: () => moves.map(move => ({ moveId: move.moveId, isOutOfPp: () => move.out === true })),
        addTag: vi.fn(() => true),
      };
    }

    it("only standing foes with more than one distinct usable move get the seal; canApply says whether any does; the turns are the typed number", async () => {
      const { holder } = await startWorld(phaserGame);
      const several = foeStub([{ moveId: MoveId.TACKLE }, { moveId: MoveId.GROWL }]);
      const single = foeStub([{ moveId: MoveId.TACKLE }, { moveId: MoveId.GROWL, out: true }]);
      const duplicated = foeStub([{ moveId: MoveId.TACKLE }, { moveId: MoveId.TACKLE }]);
      const withNone = foeStub([{ moveId: MoveId.NONE }, { moveId: MoveId.TACKLE }]);
      const fainted = foeStub([{ moveId: MoveId.TACKLE }, { moveId: MoveId.GROWL }], true);
      const opponents = [several, single, duplicated, withNone, fainted, undefined];
      vi.spyOn(holder, "getOpponents").mockReturnValue(opponents as never);
      for (const turns of [1, 3]) {
        const attr = new SilkenDecreeAbAttr(turns);
        expect(attr.canApply({ pokemon: holder } as never)).toBe(true);
        for (const stub of [several, single, duplicated, withNone, fainted]) {
          stub.addTag.mockClear();
        }
        attr.apply({ pokemon: holder, simulated: true } as never);
        expect(several.addTag).not.toHaveBeenCalled();
        attr.apply({ pokemon: holder, simulated: false } as never);
        expect(several.addTag).toHaveBeenCalledTimes(1);
        expect(several.addTag).toHaveBeenCalledWith(BattlerTagType.ER_SILKEN_DECREE, turns, undefined, holder.id);
        for (const stub of [single, duplicated, withNone, fainted]) {
          expect(stub.addTag).not.toHaveBeenCalled();
        }
      }
      vi.spyOn(holder, "getOpponents").mockReturnValue([single, duplicated, fainted] as never);
      expect(new SilkenDecreeAbAttr().canApply({ pokemon: holder } as never)).toBe(false);
      // A rebuilt attr keeps both the constructor values and the end of turn trigger.
      const rebuilt = recomposeAttr(
        declared("SilkenDecreeAbAttr"),
        liveAbility(SILKEN_DECREE).attrs[0],
        SILKEN_DECREE,
        0,
      ) as SilkenDecreeAbAttr;
      expect(rebuilt.turns).toBe(1);
    });
  });

  describe("Soulmate: the damage and healing seams read the shares from the live attr", () => {
    it("a linked ally's direct damage is shared by the typed share, nothing without the marker, a fainted holder or zero damage", async () => {
      const { holder, foe } = await startWorld(phaserGame);
      // The foe stands in for the doubles partner (the link lives in a module WeakMap, so any two Pokemon can be linked).
      vi.spyOn(holder, "getAdjacentAllies").mockReturnValue([foe]);
      const damage = vi.spyOn(holder, "damageAndUpdate").mockReturnValue(0 as never);
      const original = liveAbility(SOULMATE).attrs[0] as SoulmateAbAttr;
      original.apply({ pokemon: holder, simulated: true } as never);
      expect(getLinkedAlly(holder)).toBeUndefined();
      original.apply({ pokemon: holder, simulated: false } as never);
      expect(formLink(holder)).toBe(foe);
      expect(getLinkedAlly(foe)).toBe(holder);

      carry(holder, original);
      expect(erApplySoulmateRedirect(foe, 100)).toBe(25);
      expect(damage).toHaveBeenLastCalledWith(25, expect.objectContaining({ result: HitResult.INDIRECT }));
      expect(erApplySoulmateRedirect(foe, 0)).toBe(0);
      expect(erApplySoulmateRedirect(foe, 1)).toBe(1); // toDmgValue(0.25, 1) is raised to 1

      damage.mockClear();
      carry(holder, new SoulmateAbAttr(0.4, 0.5));
      expect(erApplySoulmateRedirect(foe, 100)).toBe(40);
      expect(damage).toHaveBeenCalledTimes(1);

      // No marker on the partner: nothing moves.
      vi.spyOn(holder, "getAllActiveAbilityAttrs").mockReturnValue([] as never);
      damage.mockClear();
      expect(erApplySoulmateRedirect(foe, 100)).toBe(0);
      expect(damage).not.toHaveBeenCalled();
      // A holder that is not active (left the field) does not share either.
      carry(holder, new SoulmateAbAttr());
      vi.spyOn(holder, "isActive").mockReturnValue(false);
      expect(erApplySoulmateRedirect(foe, 100)).toBe(0);
    });

    it("the holder's direct healing is copied to the linked ally by the typed share, once, never recursively, never at full HP", async () => {
      const { holder, foe } = await startWorld(phaserGame);
      vi.spyOn(holder, "getAdjacentAllies").mockReturnValue([foe]);
      formLink(holder);
      expect(getLinkedAlly(holder)).toBe(foe);
      const heals: number[] = [];
      vi.spyOn(foe, "isFullHp").mockReturnValue(false);
      vi.spyOn(foe, "heal").mockImplementation(((amount: number) => {
        heals.push(amount);
        // A copied heal must not copy again: ask the seam while it is running.
        erApplySoulmateHealCopy(holder, amount);
        return amount;
      }) as never);

      carry(holder, new SoulmateAbAttr());
      erApplySoulmateHealCopy(holder, 80);
      expect(heals).toEqual([40]);

      heals.length = 0;
      carry(holder, new SoulmateAbAttr(0.25, 0.75));
      erApplySoulmateHealCopy(holder, 80);
      expect(heals).toEqual([60]);
      erApplySoulmateHealCopy(holder, 0);
      expect(heals).toEqual([60]);

      heals.length = 0;
      vi.spyOn(foe, "isFullHp").mockReturnValue(true);
      erApplySoulmateHealCopy(holder, 80);
      expect(heals).toEqual([]);

      vi.spyOn(foe, "isFullHp").mockReturnValue(false);
      vi.spyOn(holder, "getAllActiveAbilityAttrs").mockReturnValue([] as never);
      erApplySoulmateHealCopy(holder, 80);
      expect(heals).toEqual([]);
    });
  });

  describe("Tangled Seed: the Leech Seed tag reads the number of turns from the seeder's live attr", () => {
    it("a seeder with the marker traps the seeded foe for the typed number of turns; without it nothing is added", async () => {
      const { holder, foe } = await startWorld(phaserGame);
      // The holder plants the seed on the foe.
      vi.spyOn(globalScene, "getPokemonById").mockReturnValue(holder as never);
      vi.spyOn(globalScene.phaseManager, "queueMessage").mockImplementation((() => {}) as never);
      const addTag = vi.spyOn(foe, "addTag").mockReturnValue(true as never);

      carry(holder, new TangledSeedAbAttr());
      new SeedTag(holder.id).onAdd(foe);
      expect(addTag).toHaveBeenCalledTimes(1);
      expect(addTag).toHaveBeenCalledWith(BattlerTagType.TRAPPED, 2, MoveId.LEECH_SEED, holder.id);

      addTag.mockClear();
      carry(holder, new TangledSeedAbAttr(5));
      new SeedTag(holder.id).onAdd(foe);
      expect(addTag).toHaveBeenCalledWith(BattlerTagType.TRAPPED, 5, MoveId.LEECH_SEED, holder.id);

      addTag.mockClear();
      vi.spyOn(holder, "getAllActiveAbilityAttrs").mockReturnValue([] as never);
      new SeedTag(holder.id).onAdd(foe);
      expect(addTag).not.toHaveBeenCalled();
    });
  });
});
