/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// B14 chunk 6: what the shared L1 and L2 suites cannot see.
//  - Positive Feedback (power and consume halves) and Negative Feedback read the FOE's status, which no shared scenario can set. Each
//    canApply is compared with a literal copy of the ORIGINAL expression over every clause state (move category, hit result, foe
//    status, no foe); the rebuilt attr (from the declaration and its bindings) is compared the same way; apply is driven directly
//    and in real battles with a paralyzed foe.
//  - Capacitor Bank's gain half is a Tier B split with a residual (damage, blocked hit, stack maximum, per-move memory): compared with
//    a literal copy of the original over every combination. The absorb half is driven in a real battle (an Electric move).
//  - Fault Current is a package whose clauses sit in apply: the counter, the release, the spend and the damage are driven directly.
//  - Overloaded's power gate is a LEGACY binding: the original expression is compared with the tree planned for the library
//    (written in OverloadedPowerAbAttr.decl.ts and requests/B14.md) over every state of its clauses.
//  - Closed Circuit is a marker read by the engine: the pair rule is driven in a real double battle.
import { TypeImmunityAbAttr } from "#abilities/ab-attrs";
import { allMoves } from "#data/data-lists";
import {
  addCharge,
  CHARGE_STACK_MAX,
  clearCharge,
  erFaultCurrentOnLeaveField,
  getActiveTurns,
  getCharge,
  setCharge,
} from "#data/elite-redux/abilities/charge-stack";
import { getDualTypePrime } from "#data/elite-redux/abilities/dual-type-move";
import {
  CapacitorBankAbsorbAbAttr,
  CapacitorBankGainAbAttr,
  ER_CAPACITOR_BANK_ABILITY_ID,
  ER_FAULT_CURRENT_ABILITY_ID,
  ER_OVERLOADED_ABILITY_ID,
  FaultCurrentAbAttr,
  OverloadedPowerAbAttr,
} from "#data/elite-redux/abilities/electivire";
import {
  erHeldItemSuppressionState,
  erIsHeldItemSuppressed,
  resetItemSuppression,
} from "#data/elite-redux/abilities/item-suppression";
import {
  ClosedCircuitAbAttr,
  ER_CLOSED_CIRCUIT_ABILITY_ID,
  ER_NEGATIVE_FEEDBACK_ABILITY_ID,
  ER_POSITIVE_FEEDBACK_ABILITY_ID,
  NegativeFeedbackAbAttr,
  PositiveFeedbackAbAttr,
  PositiveFeedbackPowerAbAttr,
} from "#data/elite-redux/abilities/plusle-minun";
import { resetTurnAttackLedger } from "#data/elite-redux/abilities/turn-attack-ledger";
import { recomposeAttr } from "#data/elite-redux/ability-studio/build-attr";
import { declRegistry } from "#data/elite-redux/ability-studio/decl-registry";
import { AbilityId } from "#enums/ability-id";
import { HitResult } from "#enums/hit-result";
import { MoveCategory } from "#enums/move-category";
import { MoveId } from "#enums/move-id";
import { PokemonType } from "#enums/pokemon-type";
import { SpeciesId } from "#enums/species-id";
import { Stat } from "#enums/stat";
import { StatusEffect } from "#enums/status-effect";
import type { Pokemon } from "#field/pokemon";
import { GameManager } from "#test/framework/game-manager";
import { liveAbility } from "#test/tests/elite-redux/decomp/harness/twin";
import { setStatusOf } from "#test/tests/elite-redux/decomp/harness/world";
import { NumberHolder } from "#utils/common";
import Phaser from "phaser";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

const POSITIVE = ER_POSITIVE_FEEDBACK_ABILITY_ID;
const NEGATIVE = ER_NEGATIVE_FEEDBACK_ABILITY_ID;
const CLOSED_CIRCUIT = ER_CLOSED_CIRCUIT_ABILITY_ID;
const CAPACITOR = ER_CAPACITOR_BANK_ABILITY_ID;
const FAULT = ER_FAULT_CURRENT_ABILITY_ID;
const OVERLOADED = ER_OVERLOADED_ABILITY_ID;

const FOE_STATUSES = [
  StatusEffect.NONE,
  StatusEffect.PARALYSIS,
  StatusEffect.BURN,
  StatusEffect.SLEEP,
  StatusEffect.POISON,
] as const;
const ALL_HIT_RESULTS = Object.values(HitResult).filter((value): value is HitResult => typeof value === "number");

function newGame(
  phaserGame: Phaser.Game,
  options: { ability: number; double?: boolean; enemy?: SpeciesId; enemyMoves?: MoveId[]; moves?: MoveId[] },
) {
  const game = new GameManager(phaserGame);
  game.override
    .battleStyle(options.double === true ? "double" : "single")
    .moveset(options.moves ?? [MoveId.CELEBRATE, MoveId.TACKLE])
    .ability(options.ability as AbilityId)
    .startingLevel(100)
    .enemySpecies(options.enemy ?? SpeciesId.SNORLAX)
    .enemyLevel(options.enemy === undefined ? 100 : 50)
    .enemyAbility(AbilityId.BALL_FETCH)
    .enemyMoveset(options.enemyMoves ?? [MoveId.SPLASH])
    .criticalHits(false)
    .hasPassiveAbility(false)
    .enemyHasPassiveAbility(false);
  if (options.double === true) {
    // A double battle needs a wave the game allows it on (the wave 1 override stays single).
    game.override.startingWave(5);
  }
  return game;
}

