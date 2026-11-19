/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// B07 chunk 1: the engine sites that the shared L1 / L2 suites cannot reach for the eight classes of the chunk.
//
// A presence flag is never dispatched, and two of the calc hooks (the weight and the berry threshold) are only asked by
// engine code that no scenario template of the battle twin visits. Here each of them is driven AT its engine site,
//
//   original  the live ability (for example Unseen Fist)
//   rebuilt   the same ability rebuilt from its declaration (what a staff blueprint compiles to), where the declaration is live
//   control   Ball Fetch (no such attr)
//
// The rebuilt run must equal the original one and the control must differ. The control is what proves the scenario
// really reaches the site, so equal results are never two empty recordings.
import type { AbAttr } from "#abilities/ab-attrs";
import type { Ability } from "#abilities/ability";
import { applyAbAttrs } from "#abilities/apply-ab-attrs";
import { getBerryPredicate } from "#data/berry";
import { allAbilities, allMoves } from "#data/data-lists";
import { declRegistry } from "#data/elite-redux/ability-studio/decl-registry";
import { AbilityId } from "#enums/ability-id";
import { BerryType } from "#enums/berry-type";
import { MoveFlags } from "#enums/move-flags";
import { MoveId } from "#enums/move-id";
import { MoveUseMode } from "#enums/move-use-mode";
import { Nature } from "#enums/nature";
import { SpeciesId } from "#enums/species-id";
import type { Pokemon } from "#field/pokemon";
import { PokemonMove } from "#moves/pokemon-move";
import { MovePhase } from "#phases/move-phase";
import type { GameManager } from "#test/framework/game-manager";
import { freshGame } from "#test/tests/elite-redux/decomp/harness/game";
import { rebuildAbility, registerShadow, unregisterShadows } from "#test/tests/elite-redux/decomp/harness/rebuild";
import { allocateShadowId } from "#test/tests/elite-redux/decomp/harness/twin";
import { BooleanHolder } from "#utils/common";
import Phaser from "phaser";
import { afterEach, beforeAll, describe, expect, it } from "vitest";

// Ids from the live game (dump of the live attrs, see the declarations).
const UNSEEN_FIST = 260;
const FINAL_BLOW = 5388;
const SUCTION_CUPS = 21;
const GUARD_DOG = 275;
const HEAVY_METAL = 134;
const LIGHT_METAL = 135;
const LEAD_COAT = 5034;
const GLUTTONY = 82;
const VORACITY = 6101;
const PRESSURE = 46;
const SYNCHRONIZE = 28;
const MOLD_BREAKER = 104;
const MYCELIUM_MIGHT = 298;
const STONECUTTER = 5582;
const DEADLY_PRECISION = 5495;
const BALL_FETCH = AbilityId.BALL_FETCH as number;

type Holder = ReturnType<GameManager["field"]["getPlayerPokemon"]>;
interface Ctx {
  readonly game: GameManager;
  readonly holder: Holder;
  readonly foe: ReturnType<GameManager["field"]["getEnemyPokemon"]>;
}

