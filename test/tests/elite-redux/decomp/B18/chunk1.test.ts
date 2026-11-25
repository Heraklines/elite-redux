/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// B18 chunk 1 probes: what the shared L1 and L2 suites cannot see.
//  - Quick Draw / Minigun (Tier B, RNG in canApply): the single draw sits BEFORE the "damaging move chosen" test, so it is
//    drawn for a status move too, and never while simulated. A rebuild with the library chance atom must draw the same
//    ranges in the same order and give the same answers.
//  - Readied Action / Demolitionist (Tier B): the gate (first turn AND damaging move) equals the class's own closure, and the
//    power really doubles through the engine's move power calculation.
//  - Mummy / Lingering Aroma / Lingering Musk (Tier B): gate then residual order (the residual's engine lookup is not made
//    when the gate fails), the Mummy-family exception, and the suppression only when not simulated.
//  - The five markers: the live readers (biome map, experience, prize money, balls, substitute cost) see the declared params.
import { allMoves } from "#data/data-lists";
import { buildAttr } from "#data/elite-redux/ability-studio/build-attr";
import { declRegistry } from "#data/elite-redux/ability-studio/decl-registry";
import {
  getBattleMoneyGainMultiplier,
  getBiomeRevealBonus,
  getExperienceGainMultiplier,
  recoverUsedPokeballsAfterBattle,
} from "#data/elite-redux/archetypes/ability-meta-consumers";
import { ProvenanceBypassSpeedChanceAbAttr } from "#data/elite-redux/ability-upgrades/attrs/bypass-speed-provenance";
import { FirstTurnDirectDamageMultiplierAbAttr } from "#data/elite-redux/ability-upgrades/attrs/first-turn-direct-damage";
import {
  hasCommandAbilityProvenance,
  isInnateSlotSuppressed,
} from "#data/elite-redux/ability-upgrades/attrs/innate-slot-suppression";
import { PostDefendSuppressFirstInnateAbAttr } from "#data/elite-redux/ability-upgrades/attrs/mummy-family";
import { BallRecoveryAbAttr, BiomeRevealBonusAbAttr } from "#data/elite-redux/ability-upgrades/attrs/meta-markers";
import { getMoveHpCostFraction, MoveHpCostModifierAbAttr } from "#data/elite-redux/ability-upgrades/attrs/move-hp-cost";
import { AbilityId } from "#enums/ability-id";
import { BattlerTagType } from "#enums/battler-tag-type";
import { HitResult } from "#enums/hit-result";
import { MoveId } from "#enums/move-id";
import { PokeballType } from "#enums/pokeball";
import { SpeciesId } from "#enums/species-id";
import type { Pokemon } from "#field/pokemon";
import { freshGame, startWorld } from "#test/tests/elite-redux/decomp/harness/game";
import { NumberHolder } from "#utils/common";
import type { AbAttrBaseParams, PreAttackModifyPowerAbAttrParams } from "#abilities/ab-attrs";
import type { PostMoveInteractionAbAttrParams } from "#types/ability-types";
import Phaser from "phaser";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

async function startWith(phaserGame: Phaser.Game, ability: AbilityId) {
  const game = freshGame(phaserGame);
  game.override
    .battleStyle("single")
    .moveset([MoveId.SPLASH])
    .ability(ability)
    .startingLevel(100)
    .enemySpecies(SpeciesId.MAGIKARP)
    .enemyLevel(30)
    .enemyAbility(AbilityId.BALL_FETCH)
    .enemyMoveset(MoveId.SPLASH)
    .criticalHits(false);
  await game.classicMode.startBattle(SpeciesId.BLISSEY);
  return { game, holder: game.field.getPlayerPokemon(), foe: game.field.getEnemyPokemon() };
}