describe("B14 chunk 6: the six classes keep their names, places and defaults", () => {
  let phaserGame: Phaser.Game;
  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });

  it("every class is at the same attr index of the same ability, with the old behaviour as defaults", () => {
    expect(liveAbility(POSITIVE).attrs.map(attr => attr.constructor.name)).toEqual([
      "PositiveFeedbackPowerAbAttr",
      "PositiveFeedbackAbAttr",
    ]);
    expect(liveAbility(NEGATIVE).attrs.map(attr => attr.constructor.name)).toEqual(["NegativeFeedbackAbAttr"]);
    expect(liveAbility(CLOSED_CIRCUIT).attrs.map(attr => attr.constructor.name)).toEqual(["ClosedCircuitAbAttr"]);
    expect(liveAbility(CAPACITOR).attrs.map(attr => attr.constructor.name)).toEqual([
      "CapacitorBankGainAbAttr",
      "CapacitorBankAbsorbAbAttr",
      "RedirectTypeMoveAbAttr",
    ]);
    expect(liveAbility(FAULT).attrs.map(attr => attr.constructor.name)).toEqual(["FaultCurrentAbAttr"]);
    expect(liveAbility(OVERLOADED).attrs.map(attr => attr.constructor.name)).toEqual([
      "OverloadedPowerAbAttr",
      "OverloadedPriorityAbAttr",
      "OverloadedChipAbAttr",
    ]);
    const power = liveAbility(POSITIVE).attrs[0] as PositiveFeedbackPowerAbAttr;
    const consume = liveAbility(POSITIVE).attrs[1] as PositiveFeedbackAbAttr;
    const negative = liveAbility(NEGATIVE).attrs[0] as NegativeFeedbackAbAttr;
    const gain = liveAbility(CAPACITOR).attrs[0] as CapacitorBankGainAbAttr;
    const absorb = liveAbility(CAPACITOR).attrs[1] as CapacitorBankAbsorbAbAttr;
    const fault = liveAbility(FAULT).attrs[0] as FaultCurrentAbAttr;
    const overloaded = liveAbility(OVERLOADED).attrs[0] as OverloadedPowerAbAttr;
    expect([power.powerMultiplier, consume.stageDrop]).toEqual([1.25, 1]);
    expect([negative.speedStages, negative.primaryType, negative.secondType]).toEqual([
      1,
      PokemonType.ELECTRIC,
      PokemonType.FAIRY,
    ]);
    expect([negative.suppressTurns, negative.physicalOnly]).toEqual([1, true]);
    expect([gain.stacks, absorb.stacks, absorb.getImmuneType()]).toEqual([1, 1, PokemonType.ELECTRIC]);
    expect([fault.period, fault.powerPerStack, fault.moveId]).toEqual([2, 15, MoveId.DISCHARGE]);
    expect(overloaded.powerMultiplier).toBe(1.25);
    // The marker is untouched and keeps showing no ability flyout.
    expect(liveAbility(CLOSED_CIRCUIT).attrs[0]).toBeInstanceOf(ClosedCircuitAbAttr);
    // Eight declarations are registered (the marker's was parked until R-B14-6.11; the merge captain added its flag key).
    for (const name of [
      "PositiveFeedbackPowerAbAttr",
      "PositiveFeedbackAbAttr",
      "NegativeFeedbackAbAttr",
      "CapacitorBankGainAbAttr",
      "CapacitorBankAbsorbAbAttr",
      "FaultCurrentAbAttr",
      "OverloadedPowerAbAttr",
      "ClosedCircuitAbAttr",
    ]) {
      expect(declRegistry.get(name), name).toBeDefined();
    }
    expect(phaserGame).toBeDefined();
  });
});