describe("B07 chunk 1 at the engine sites", () => {
  let phaserGame: Phaser.Game;
  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });
  afterEach(unregisterShadows);

  /** Rebuilds a live ability from its declarations and puts it into the ability list under a shadow id. */
  function shadowOf(abilityId: number, expectedRebuilt: number[]): number {
    const original = allAbilities[abilityId] as Ability;
    const shadowId = allocateShadowId();
    const result = rebuildAbility(original, shadowId, { registry: declRegistry });
    for (const index of expectedRebuilt) {
      expect(result.rebuilt, `${original.name} attr ${index} must be rebuilt`).toContain(index);
    }
    registerShadow(shadowId, result.ability);
    return shadowId;
  }

  /** A one-battle observation: starts a battle whose holder has `abilityId`, then reads something. */
  async function observe<T>(
    abilityId: number,
    setup: { readonly foe?: SpeciesId; readonly foeAbility?: AbilityId },
    read: (ctx: Ctx) => T,
  ): Promise<T> {
    const game = freshGame(phaserGame);
    game.override
      .battleStyle("single")
      .moveset([MoveId.SPLASH])
      .ability(abilityId as AbilityId)
      .startingLevel(100)
      .enemySpecies(setup.foe ?? SpeciesId.MAGIKARP)
      .enemyLevel(30)
      .enemyAbility(setup.foeAbility ?? AbilityId.BALL_FETCH)
      .enemyMoveset(MoveId.SPLASH)
      .criticalHits(false)
      .hasPassiveAbility(false)
      .enemyHasPassiveAbility(false);
    await game.classicMode.startBattle(SpeciesId.BLISSEY);
    return read({ game, holder: game.field.getPlayerPokemon(), foe: game.field.getEnemyPokemon() });
  }

  /** original / rebuilt / control for a direct read. */
  async function threeWays<T>(
    abilityId: number,
    rebuiltIndex: number,
    read: (ctx: Ctx) => T,
    setup: { readonly foe?: SpeciesId; readonly foeAbility?: AbilityId } = {},
  ): Promise<{ original: T; rebuilt: T; control: T }> {
    const shadow = shadowOf(abilityId, [rebuiltIndex]);
    const original = await observe(abilityId, setup, read);
    const rebuilt = await observe(shadow, setup, read);
    const control = await observe(BALL_FETCH, setup, read);
    return { original, rebuilt, control };
  }

  // ---------------------------------------------------------------------------------------------
  // IgnoreProtectOnContactAbAttr (a presence flag): Move.doesFlagEffectApply(IGNORE_PROTECT)
  // ---------------------------------------------------------------------------------------------
  for (const [name, abilityId] of [
    ["Unseen Fist", UNSEEN_FIST],
    ["Final Blow", FINAL_BLOW],
  ] as const) {
    it(`IgnoreProtectOnContactAbAttr: a contact move goes through protection, a non-contact one does not (${name})`, async () => {
      const read = ({ holder, foe }: Ctx) => ({
        contactMove: allMoves[MoveId.TACKLE].doesFlagEffectApply({
          flag: MoveFlags.IGNORE_PROTECT,
          user: holder,
          target: foe,
        }),
        rangedMove: allMoves[MoveId.WATER_GUN].doesFlagEffectApply({
          flag: MoveFlags.IGNORE_PROTECT,
          user: holder,
          target: foe,
        }),
      });
      const result = await threeWays(abilityId, 0, read);
      expect(result.original).toEqual({ contactMove: true, rangedMove: false });
      expect(result.rebuilt).toEqual(result.original);
      expect(result.control).toEqual({ contactMove: false, rangedMove: false });
    });
  }

  // ---------------------------------------------------------------------------------------------
  // ForceSwitchOutImmunityAbAttr (a cancel check): the dispatch of Move.ts and of the switch-out helper
  // ---------------------------------------------------------------------------------------------
  for (const [name, abilityId, attrIndex] of [
    ["Suction Cups", SUCTION_CUPS, 0],
    ["Guard Dog", GUARD_DOG, 1],
  ] as const) {
    it(`ForceSwitchOutImmunityAbAttr: a forced switch is cancelled, and a cancel that already happened stays (${name})`, async () => {
      const read = ({ holder }: Ctx) => {
        const fresh = new BooleanHolder(false);
        applyAbAttrs("ForceSwitchOutImmunityAbAttr", { pokemon: holder, cancelled: fresh });
        const already = new BooleanHolder(true);
        applyAbAttrs("ForceSwitchOutImmunityAbAttr", { pokemon: holder, cancelled: already });
        return {
          fresh: fresh.value,
          already: already.value,
          present: holder.hasAbilityWithAttr("ForceSwitchOutImmunityAbAttr"),
        };
      };
      const result = await threeWays(abilityId, attrIndex, read);
      expect(result.original).toEqual({ fresh: true, already: true, present: true });
      expect(result.rebuilt).toEqual(result.original);
      expect(result.control).toEqual({ fresh: false, already: true, present: false });
    });
  }

  // ---------------------------------------------------------------------------------------------
  // WeightMultiplierAbAttr: Pokemon.getWeight()
  // ---------------------------------------------------------------------------------------------
  for (const [name, abilityId, attrIndex, factor] of [
    ["Heavy Metal", HEAVY_METAL, 0, 2],
    ["Light Metal", LIGHT_METAL, 0, 0.5],
    ["Lead Coat", LEAD_COAT, 2, 3],
  ] as const) {
    it(`WeightMultiplierAbAttr: the weight is multiplied by ${factor} (${name})`, async () => {
      const read = ({ holder }: Ctx) => ({ weight: holder.getWeight(), species: holder.species.weight });
      const result = await threeWays(abilityId, attrIndex, read);
      expect(result.control.weight).toBeCloseTo(result.control.species, 5);
      expect(result.original.weight).toBeCloseTo(result.control.species * factor, 5);
      expect(result.rebuilt.weight).toBeCloseTo(result.original.weight, 9);
    });
  }

  // ---------------------------------------------------------------------------------------------
  // ReduceBerryUseThresholdAbAttr: the berry predicates of berry.ts
  // ---------------------------------------------------------------------------------------------
  for (const [name, abilityId, attrIndex] of [
    ["Gluttony", GLUTTONY, 0],
    ["Voracity", VORACITY, 2],
  ] as const) {
    it(`ReduceBerryUseThresholdAbAttr: a stat berry is eaten at twice the HP, around both thresholds (${name})`, async () => {
      const read = ({ holder }: Ctx) => {
        const max = holder.getMaxHp();
        // Pokemon.getHpRatio() rounds to two decimals, so the cases sit on whole percents: HP is the smallest value whose ratio reads `percent`.
        const eats = (berry: BerryType, percent: number): boolean => {
          holder.hp = Math.max(1, Math.ceil((max * percent) / 100));
          return getBerryPredicate(berry)(holder);
        };
        // Liechi waits for a ratio below 0.25 (below 0.5 with the doubling), strictly.
        return {
          at51: eats(BerryType.LIECHI, 51),
          at50: eats(BerryType.LIECHI, 50),
          at49: eats(BerryType.LIECHI, 49),
          at26: eats(BerryType.LIECHI, 26),
          at25: eats(BerryType.LIECHI, 25),
          at24: eats(BerryType.LIECHI, 24),
          // Starf compares with a literal 0.25 after the hook (suspected game bug, see the declaration notes): no change.
          starfAt49: eats(BerryType.STARF, 49),
        };
      };
      const result = await threeWays(abilityId, attrIndex, read);
      expect(result.original).toEqual({
        at51: false,
        at50: false,
        at49: true,
        at26: true,
        // The boundary quirk: at exactly the normal threshold canApply (`0.25 < 0.25`) fails, so the doubling is skipped.
        at25: false,
        at24: true,
        starfAt49: false,
      });
      expect(result.rebuilt).toEqual(result.original);
      expect(result.control).toEqual({
        at51: false,
        at50: false,
        at49: false,
        at26: false,
        at25: false,
        at24: true,
        starfAt49: false,
      });
    });
  }

  // ---------------------------------------------------------------------------------------------
  // MoveAbilityBypassAbAttr (Tier A, six closures kept as legacy closures): Move.doesFlagEffectApply(IGNORE_ABILITIES)
  // ---------------------------------------------------------------------------------------------
  describe("MoveAbilityBypassAbAttr closures at the engine site", () => {
    const ignores =
      (move: MoveId) =>
      ({ holder, foe }: Ctx) =>
        allMoves[move].doesFlagEffectApply({ flag: MoveFlags.IGNORE_ABILITIES, user: holder, target: foe });

    it("Mold Breaker, `() => true`: every move ignores the target's ability", async () => {
      const read = (ctx: Ctx) => ({ tackle: ignores(MoveId.TACKLE)(ctx), celebrate: ignores(MoveId.CELEBRATE)(ctx) });
      expect(await observe(MOLD_BREAKER, {}, read)).toEqual({ tackle: true, celebrate: true });
      expect(await observe(BALL_FETCH, {}, read)).toEqual({ tackle: false, celebrate: false });
    });

    it("Mycelium Might, `move.category === STATUS`: only status moves ignore the target's ability", async () => {
      const read = (ctx: Ctx) => ({ tackle: ignores(MoveId.TACKLE)(ctx), celebrate: ignores(MoveId.CELEBRATE)(ctx) });
      expect(await observe(MYCELIUM_MIGHT, {}, read)).toEqual({ tackle: false, celebrate: true });
    });

    it("Stonecutter, `getMoveType(move) === ROCK`: only Rock moves ignore the target's ability", async () => {
      const read = (ctx: Ctx) => ({
        rockSlide: ignores(MoveId.ROCK_SLIDE)(ctx),
        tackle: ignores(MoveId.TACKLE)(ctx),
      });
      expect(await observe(STONECUTTER, {}, read)).toEqual({ rockSlide: true, tackle: false });
    });
  });

  // ---------------------------------------------------------------------------------------------
  // SuperEffectiveMoveAbilityBypassAbAttr (Tier B): the gate/guards split must equal the old canApply body
  // ---------------------------------------------------------------------------------------------
  describe("SuperEffectiveMoveAbilityBypassAbAttr gate split", () => {
    /** The class's canApply before the split, copied verbatim (parent check first, then the gate). */
    function oldCanApply(
      attr: AbAttr & { guards(p: unknown): boolean },
      params: { pokemon: Pokemon; move: (typeof allMoves)[number]; cancelled: BooleanHolder; target?: Pokemon },
    ): boolean {
      if (!attr.guards(params)) {
        return false;
      }
      const { pokemon, move, target } = params;
      return target != null && target.getMoveEffectiveness(pokemon, move) > 1;
    }

    it("matches the old body for a super effective, a neutral and a resisted move, no foe, and an earlier cancel", async () => {
      await observe(DEADLY_PRECISION, {}, ({ holder, foe }: Ctx) => {
        const attr = allAbilities[DEADLY_PRECISION].attrs[1] as unknown as AbAttr & {
          canApply(p: unknown): boolean;
          guards(p: unknown): boolean;
          gateOverride: ((p: unknown) => boolean) | undefined;
        };
        expect(attr.constructor.name).toBe("SuperEffectiveMoveAbilityBypassAbAttr");
        const cases: [string, MoveId, boolean, boolean][] = [
          // [label, move, a foe is passed, cancelled already true]
          ["super effective", MoveId.THUNDERBOLT, true, false],
          ["neutral", MoveId.TACKLE, true, false],
          ["resisted", MoveId.WATER_GUN, true, false],
          ["no foe known", MoveId.THUNDERBOLT, false, false],
          ["already cancelled", MoveId.THUNDERBOLT, true, true],
        ];
        const seen: Record<string, boolean> = {};
        for (const [label, moveId, withFoe, cancelledBefore] of cases) {
          const params = {
            pokemon: holder,
            move: allMoves[moveId],
            cancelled: new BooleanHolder(cancelledBefore),
            ...(withFoe ? { target: foe } : {}),
          };
          const now = attr.canApply(params);
          expect(now, label).toBe(oldCanApply(attr, params));
          seen[label] = now;
        }
        // The Magikarp foe is Water: Thunderbolt is the only super effective move, and it needs a foe and a fresh cancel.
        expect(seen).toEqual({
          "super effective": true,
          neutral: false,
          resisted: false,
          "no foe known": false,
          "already cancelled": false,
        });
        // The gate really is replaceable: a gate that always says yes lets the neutral move through, and clearing it restores the rule.
        const neutral = {
          pokemon: holder,
          move: allMoves[MoveId.TACKLE],
          cancelled: new BooleanHolder(false),
          target: foe,
        };
        attr.gateOverride = () => true;
        expect(attr.canApply(neutral)).toBe(true);
        attr.gateOverride = undefined;
        expect(attr.canApply(neutral)).toBe(false);
      });
    });
  });

  // ---------------------------------------------------------------------------------------------
  // IncreasePpAbAttr (Pressure) and SyncEncounterNatureAbAttr (Synchronize): both parked, the original is driven here
  // ---------------------------------------------------------------------------------------------
  it("IncreasePpAbAttr: a foe's move aimed at the Pressure holder costs one extra PP, one aimed elsewhere costs none", async () => {
    // The engine function that counts the extra PP, asked for a foe move that targets the holder and for one that targets nobody.
    const read = ({ holder, foe }: Ctx) => {
      const phase = new MovePhase(foe, [holder.getBattlerIndex()], new PokemonMove(MoveId.TACKLE), MoveUseMode.NORMAL);
      return {
        aimedAtHolder: phase.getPpIncreaseFromPressure([holder]),
        aimedElsewhere: phase.getPpIncreaseFromPressure([foe]),
      };
    };
    expect(await observe(PRESSURE, {}, read)).toEqual({ aimedAtHolder: 1, aimedElsewhere: 0 });
    expect(await observe(BALL_FETCH, {}, read)).toEqual({ aimedAtHolder: 0, aimedElsewhere: 0 });
  });

  it("SyncEncounterNatureAbAttr: a wild Pokemon gets the holder's nature", async () => {
    const read = ({ holder, foe }: Ctx) => {
      holder.setNature(Nature.ADAMANT);
      foe.setNature(Nature.BOLD);
      applyAbAttrs("SyncEncounterNatureAbAttr", { pokemon: holder, target: foe });
      return foe.getNature();
    };
    expect(await observe(SYNCHRONIZE, {}, read)).toBe(Nature.ADAMANT);
    expect(await observe(BALL_FETCH, {}, read)).toBe(Nature.BOLD);
  });
});