describe("B18 chunk 1", () => {
  let phaserGame: Phaser.Game;
  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("ProvenanceBypassSpeedChanceAbAttr (Quick Draw, Minigun)", () => {
    const setChosenMove = (game: Awaited<ReturnType<typeof startWorld>>["game"], holder: Pokemon, move: MoveId) => {
      (game.scene.currentBattle.turnCommands as Record<number, unknown>)[holder.getBattlerIndex()] = {
        command: 0,
        move: { move, targets: [0] },
      };
    };

    it("draws once (range 100) before the move test, never while simulated, and answers like the original", async () => {
      const { game, holder } = await startWorld(phaserGame);
      const module = declRegistry.get("ProvenanceBypassSpeedChanceAbAttr")!;
      expect(module).toBeDefined();
      const original = new ProvenanceBypassSpeedChanceAbAttr(30, "quick-draw:proc");
      const rebuilt = buildAttr(
        module,
        { chance: 30, memoName: "quick-draw:proc" },
        { gate: { block: "rng.chance", params: { pct: 30 } } },
      ) as ProvenanceBypassSpeedChanceAbAttr;
      let roll = 0;
      let log: number[] = [];
      vi.spyOn(game.scene, "randBattleSeedInt").mockImplementation((range: number) => {
        log.push(range);
        return roll;
      });
      const run = (attr: ProvenanceBypassSpeedChanceAbAttr, simulated: boolean): [boolean, number[]] => {
        log = [];
        const result = attr.canApply({ pokemon: holder, simulated } as AbAttrBaseParams);
        return [result, [...log]];
      };
      const cases: { label: string; move: MoveId; roll: number; simulated: boolean; result: boolean; draws: number[] }[] =
        [
          { label: "damaging move, roll 29 (< 30)", move: MoveId.TACKLE, roll: 29, simulated: false, result: true, draws: [100] },
          { label: "damaging move, roll 30 (not < 30)", move: MoveId.TACKLE, roll: 30, simulated: false, result: false, draws: [100] },
          { label: "special move, roll 0", move: MoveId.WATER_GUN, roll: 0, simulated: false, result: true, draws: [100] },
          // The roll comes BEFORE the move test: a status move still consumes the draw, then fails.
          { label: "status move, roll 0", move: MoveId.SWORDS_DANCE, roll: 0, simulated: false, result: false, draws: [100] },
          { label: "damaging move, simulated", move: MoveId.TACKLE, roll: 0, simulated: true, result: false, draws: [] },
        ];
      for (const testCase of cases) {
        setChosenMove(game, holder, testCase.move);
        roll = testCase.roll;
        const [originalResult, originalDraws] = run(original, testCase.simulated);
        const [rebuiltResult, rebuiltDraws] = run(rebuilt, testCase.simulated);
        expect(originalResult, `${testCase.label}: the original's answer`).toBe(testCase.result);
        expect(originalDraws, `${testCase.label}: the original's draws`).toEqual(testCase.draws);
        expect(rebuiltResult, `${testCase.label}: the rebuild's answer`).toBe(originalResult);
        expect(rebuiltDraws, `${testCase.label}: the rebuild's draws`).toEqual(originalDraws);
      }
      // The speed jump cannot be added twice: with the tag already on, the roll is still drawn and the answer is false.
      setChosenMove(game, holder, MoveId.TACKLE);
      roll = 0;
      holder.addTag(BattlerTagType.BYPASS_SPEED);
      const [tagged, taggedDraws] = run(original, false);
      const [taggedRebuilt, taggedRebuiltDraws] = run(rebuilt, false);
      expect([tagged, taggedDraws]).toEqual([false, [100]]);
      expect([taggedRebuilt, taggedRebuiltDraws]).toEqual([tagged, taggedDraws]);
      holder.removeTag(BattlerTagType.BYPASS_SPEED);
    });

    it("applying adds the speed jump and writes the turn memo the other abilities read", async () => {
      const { holder } = await startWorld(phaserGame);
      const module = declRegistry.get("ProvenanceBypassSpeedChanceAbAttr")!;
      const rebuilt = buildAttr(
        module,
        { chance: 30, memoName: "quick-draw:proc" },
        { gate: { block: "rng.chance", params: { pct: 30 } } },
      ) as ProvenanceBypassSpeedChanceAbAttr;
      expect(hasCommandAbilityProvenance(holder, "quick-draw:proc")).toBe(false);
      rebuilt.apply({ pokemon: holder, simulated: false } as AbAttrBaseParams);
      expect(holder.getTag(BattlerTagType.BYPASS_SPEED)).toBeDefined();
      expect(hasCommandAbilityProvenance(holder, "quick-draw:proc")).toBe(true);
    });

    it("a staff-chosen chance moves the compiled gate (gateParams), and a sliders-only change keeps the order of the draw", async () => {
      const { game, holder } = await startWorld(phaserGame);
      const module = declRegistry.get("ProvenanceBypassSpeedChanceAbAttr")!;
      const rebuilt = buildAttr(
        module,
        { chance: 60, memoName: "quick-draw:proc" },
        { gate: { block: "rng.chance", params: { pct: 60 } } },
      ) as ProvenanceBypassSpeedChanceAbAttr;
      setChosenMove(game, holder, MoveId.TACKLE);
      vi.spyOn(game.scene, "randBattleSeedInt").mockImplementation(() => 59);
      expect(rebuilt.canApply({ pokemon: holder, simulated: false } as AbAttrBaseParams)).toBe(true);
      vi.spyOn(game.scene, "randBattleSeedInt").mockImplementation(() => 60);
      expect(rebuilt.canApply({ pokemon: holder, simulated: false } as AbAttrBaseParams)).toBe(false);
    });
  });

  describe("FirstTurnDirectDamageMultiplierAbAttr (Readied Action, Demolitionist)", () => {
    it("the library gate equals the class's own test on turn 1 and turn 2, for damaging and status moves", async () => {
      const { holder, foe } = await startWorld(phaserGame);
      const module = declRegistry.get("FirstTurnDirectDamageMultiplierAbAttr")!;
      const original = new FirstTurnDirectDamageMultiplierAbAttr(2);
      const rebuilt = buildAttr(
        module,
        { multiplier: 2 },
        { gate: { all: [{ block: "time.first-turn" }, { block: "move.damaging" }] } },
      ) as FirstTurnDirectDamageMultiplierAbAttr;
      for (const turn of [1, 2, 5]) {
        holder.tempSummonData.waveTurnCount = turn;
        for (const moveId of [MoveId.TACKLE, MoveId.WATER_GUN, MoveId.SWORDS_DANCE]) {
          const make = (): PreAttackModifyPowerAbAttrParams =>
            ({
              pokemon: holder,
              opponent: foe,
              move: allMoves[moveId],
              power: new NumberHolder(40),
              simulated: false,
            }) as PreAttackModifyPowerAbAttrParams;
          const a = make();
          const b = make();
          const expected = turn === 1 && moveId !== MoveId.SWORDS_DANCE;
          expect(original.canApply(a), `turn ${turn} ${MoveId[moveId]}: the original`).toBe(expected);
          expect(rebuilt.canApply(b), `turn ${turn} ${MoveId[moveId]}: the rebuild`).toBe(expected);
          if (expected) {
            original.apply(a);
            rebuilt.apply(b);
            expect(a.power.value).toBe(80);
            expect(b.power.value).toBe(80);
          }
        }
      }
    });

    it("through the real move power calculation, a Readied Action holder doubles a damaging move on turn 1 only", async () => {
      const { holder, foe } = await startWith(phaserGame, 5278 as AbilityId);
      const move = allMoves[MoveId.TACKLE];
      holder.tempSummonData.waveTurnCount = 2;
      const normal = move.calculateBattlePower(holder, foe, true);
      holder.tempSummonData.waveTurnCount = 1;
      const boosted = move.calculateBattlePower(holder, foe, true);
      expect(boosted).toBe(normal * 2);
    });
  });

  describe("PostDefendSuppressFirstInnateAbAttr (Mummy, Lingering Aroma, Lingering Musk)", () => {
    const hitParams = (holder: Pokemon, foe: Pokemon, move: MoveId, simulated = false): PostMoveInteractionAbAttrParams =>
      ({
        pokemon: holder,
        opponent: foe,
        move: allMoves[move],
        damage: 5,
        hitResult: HitResult.EFFECTIVE,
        simulated,
      }) as PostMoveInteractionAbAttrParams;
    const gate = {
      all: [
        { block: "move.flag", params: { flag: "MAKES_CONTACT" } },
        {
          not: {
            any: [
              { block: "mon.has-ability", params: { who: "other", ability: "MUMMY" } },
              { block: "mon.has-ability", params: { who: "other", ability: "LINGERING_AROMA" } },
              { block: "mon.has-ability", params: { who: "other", ability: "WANDERING_SPIRIT" } },
            ],
          },
        },
      ],
    };

    it("answers like the original for every move, attacker ability and first-innate state, and keeps the residual last", async () => {
      const { holder, foe } = await startWorld(phaserGame);
      const module = declRegistry.get("PostDefendSuppressFirstInnateAbAttr")!;
      const original = new PostDefendSuppressFirstInnateAbAttr();
      const rebuilt = buildAttr(module, {}, { gate }) as PostDefendSuppressFirstInnateAbAttr;
      const abilities = [
        AbilityId.BALL_FETCH,
        AbilityId.MUMMY,
        AbilityId.LINGERING_AROMA,
        AbilityId.WANDERING_SPIRIT,
        6084 as AbilityId,
      ];
      const realSources = foe.getActiveAbilitySources().filter(source => !(source.passive && source.passiveSlot === 0));
      let rows = 0;
      for (const move of [MoveId.TACKLE, MoveId.WATER_GUN]) {
        for (const ability of abilities) {
          for (const hasInnate of [true, false]) {
            vi.restoreAllMocks();
            vi.spyOn(foe, "hasAbility").mockImplementation((id: AbilityId) => id === ability);
            // The engine's own lookups (doesFlagEffectApply asks for contact-ignoring abilities) go through the same
            // method, so the real list stays and only the "active first innate" entry is added or removed.
            const fake = { passive: true, passiveSlot: 0, ability: { attrs: [], getAttrs: () => [] } };
            const sources = vi
              .spyOn(foe, "getActiveAbilitySources")
              .mockImplementation(() => (hasInnate ? [...realSources, fake] : realSources) as never);
            const label = `${MoveId[move]} vs ${AbilityId[ability] ?? ability}, innate ${hasInnate}`;
            const originalResult = original.canApply(hitParams(holder, foe, move));
            const originalLookups = sources.mock.calls.length;
            sources.mockClear();
            const rebuiltResult = rebuilt.canApply(hitParams(holder, foe, move));
            const rebuiltLookups = sources.mock.calls.length;
            expect(rebuiltResult, `${label}: the answer`).toBe(originalResult);
            expect(rebuiltLookups, `${label}: the residual lookup count`).toBe(originalLookups);
            const expectsFire =
              move === MoveId.TACKLE
              && ability !== AbilityId.MUMMY
              && ability !== AbilityId.LINGERING_AROMA
              && ability !== AbilityId.WANDERING_SPIRIT
              && hasInnate;
            expect(originalResult, `${label}: the original`).toBe(expectsFire);
            rows++;
          }
        }
      }
      expect(rows).toBe(20);
    });

    it("suppresses the attacker's first innate only when not simulated", async () => {
      const { holder, foe } = await startWorld(phaserGame);
      const module = declRegistry.get("PostDefendSuppressFirstInnateAbAttr")!;
      const rebuilt = buildAttr(module, {}, { gate }) as PostDefendSuppressFirstInnateAbAttr;
      expect(isInnateSlotSuppressed(foe, 0)).toBe(false);
      rebuilt.apply(hitParams(holder, foe, MoveId.TACKLE, true));
      expect(isInnateSlotSuppressed(foe, 0)).toBe(false);
      rebuilt.apply(hitParams(holder, foe, MoveId.TACKLE, false));
      expect(isInnateSlotSuppressed(foe, 0)).toBe(true);
    });
  });

  describe("the five marker classes and their live readers", () => {
    it("biome reveal: Anticipation counts 1, a staff-built attr adds its count, a fainted holder and a failing condition count 0", async () => {
      const { holder } = await startWith(phaserGame, AbilityId.ANTICIPATION);
      const module = declRegistry.get("BiomeRevealBonusAbAttr")!;
      expect(getBiomeRevealBonus()).toBe(1);
      const built = buildAttr(module, { count: 3 }) as BiomeRevealBonusAbAttr;
      const attrs = holder.getAbility().attrs;
      attrs.push(built);
      try {
        expect(getBiomeRevealBonus()).toBe(4);
        built.addCondition(() => false);
        expect(getBiomeRevealBonus()).toBe(1);
      } finally {
        attrs.pop();
      }
      const hp = holder.hp;
      holder.hp = 0;
      try {
        expect(getBiomeRevealBonus()).toBe(0);
      } finally {
        holder.hp = hp;
      }
    });

    it("experience: Super Luck gives x1.2, a staff-built x2 multiplies on top, and a plain Pokemon gets x1", async () => {
      const { holder } = await startWith(phaserGame, AbilityId.SUPER_LUCK);
      const module = declRegistry.get("ExperienceGainMultiplierAbAttr")!;
      expect(getExperienceGainMultiplier(holder)).toBeCloseTo(1.2, 10);
      const built = buildAttr(module, { multiplier: 2 });
      const attrs = holder.getAbility().attrs;
      attrs.push(built);
      try {
        expect(getExperienceGainMultiplier(holder)).toBeCloseTo(2.4, 10);
      } finally {
        attrs.pop();
      }
    });

    it("prize money: Good as Gold gives x1.2 while on the field and x1 when fainted", async () => {
      const { holder } = await startWith(phaserGame, AbilityId.GOOD_AS_GOLD);
      expect(getBattleMoneyGainMultiplier()).toBeCloseTo(1.2, 10);
      const module = declRegistry.get("MoneyGainMultiplierAbAttr")!;
      const built = buildAttr(module, { multiplier: 1.5 });
      const attrs = holder.getAbility().attrs;
      attrs.push(built);
      try {
        expect(getBattleMoneyGainMultiplier()).toBeCloseTo(1.8, 10);
      } finally {
        attrs.pop();
      }
      const hp = holder.hp;
      holder.hp = 0;
      try {
        expect(getBattleMoneyGainMultiplier()).toBe(1);
      } finally {
        holder.hp = hp;
      }
    });

    it("balls: Ball Fetch returns used Poke Balls and Great Balls once, and not an Ultra Ball; the list round-trips", async () => {
      const { game, holder } = await startWith(phaserGame, AbilityId.BALL_FETCH);
      const module = declRegistry.get("BallRecoveryAbAttr")!;
      const live = holder.getAbility().attrs.find(attr => attr instanceof BallRecoveryAbAttr) as BallRecoveryAbAttr;
      expect(live).toBeDefined();
      const balls = module.decl.params[0];
      expect(balls.codec!.fromInstance(live.getRecoverableBalls())).toBe("POKEBALL,GREAT_BALL");
      const rebuilt = buildAttr(module, { balls: "POKEBALL,GREAT_BALL" }) as BallRecoveryAbAttr;
      expect(rebuilt.getRecoverableBalls()).toEqual(live.getRecoverableBalls());
      expect(() => buildAttr(module, { balls: "" })).toThrow();
      const battle = game.scene.currentBattle;
      const before = { ...game.scene.pokeballCounts };
      battle.recordUsedPokeball(PokeballType.POKEBALL);
      battle.recordUsedPokeball(PokeballType.POKEBALL);
      battle.recordUsedPokeball(PokeballType.GREAT_BALL);
      battle.recordUsedPokeball(PokeballType.ULTRA_BALL);
      recoverUsedPokeballsAfterBattle();
      expect(game.scene.pokeballCounts[PokeballType.POKEBALL]).toBe(before[PokeballType.POKEBALL] + 2);
      expect(game.scene.pokeballCounts[PokeballType.GREAT_BALL]).toBe(before[PokeballType.GREAT_BALL] + 1);
      expect(game.scene.pokeballCounts[PokeballType.ULTRA_BALL]).toBe(before[PokeballType.ULTRA_BALL]);
      // The ledger was consumed: a second call returns nothing more.
      recoverUsedPokeballsAfterBattle();
      expect(game.scene.pokeballCounts[PokeballType.POKEBALL]).toBe(before[PokeballType.POKEBALL] + 2);
    });

    it("substitute cost: Shed Skin makes Shed Tail cost 1/3, leaves Substitute alone, and the last matching marker wins", async () => {
      const { holder } = await startWith(phaserGame, AbilityId.SHED_SKIN);
      const module = declRegistry.get("MoveHpCostModifierAbAttr")!;
      const shedTail = allMoves[MoveId.SHED_TAIL];
      const substitute = allMoves[MoveId.SUBSTITUTE];
      expect(getMoveHpCostFraction(holder, shedTail, 0.5)).toBeCloseTo(1 / 3, 12);
      expect(getMoveHpCostFraction(holder, substitute, 0.25)).toBe(0.25);
      const live = holder.getAbility().attrs.find(attr => attr instanceof MoveHpCostModifierAbAttr)!;
      const [moves, fraction] = module.decl.params;
      expect(moves.codec!.fromInstance((live as unknown as { moveIds: unknown }).moveIds)).toBe("SHED_TAIL");
      expect(fraction.default).toBeCloseTo(1 / 3, 12);
      const built = buildAttr(module, { moves: "SUBSTITUTE,SHED_TAIL", fraction: 0.2 });
      const attrs = holder.getAbility().attrs;
      attrs.push(built);
      try {
        expect(getMoveHpCostFraction(holder, shedTail, 0.5)).toBe(0.2);
        expect(getMoveHpCostFraction(holder, substitute, 0.25)).toBe(0.2);
      } finally {
        attrs.pop();
      }
    });
  });
});