describe("B14 chunk 6: Positive Feedback, the power half", () => {
  let phaserGame: Phaser.Game;
  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("canApply equals the original expression for every foe status and for no foe; the rebuilt attr agrees", async () => {
    const game = newGame(phaserGame, { ability: POSITIVE });
    await game.classicMode.startBattle(SpeciesId.PLUSLE);
    const holder = game.field.getPlayerPokemon();
    const foe = game.field.getEnemyPokemon();
    const attr = liveAbility(POSITIVE).attrs[0] as PositiveFeedbackPowerAbAttr;
    const rebuilt = recomposeAttr(declRegistry.get("PositiveFeedbackPowerAbAttr")!, attr, POSITIVE, 0);
    expect(rebuilt.constructor.name).toBe("PositiveFeedbackPowerAbAttr");
    // Copied from the code before the split.
    const original = (opponent: Pokemon | null): boolean => opponent?.status?.effect === StatusEffect.PARALYSIS;
    let accepted = 0;
    for (const status of FOE_STATUSES) {
      setStatusOf(foe, status);
      for (const opponent of [foe, null]) {
        const params = { pokemon: holder, opponent, move: allMoves[MoveId.TACKLE], power: new NumberHolder(100) };
        const expected = original(opponent);
        expect(attr.canApply(params as never), `status ${StatusEffect[status]} foe ${opponent !== null}`).toBe(
          expected,
        );
        expect(rebuilt.canApply(params as never)).toBe(expected);
        accepted += expected ? 1 : 0;
      }
    }
    expect(accepted).toBe(1);
  });

  it("apply multiplies by 1.25 (or the setting) and a replaced gate replaces the whole condition", async () => {
    const game = newGame(phaserGame, { ability: POSITIVE });
    await game.classicMode.startBattle(SpeciesId.PLUSLE);
    const holder = game.field.getPlayerPokemon();
    const foe = game.field.getEnemyPokemon();
    const attr = liveAbility(POSITIVE).attrs[0] as PositiveFeedbackPowerAbAttr;
    const power = new NumberHolder(100);
    attr.apply({ pokemon: holder, opponent: foe, move: allMoves[MoveId.TACKLE], power } as never);
    expect(power.value).toBe(125);
    const custom = new PositiveFeedbackPowerAbAttr(1.5);
    const stronger = new NumberHolder(100);
    custom.apply({ pokemon: holder, opponent: foe, move: allMoves[MoveId.TACKLE], power: stronger } as never);
    expect(stronger.value).toBe(150);
    setStatusOf(foe, StatusEffect.NONE);
    const frame = { pokemon: holder, opponent: foe, move: allMoves[MoveId.TACKLE], power } as never;
    expect(custom.canApply(frame)).toBe(false);
    custom.gateOverride = () => true;
    expect(custom.canApply(frame)).toBe(true);
  });
});

describe("B14 chunk 6: Positive Feedback and Negative Feedback, the consume halves", () => {
  let phaserGame: Phaser.Game;
  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });
  afterEach(() => {
    vi.restoreAllMocks();
    resetItemSuppression();
  });

  for (const [name, abilityId, attrIndex] of [
    ["PositiveFeedbackAbAttr", POSITIVE, 1],
    ["NegativeFeedbackAbAttr", NEGATIVE, 0],
  ] as const) {
    it(`${name}: canApply equals the original expression over every clause, and the rebuilt attr agrees`, async () => {
      const game = newGame(phaserGame, { ability: abilityId });
      await game.classicMode.startBattle(SpeciesId.PLUSLE);
      const holder = game.field.getPlayerPokemon();
      const foe = game.field.getEnemyPokemon();
      const attr = liveAbility(abilityId).attrs[attrIndex] as PositiveFeedbackAbAttr | NegativeFeedbackAbAttr;
      const rebuilt = recomposeAttr(declRegistry.get(name)!, attr, abilityId, attrIndex);
      expect(rebuilt.constructor.name).toBe(name);
      // Copied from the code before the split: `super.canApply(params) && hitResult < 4 && paralyzed`, where the parent's check is
      // its constructor closure, by default `move.category !== STATUS`.
      const original = (move: (typeof allMoves)[MoveId], hitResult: HitResult, opponent: Pokemon | undefined) =>
        move.category !== MoveCategory.STATUS && hitResult < 4 && opponent?.status?.effect === StatusEffect.PARALYSIS;
      let accepted = 0;
      let compared = 0;
      for (const status of FOE_STATUSES) {
        setStatusOf(foe, status);
        for (const opponent of [foe, undefined]) {
          for (const moveId of [MoveId.TACKLE, MoveId.WATER_GUN, MoveId.CELEBRATE]) {
            for (const hitResult of ALL_HIT_RESULTS) {
              const move = allMoves[moveId];
              const params = { pokemon: holder, opponent, move, hitResult, damage: 10, simulated: false };
              const expected = original(move, hitResult, opponent);
              expect(
                attr.canApply(params as never),
                `${MoveId[moveId]} ${HitResult[hitResult]} ${StatusEffect[status]} foe ${opponent !== undefined}`,
              ).toBe(expected);
              expect(rebuilt.canApply(params as never)).toBe(expected);
              compared++;
              accepted += expected ? 1 : 0;
            }
          }
        }
      }
      expect(compared).toBe(5 * 2 * 3 * ALL_HIT_RESULTS.length);
      // A paralyzed foe, two damaging moves, the four hit results below ONE_HIT_KO's number 4: EFFECTIVE, SUPER_EFFECTIVE,
      // NOT_VERY_EFFECTIVE (1 to 3). ONE_HIT_KO (4) is excluded by `< 4`, which is the suspected game bug of the notes.
      expect(accepted).toBe(2 * 3);
    });
  }

  it("a replaced parent condition is honoured by the guard, and a replaced gate replaces only the paralysis test", async () => {
    const game = newGame(phaserGame, { ability: POSITIVE });
    await game.classicMode.startBattle(SpeciesId.PLUSLE);
    const holder = game.field.getPlayerPokemon();
    const foe = game.field.getEnemyPokemon();
    setStatusOf(foe, StatusEffect.PARALYSIS);
    // Any move at all (status moves too) when the constructor closure is `() => true`.
    const open = new PositiveFeedbackAbAttr(() => true);
    const params = { pokemon: holder, opponent: foe, move: allMoves[MoveId.CELEBRATE], hitResult: HitResult.EFFECTIVE };
    expect(open.canApply(params as never)).toBe(true);
    // The hit-result guard still applies.
    expect(open.canApply({ ...params, hitResult: HitResult.NO_EFFECT } as never)).toBe(false);
    // The gate no longer needs paralysis once replaced.
    setStatusOf(foe, StatusEffect.NONE);
    expect(open.canApply(params as never)).toBe(false);
    open.gateOverride = () => true;
    expect(open.canApply(params as never)).toBe(true);
  });

  it("Positive Feedback apply cures the foe, lowers the higher defense (a tie goes to Defense) and honours the setting", async () => {
    const game = newGame(phaserGame, { ability: POSITIVE });
    await game.classicMode.startBattle(SpeciesId.PLUSLE);
    const holder = game.field.getPlayerPokemon();
    const foe = game.field.getEnemyPokemon();
    const attr = liveAbility(POSITIVE).attrs[1] as PositiveFeedbackAbAttr;
    const queued = vi.spyOn(game.scene.phaseManager, "unshiftNew").mockImplementation((() => undefined) as never);
    const params = { pokemon: holder, opponent: foe, move: allMoves[MoveId.TACKLE], hitResult: HitResult.EFFECTIVE };
    const fakeStats = (def: number, spdef: number) =>
      vi.spyOn(foe, "getStat").mockImplementation(((stat: Stat) => (stat === Stat.DEF ? def : spdef)) as never);
    // A preview does nothing at all.
    setStatusOf(foe, StatusEffect.PARALYSIS);
    attr.apply({ ...params, simulated: true } as never);
    expect(foe.status?.effect).toBe(StatusEffect.PARALYSIS);
    expect(queued).not.toHaveBeenCalled();
    // Special side higher: Sp. Def drops by one stage on the foe (not a self target).
    fakeStats(100, 150);
    attr.apply({ ...params, simulated: false } as never);
    expect(foe.status).toBeNull();
    expect(queued).toHaveBeenLastCalledWith("StatStageChangePhase", foe.getBattlerIndex(), false, [Stat.SPDEF], -1);
    // Physical side higher.
    setStatusOf(foe, StatusEffect.PARALYSIS);
    fakeStats(150, 100);
    attr.apply({ ...params, simulated: false } as never);
    expect(queued).toHaveBeenLastCalledWith("StatStageChangePhase", foe.getBattlerIndex(), false, [Stat.DEF], -1);
    // A tie goes to Defense.
    fakeStats(120, 120);
    attr.apply({ ...params, simulated: false } as never);
    expect(queued).toHaveBeenLastCalledWith("StatStageChangePhase", foe.getBattlerIndex(), false, [Stat.DEF], -1);
    // The editable number of stages.
    new PositiveFeedbackAbAttr(undefined, true, 3).apply({ ...params, simulated: false } as never);
    expect(queued).toHaveBeenLastCalledWith("StatStageChangePhase", foe.getBattlerIndex(), false, [Stat.DEF], -3);
  });

  it("Negative Feedback apply: cure, my Speed, a seeded item pick between the two, then the dual-type mark", async () => {
    const game = newGame(phaserGame, { ability: NEGATIVE });
    await game.classicMode.startBattle(SpeciesId.PLUSLE);
    const holder = game.field.getPlayerPokemon();
    const foe = game.field.getEnemyPokemon();
    const attr = liveAbility(NEGATIVE).attrs[0] as NegativeFeedbackAbAttr;
    const order: string[] = [];
    const queued = vi.spyOn(game.scene.phaseManager, "unshiftNew").mockImplementation(((...args: unknown[]) => {
      order.push(`phase:${String(args[0])}`);
    }) as never);
    const draws = vi.spyOn(game.scene, "randBattleSeedInt").mockImplementation(((range: number) => {
      order.push(`draw:${range}`);
      return range - 1;
    }) as never);
    vi.spyOn(foe, "getHeldItems").mockImplementation((() => [
      { type: { id: "ITEM_A" } },
      { type: { id: "ITEM_B" } },
    ]) as never);
    const params = { pokemon: holder, opponent: foe, move: allMoves[MoveId.TACKLE], hitResult: HitResult.EFFECTIVE };
    // A preview does nothing.
    setStatusOf(foe, StatusEffect.PARALYSIS);
    attr.apply({ ...params, simulated: true } as never);
    expect(order).toEqual([]);
    expect(getDualTypePrime(holder)).toBeUndefined();
    // The real call, in the original order.
    attr.apply({ ...params, simulated: false } as never);
    expect(foe.status).toBeNull();
    expect(queued).toHaveBeenCalledWith("StatStageChangePhase", holder.getBattlerIndex(), true, [Stat.SPD], 1);
    expect(order).toEqual(["phase:StatStageChangePhase", "draw:2"]);
    expect(draws).toHaveBeenCalledTimes(1);
    expect(erIsHeldItemSuppressed(foe, "ITEM_B")).toBe(true);
    expect(erIsHeldItemSuppressed(foe, "ITEM_A")).toBe(false);
    expect(getDualTypePrime(holder)).toMatchObject({
      primaryType: PokemonType.ELECTRIC,
      secondType: PokemonType.FAIRY,
    });
    // A different setting (editable params) is honoured; with one item there is no draw.
    resetItemSuppression();
    order.length = 0;
    vi.spyOn(foe, "getHeldItems").mockImplementation((() => [{ type: { id: "ONLY" } }]) as never);
    setStatusOf(foe, StatusEffect.PARALYSIS);
    new NegativeFeedbackAbAttr(undefined, true, 2, PokemonType.FIRE, PokemonType.WATER).apply({
      ...params,
      simulated: false,
    } as never);
    expect(queued).toHaveBeenLastCalledWith("StatStageChangePhase", holder.getBattlerIndex(), true, [Stat.SPD], 2);
    expect(order).toEqual(["phase:StatStageChangePhase"]);
    expect(erIsHeldItemSuppressed(foe, "ONLY")).toBe(true);
    expect(getDualTypePrime(holder)).toMatchObject({ primaryType: PokemonType.FIRE, secondType: PokemonType.WATER });
    // Defaults pinned: the lock lasts to the end of the following turn and the prime is physical-only.
    expect(erHeldItemSuppressionState(foe, "ONLY")?.turnsLeft).toBe(2);
    expect(getDualTypePrime(holder)).toMatchObject({ physicalOnly: true });
    // The two new settings: a longer item lock and a prime that also covers special moves.
    resetItemSuppression();
    new NegativeFeedbackAbAttr(undefined, true, 1, PokemonType.FIRE, PokemonType.WATER, 3, false).apply({
      ...params,
      simulated: false,
    } as never);
    expect(erHeldItemSuppressionState(foe, "ONLY")?.turnsLeft).toBe(4);
    expect(getDualTypePrime(holder)).toMatchObject({ physicalOnly: false });
  });

  it("in a real battle Negative Feedback consumes a paralysis it just met", async () => {
    const game = newGame(phaserGame, { ability: NEGATIVE, moves: [MoveId.TACKLE, MoveId.CELEBRATE] });
    await game.classicMode.startBattle(SpeciesId.PLUSLE);
    const holder = game.field.getPlayerPokemon();
    const foe = game.field.getEnemyPokemon();
    setStatusOf(foe, StatusEffect.PARALYSIS);
    game.move.select(MoveId.TACKLE);
    await game.phaseInterceptor.to("BerryPhase", false);
    expect(foe.status).toBeNull();
    expect(holder.getStatStage(Stat.SPD)).toBe(1);
    expect(getDualTypePrime(holder)).toBeDefined();
  });

  it("in a real battle Positive Feedback consumes the paralysis and lowers the foe's higher defense", async () => {
    const game = newGame(phaserGame, { ability: POSITIVE, moves: [MoveId.TACKLE, MoveId.CELEBRATE] });
    await game.classicMode.startBattle(SpeciesId.PLUSLE);
    const foe = game.field.getEnemyPokemon();
    setStatusOf(foe, StatusEffect.PARALYSIS);
    const higher = foe.getStat(Stat.DEF) >= foe.getStat(Stat.SPDEF) ? Stat.DEF : Stat.SPDEF;
    const lower = higher === Stat.DEF ? Stat.SPDEF : Stat.DEF;
    game.move.select(MoveId.TACKLE);
    await game.phaseInterceptor.to("BerryPhase", false);
    expect(foe.status).toBeNull();
    expect(foe.getStatStage(higher)).toBe(-1);
    expect(foe.getStatStage(lower)).toBe(0);
  });
});

describe("B14 chunk 6: Capacitor Bank", () => {
  let phaserGame: Phaser.Game;
  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("the gain half: canApply equals the original expression over every combination of its five clauses", async () => {
    const game = newGame(phaserGame, { ability: CAPACITOR });
    await game.classicMode.startBattle(SpeciesId.ELECTIVIRE);
    const holder = game.field.getPlayerPokemon();
    const foe = game.field.getEnemyPokemon();
    const attr = liveAbility(CAPACITOR).attrs[0] as CapacitorBankGainAbAttr;
    const rebuilt = recomposeAttr(declRegistry.get("CapacitorBankGainAbAttr")!, attr, CAPACITOR, 0);
    expect(rebuilt.constructor.name).toBe("CapacitorBankGainAbAttr");
    // Copied from the code before the split, with the memory test given as a boolean.
    const original = (
      move: (typeof allMoves)[MoveId],
      damage: number,
      hitResult: HitResult,
      charge: number,
      sameMoveAgain: boolean,
    ): boolean => {
      if (move.category === MoveCategory.STATUS || damage <= 0) {
        return false;
      }
      if (hitResult === HitResult.NO_EFFECT || hitResult === HitResult.IMMUNE) {
        return false;
      }
      if (charge >= CHARGE_STACK_MAX) {
        return false;
      }
      return !sameMoveAgain;
    };
    // Remember one counted move (Tackle from the foe) with a throwaway copy, so the real attr's memory is the shared module one.
    const remember = new CapacitorBankGainAbAttr();
    clearCharge(holder);
    remember.apply({ pokemon: holder, opponent: foe, move: allMoves[MoveId.TACKLE], simulated: false } as never);
    let accepted = 0;
    let compared = 0;
    for (const moveId of [MoveId.TACKLE, MoveId.SCRATCH, MoveId.CELEBRATE]) {
      const move = allMoves[moveId];
      for (const damage of [0, 7]) {
        for (const hitResult of ALL_HIT_RESULTS) {
          for (const charge of [0, 3, 4]) {
            setCharge(holder, charge);
            const sameMoveAgain = moveId === MoveId.TACKLE;
            const params = { pokemon: holder, opponent: foe, move, damage, hitResult, simulated: false };
            const expected = original(move, damage, hitResult, charge, sameMoveAgain);
            expect(
              attr.canApply(params as never),
              `${MoveId[moveId]} damage ${damage} ${HitResult[hitResult]} charge ${charge}`,
            ).toBe(expected);
            expect(rebuilt.canApply(params as never)).toBe(expected);
            compared++;
            accepted += expected ? 1 : 0;
          }
        }
      }
    }
    expect(compared).toBe(3 * 2 * ALL_HIT_RESULTS.length * 3);
    // Only Scratch (a different move than the counted Tackle) with damage, a hit that is not blocked (11 of 12 results) and 0 or 3 stacks.
    expect(accepted).toBe(1 * 1 * (ALL_HIT_RESULTS.length - 2) * 2);
  });

  it("the gain half: apply counts a multi-hit move once, skips previews, clamps at the maximum and honours the setting", async () => {
    const game = newGame(phaserGame, { ability: CAPACITOR });
    await game.classicMode.startBattle(SpeciesId.ELECTIVIRE);
    const holder = game.field.getPlayerPokemon();
    const foe = game.field.getEnemyPokemon();
    const attr = liveAbility(CAPACITOR).attrs[0] as CapacitorBankGainAbAttr;
    clearCharge(holder);
    const hit = {
      pokemon: holder,
      opponent: foe,
      move: allMoves[MoveId.DOUBLE_SLAP],
      damage: 6,
      hitResult: HitResult.EFFECTIVE,
    };
    attr.apply({ ...hit, simulated: true } as never);
    expect(getCharge(holder)).toBe(0);
    expect(attr.canApply({ ...hit, simulated: false } as never)).toBe(true);
    attr.apply({ ...hit, simulated: false } as never);
    expect(getCharge(holder)).toBe(1);
    // The second hit of the same move is not counted again.
    expect(attr.canApply({ ...hit, simulated: false } as never)).toBe(false);
    // A bigger setting adds more, and the store clamps at the maximum.
    const custom = new CapacitorBankGainAbAttr(3);
    custom.apply({ ...hit, move: allMoves[MoveId.TACKLE], simulated: false } as never);
    expect(getCharge(holder)).toBe(CHARGE_STACK_MAX);
    // A replaced gate replaces only the 'deals damage' test: the residual still stops a hit with no damage.
    custom.gateOverride = () => true;
    expect(custom.canApply({ ...hit, move: allMoves[MoveId.CELEBRATE], damage: 0, simulated: false } as never)).toBe(
      false,
    );
  });

  it("the absorb half: an Electric move is blocked and adds a stack; a preview, the maximum and other types add nothing", async () => {
    const game = newGame(phaserGame, { ability: CAPACITOR });
    await game.classicMode.startBattle(SpeciesId.ELECTIVIRE);
    const holder = game.field.getPlayerPokemon();
    const foe = game.field.getEnemyPokemon();
    const attr = liveAbility(CAPACITOR).attrs[1] as CapacitorBankAbsorbAbAttr;
    // canApply is the parent's, untouched.
    expect(attr.canApply).toBe(TypeImmunityAbAttr.prototype.canApply);
    const frame = (move: MoveId, simulated: boolean) => ({
      pokemon: holder,
      opponent: foe,
      move: allMoves[move],
      simulated,
      typeMultiplier: new NumberHolder(1),
      cancelled: { value: false },
    });
    clearCharge(holder);
    const electric = frame(MoveId.THUNDER_SHOCK, false);
    expect(attr.canApply(electric as never)).toBe(true);
    attr.apply(electric as never);
    expect(electric.typeMultiplier.value).toBe(0);
    expect(getCharge(holder)).toBe(1);
    const preview = frame(MoveId.THUNDER_SHOCK, true);
    attr.apply(preview as never);
    expect(preview.typeMultiplier.value).toBe(0);
    expect(getCharge(holder)).toBe(1);
    setCharge(holder, CHARGE_STACK_MAX);
    attr.apply(frame(MoveId.THUNDER_SHOCK, false) as never);
    expect(getCharge(holder)).toBe(CHARGE_STACK_MAX);
    expect(attr.canApply(frame(MoveId.TACKLE, false) as never)).toBe(false);
    // The editable type and number of stacks.
    clearCharge(holder);
    const fire = new CapacitorBankAbsorbAbAttr(PokemonType.FIRE, 2);
    expect(fire.canApply(frame(MoveId.EMBER, false) as never)).toBe(true);
    expect(fire.canApply(frame(MoveId.THUNDER_SHOCK, false) as never)).toBe(false);
    fire.apply(frame(MoveId.EMBER, false) as never);
    expect(getCharge(holder)).toBe(2);
  });

  it("in a real battle a foe's Electric move does no damage to the holder and charges it", async () => {
    const game = newGame(phaserGame, { ability: CAPACITOR, enemyMoves: [MoveId.THUNDER_SHOCK] });
    await game.classicMode.startBattle(SpeciesId.ELECTIVIRE);
    const holder = game.field.getPlayerPokemon();
    clearCharge(holder);
    holder.hp = holder.getMaxHp();
    game.move.select(MoveId.CELEBRATE);
    await game.phaseInterceptor.to("BerryPhase", false);
    expect(holder.hp).toBe(holder.getMaxHp());
    expect(getCharge(holder)).toBe(1);
  });

  it("in a real battle a damaging hit on the holder adds one stack, and a status move adds none", async () => {
    const game = newGame(phaserGame, { ability: CAPACITOR, enemyMoves: [MoveId.TACKLE] });
    await game.classicMode.startBattle(SpeciesId.ELECTIVIRE);
    const holder = game.field.getPlayerPokemon();
    clearCharge(holder);
    game.move.select(MoveId.CELEBRATE);
    await game.phaseInterceptor.to("BerryPhase", false);
    expect(holder.hp).toBeLessThan(holder.getMaxHp());
    expect(getCharge(holder)).toBe(1);
  });
});

describe("B14 chunk 6: Fault Current", () => {
  let phaserGame: Phaser.Game;
  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("counts every active end of turn, releases every second one, spends all stacks and hits every foe at 15 per stack", async () => {
    const game = newGame(phaserGame, { ability: FAULT, double: true });
    await game.classicMode.startBattle(SpeciesId.ELECTIVIRE, SpeciesId.MAGIKARP);
    const holder = game.scene.getPlayerField()[0];
    const foes = game.scene.getEnemyField();
    const attr = liveAbility(FAULT).attrs[0] as FaultCurrentAbAttr;
    const powers: number[] = [];
    for (const foe of foes) {
      vi.spyOn(foe, "getAttackDamage").mockImplementation(((args: { move: { power: number } }) => {
        powers.push(args.move.power);
        return { damage: 5, result: HitResult.EFFECTIVE, cancelled: false };
      }) as never);
      vi.spyOn(foe, "damageAndUpdate").mockImplementation((() => 5) as never);
    }
    clearCharge(holder);
    erFaultCurrentOnLeaveField(holder);
    setCharge(holder, 3);
    const frame = (simulated: boolean) => ({ pokemon: holder, simulated }) as never;
    // A preview neither counts nor releases.
    attr.apply(frame(true));
    expect(getActiveTurns(holder)).toBe(0);
    // Turn 1: counted, no release.
    attr.apply(frame(false));
    expect([getActiveTurns(holder), getCharge(holder), powers.length]).toEqual([1, 3, 0]);
    // Turn 2: released; every foe is hit once at 15 x 3, all stacks are spent.
    attr.apply(frame(false));
    expect([getActiveTurns(holder), getCharge(holder)]).toEqual([2, 0]);
    expect(powers).toEqual([45, 45]);
    // Turn 3 and 4 with no stacks: counted, nothing released even on the second one.
    attr.apply(frame(false));
    attr.apply(frame(false));
    expect([getActiveTurns(holder), powers.length]).toEqual([4, 2]);
    // Leaving the field resets the count.
    erFaultCurrentOnLeaveField(holder);
    expect(getActiveTurns(holder)).toBe(0);
  });

  it("honours the settings (period, power per stack, copied move) and does nothing without a foe", async () => {
    const game = newGame(phaserGame, { ability: FAULT });
    await game.classicMode.startBattle(SpeciesId.ELECTIVIRE);
    const holder = game.field.getPlayerPokemon();
    const foe = game.field.getEnemyPokemon();
    const seen: { power: number; id: MoveId }[] = [];
    vi.spyOn(foe, "getAttackDamage").mockImplementation(((args: { move: { power: number; id: MoveId } }) => {
      seen.push({ power: args.move.power, id: args.move.id });
      return { damage: 0, result: HitResult.EFFECTIVE, cancelled: false };
    }) as never);
    erFaultCurrentOnLeaveField(holder);
    const custom = new FaultCurrentAbAttr(1, 20, MoveId.THUNDERBOLT);
    setCharge(holder, 2);
    custom.apply({ pokemon: holder, simulated: false } as never);
    expect(seen).toHaveLength(1);
    expect(seen[0].power).toBe(40);
    expect(getCharge(holder)).toBe(0);
    // No foe standing: nothing is spent.
    erFaultCurrentOnLeaveField(holder);
    setCharge(holder, 4);
    vi.spyOn(holder, "getOpponents").mockImplementation((() => []) as never);
    custom.apply({ pokemon: holder, simulated: false } as never);
    expect(getCharge(holder)).toBe(4);
    expect(addCharge(holder, 0)).toBe(4);
  });
});

describe("B14 chunk 6: Overloaded, the power gate", () => {
  let phaserGame: Phaser.Game;
  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("canApply equals the original expression and the tree planned for the library over every state of its clauses", async () => {
    const game = newGame(phaserGame, { ability: OVERLOADED });
    await game.classicMode.startBattle(SpeciesId.ELECTIVIRE);
    const holder = game.field.getPlayerPokemon();
    const attr = liveAbility(OVERLOADED).attrs[0] as OverloadedPowerAbAttr;
    const chip = holder.getAllActiveAbilityAttrs().filter(a => a?.constructor?.name === "OverloadedChipAbAttr");
    expect(chip).toHaveLength(1);
    let carries = true;
    vi.spyOn(holder, "getAllActiveAbilityAttrs").mockImplementation((() => (carries ? chip : [])) as never);
    let accepted = 0;
    let compared = 0;
    for (const charge of [0, 1, 3, 4]) {
      setCharge(holder, charge);
      for (const marker of [true, false]) {
        carries = marker;
        for (const moveId of [
          MoveId.THUNDERBOLT,
          MoveId.THUNDER_SHOCK,
          MoveId.TACKLE,
          MoveId.CELEBRATE,
          MoveId.WATER_GUN,
        ]) {
          const move = allMoves[moveId];
          // Copied from the code before the split.
          const original =
            charge === CHARGE_STACK_MAX
            && holder.getAllActiveAbilityAttrs().some(a => a?.constructor?.name === "OverloadedChipAbAttr")
            && holder.getMoveType(move) === PokemonType.ELECTRIC;
          // The tree planned for the library (OverloadedPowerAbAttr.decl.ts): all[charge = 4, carries the marker, move is Electric].
          const planned = getCharge(holder) === 4 && marker && holder.getMoveType(move) === PokemonType.ELECTRIC;
          const params = { pokemon: holder, opponent: null, move, power: new NumberHolder(100), simulated: false };
          expect(attr.canApply(params as never), `charge ${charge} marker ${marker} ${MoveId[moveId]}`).toBe(original);
          expect(original).toBe(planned);
          compared++;
          accepted += original ? 1 : 0;
        }
      }
    }
    expect(compared).toBe(40);
    expect(accepted).toBe(2); // full charge, with the marker, for the two Electric moves
  });

  it("apply multiplies by 1.25 (or the setting) and a replaced gate replaces the whole condition", async () => {
    const game = newGame(phaserGame, { ability: OVERLOADED });
    await game.classicMode.startBattle(SpeciesId.ELECTIVIRE);
    const holder = game.field.getPlayerPokemon();
    const attr = liveAbility(OVERLOADED).attrs[0] as OverloadedPowerAbAttr;
    const power = new NumberHolder(100);
    attr.apply({ pokemon: holder, move: allMoves[MoveId.THUNDERBOLT], power } as never);
    expect(power.value).toBe(125);
    const custom = new OverloadedPowerAbAttr(2);
    const doubled = new NumberHolder(100);
    custom.apply({ pokemon: holder, move: allMoves[MoveId.THUNDERBOLT], power: doubled } as never);
    expect(doubled.value).toBe(200);
    setCharge(holder, 0);
    const frame = { pokemon: holder, move: allMoves[MoveId.TACKLE], power, simulated: false } as never;
    expect(custom.canApply(frame)).toBe(false);
    custom.gateOverride = () => true;
    expect(custom.canApply(frame)).toBe(true);
  });
});

describe("B14 chunk 6: Closed Circuit, the marker read by the engine", () => {
  let phaserGame: Phaser.Game;
  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  /** Both Pokemon of the pair carry the marker; the second one answers with the given move. Returns the burst launches. */
  async function burstsAfter(secondMove: MoveId, secondTarget: number | undefined): Promise<number> {
    resetTurnAttackLedger();
    const game = newGame(phaserGame, {
      ability: CLOSED_CIRCUIT,
      double: true,
      enemy: SpeciesId.WOBBUFFET,
      moves: [MoveId.TACKLE, MoveId.CELEBRATE],
    });
    await game.classicMode.startBattle(SpeciesId.PLUSLE, SpeciesId.MINUN);
    const launches: unknown[][] = [];
    const real = game.scene.phaseManager.unshiftNew.bind(game.scene.phaseManager) as (...args: unknown[]) => void;
    vi.spyOn(game.scene.phaseManager, "unshiftNew").mockImplementation(((...args: unknown[]) => {
      // The phase queues itself again for the attackers still owing an extra, so only the launch with both of the pair counts.
      if (args[0] === "ErClosedCircuitBurstPhase" && (args[1] as unknown[]).length === 2) {
        launches.push(args);
      }
      real(...args);
    }) as never);
    game.move.select(MoveId.TACKLE, 0, 2);
    game.move.select(secondMove, 1, secondTarget);
    await game.phaseInterceptor.to("BerryPhase", false);
    return launches.length;
  }

  it("two allies aiming at the same foe launch the extra attacks once", async () => {
    expect(await burstsAfter(MoveId.TACKLE, 2)).toBe(1);
  });

  it("one attacker alone launches nothing", async () => {
    expect(await burstsAfter(MoveId.CELEBRATE, undefined)).toBe(0);
  });
});
