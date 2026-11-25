/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// Library completion pass, wave A (requests/triage/BUILD-LIST.md A1-A25): every new condition atom and the options on
// the live atoms mon.has-type, mon.has-ability and party.ally-ability. Each atom is compared with the original class or
// engine helper where it can be built, otherwise with the original expression copied from the cited line. Numeric
// atoms get boundary tests.
import { AddSecondStrikeAbAttr, BypassSpeedChanceAbAttr, DownloadAbAttr, isComatoseLike } from "#abilities/ab-attrs";
import { initGlobalScene } from "#app/global-scene";
import { allAbilities, allMoves } from "#data/data-lists";
import { addCharge } from "#data/elite-redux/abilities/charge-stack";
import { StellarizePowerAbAttr } from "#data/elite-redux/abilities/fakemon-pitch-mechanics";
import { pokemonActedBefore } from "#data/elite-redux/abilities/relativity";
import { getCondition } from "#data/elite-redux/ability-studio/vocabulary/conditions";
import {
  abilityIdOf,
  compileConditionBlock,
  speciesIdOf,
} from "#data/elite-redux/ability-studio/vocabulary/evaluate/conditions";
import { type Frame, frameFromAttrParams } from "#data/elite-redux/ability-studio/vocabulary/evaluate/frame";
import { compareNumbers } from "#data/elite-redux/ability-studio/vocabulary/hp-math";
import { constantName } from "#data/elite-redux/ability-studio/vocabulary/player-names";
import { HigherStatMultiplierAbAttr } from "#data/elite-redux/ability-upgrades/attrs/requested-combat-riders";
import { PostAttackScriptedMoveAbAttr } from "#data/elite-redux/archetypes/post-attack-scripted-move";
import { PostSummonScriptedMoveAbAttr } from "#data/elite-redux/archetypes/post-summon-scripted-move";
import { PriorityModifierAbAttr } from "#data/elite-redux/archetypes/priority-modifier";
import { RechargeChargedOnElectricKoAbAttr } from "#data/elite-redux/archetypes/recharge-on-electric-terrain";
import { StabAddAbAttr } from "#data/elite-redux/archetypes/stab-add";
import { AbilityId } from "#enums/ability-id";
import { Command } from "#enums/command";
import { ErAbilityId } from "#enums/er-ability-id";
import { ErSpeciesId } from "#enums/er-species-id";
import { MoveCategory } from "#enums/move-category";
import { MoveId } from "#enums/move-id";
import { PokemonType } from "#enums/pokemon-type";
import { SpeciesId } from "#enums/species-id";
import { Stat } from "#enums/stat";
import { StatusEffect } from "#enums/status-effect";
import { describe, expect, it, vi } from "vitest";

type FakeMon = Record<string, unknown>;

function mon(over: FakeMon = {}): FakeMon {
  return {
    status: null,
    isActive: () => true,
    getAllies: () => [],
    getLastXMoves: () => [],
    getActiveAbilitySources: () => [],
    hasAbility: () => false,
    getBattlerIndex: () => 0,
    getAlly: () => undefined,
    getOpponents: () => [],
    battleData: { hitCount: 0 },
    turnData: { acted: false },
    waveData: { entryEffectsFired: new Set<string>() },
    ...over,
  };
}

const frame = (holder: FakeMon, extra: Partial<Frame> = {}): Frame => ({
  holder: holder as never,
  simulated: false,
  ...extra,
});

const atom = (block: string, params: Record<string, string | number | boolean> = {}) =>
  compileConditionBlock({ block, params });

const CMPS = ["lt", "lte", "eq", "gte", "gt"] as const;

describe("wave A: move and type atoms", () => {
  it("move.type-is-mine is the negation of StabAddAbAttr's default off-type closure, and StabSuppressAura's getTypes(true) with includeTera", () => {
    const move = allMoves[MoveId.EMBER];
    const offType = (new StabAddAbAttr() as unknown as { offTypeCondition: (...args: unknown[]) => boolean })
      .offTypeCondition;
    for (const moveType of [PokemonType.FIRE, PokemonType.WATER, PokemonType.GHOST, PokemonType.STELLAR]) {
      // Each argument pair gives a different answer, so a wrong second argument (true) shows up as GHOST.
      const getTypes = vi.fn((tera = true, stellar = false) => {
        if (stellar) {
          return [PokemonType.GHOST];
        }
        return tera ? [PokemonType.WATER] : [PokemonType.FIRE, PokemonType.FLYING];
      });
      const holder = mon({ getMoveType: () => moveType, getTypes });
      const original = offType(holder, null, move);
      expect(atom("move.type-is-mine")(frame(holder, { move })), PokemonType[moveType]).toBe(!original);
      expect(getTypes).toHaveBeenLastCalledWith(false, false);
      // stab-suppress-aura.ts:59-60: userTypes = pokemon.getTypes(true)
      const suppress = (getTypes(true) as PokemonType[]).includes(moveType);
      expect(atom("move.type-is-mine", { includeTera: true })(frame(holder, { move }))).toBe(suppress);
      expect(getTypes).toHaveBeenLastCalledWith(true, false);
    }
    expect(atom("move.type-is-mine")(frame(mon()))).toBe(false);
  });

  it("move.type-is-mine does not recurse when getMoveType runs the same rule again (calc.move-type)", () => {
    const check = atom("move.type-is-mine");
    const move = allMoves[MoveId.EMBER];
    const inner: boolean[] = [];
    const holder: FakeMon = mon({
      getTypes: () => [PokemonType.FIRE],
      // The engine's getMoveType dispatches the holder's type-change abilities: here, this very rule.
      getMoveType: () => {
        inner.push(check(frame(holder, { move })));
        return PokemonType.FIRE;
      },
    });
    expect(check(frame(holder, { move }))).toBe(true);
    expect(inner).toEqual([false]);
    // The latch is released afterwards: the next outer ask runs normally again.
    expect(check(frame(holder, { move }))).toBe(true);
    expect(inner).toEqual([false, false]);
  });

  it("move.type-counts-as answers like PostAttackScriptedMoveAbAttr.gate with a type filter", () => {
    const attrs = [{ getTriggeredMoveTypes: () => [PokemonType.FIRE] }, { other: 1 }];
    const holder = mon({ getAllActiveAbilityAttrs: () => attrs });
    for (const id of [MoveId.TACKLE, MoveId.EMBER, MoveId.WATER_GUN]) {
      const move = allMoves[id];
      for (const type of ["NORMAL", "FIRE", "WATER", "ICE"] as const) {
        const scripted = new PostAttackScriptedMoveAbAttr({ moveId: MoveId.ERUPTION, typeFilter: [PokemonType[type]] });
        const original = scripted.gate({ pokemon: holder, move, opponent: mon(), simulated: false } as never);
        expect(atom("move.type-counts-as", { type })(frame(holder, { move })), `${MoveId[id]} ${type}`).toBe(original);
      }
    }
    expect(atom("move.type-counts-as", { type: "NORMAL" })(frame(holder))).toBe(false);
  });

  it("move.accuracy: lt is PriorityModifierAbAttr.matchesFilter({ maxAccuracy }); boundaries for every comparison", () => {
    for (const accuracy of [-1, 0, 79, 80, 81, 100]) {
      const move = { accuracy } as never;
      const original = PriorityModifierAbAttr.matchesFilter({ maxAccuracy: 80 }, mon() as never, move);
      expect(atom("move.accuracy", { cmp: "lt", n: 80 })(frame(mon(), { move })), `${accuracy} lt`).toBe(original);
      for (const cmp of CMPS) {
        const want = accuracy >= 0 && compareNumbers(accuracy, cmp, 80);
        expect(atom("move.accuracy", { cmp, n: 80 })(frame(mon(), { move })), `${accuracy} ${cmp}`).toBe(want);
      }
    }
    // A real move that never misses (accuracy -1) is a no for every comparison, even against 0.
    const neverMisses = allMoves.find(move => move?.accuracy === -1 && move.power > 0);
    expect(neverMisses).toBeDefined();
    for (const cmp of CMPS) {
      expect(atom("move.accuracy", { cmp, n: 0 })(frame(mon(), { move: neverMisses })), cmp).toBe(false);
    }
  });

  it("move.sets-weather and move.spread read the real moves", () => {
    expect(atom("move.sets-weather")(frame(mon(), { move: allMoves[MoveId.RAIN_DANCE] }))).toBe(true);
    expect(atom("move.sets-weather")(frame(mon(), { move: allMoves[MoveId.TACKLE] }))).toBe(false);
    for (const id of [MoveId.EARTHQUAKE, MoveId.SURF, MoveId.TACKLE, MoveId.SPIKES]) {
      expect(atom("move.spread")(frame(mon(), { move: allMoves[id] }))).toBe(allMoves[id].isMultiTarget());
    }
    expect(atom("move.spread")(frame(mon()))).toBe(false);
  });

  it("move.can-be-multi-strike-enhanced answers like AddSecondStrikeAbAttr.canApply for the move user", () => {
    initGlobalScene({ currentBattle: { double: false, turnCommands: [] } } as never);
    const attr = new AddSecondStrikeAbAttr();
    const fighter = (): FakeMon =>
      mon({
        hasAbilityWithAttr: () => false,
        hasAbilityStudioCapability: () => false,
        getHeldItems: () => [],
        getTag: () => undefined,
        getMoveCategory: (_target: unknown, move: { category: MoveCategory }) => move.category,
      });
    const user = fighter();
    const defender = fighter();
    const results: boolean[] = [];
    for (const id of [MoveId.TACKLE, MoveId.EARTHQUAKE, MoveId.DOUBLE_KICK, MoveId.SOLAR_BEAM, MoveId.SWORDS_DANCE]) {
      const move = allMoves[id];
      const original = attr.canApply({ pokemon: user, opponent: defender, move, simulated: false } as never);
      // calc.hit-count: the holder is the move user.
      const own = frame(user, { move, moveUser: user as never, other: defender as never });
      expect(atom("move.can-be-multi-strike-enhanced")(own), MoveId[id]).toBe(original);
      // A defender-side trigger: the holder is the target, and the answer is still the attacker's.
      const theirs = frame(defender, { move, moveUser: user as never, other: user as never });
      expect(atom("move.can-be-multi-strike-enhanced")(theirs), `${MoveId[id]} defender side`).toBe(original);
      results.push(original);
    }
    // Both answers are covered (a spread move counts only when it really has several targets, so singles allow it).
    expect(results).toContain(true);
    expect(results).toContain(false);
    expect(atom("move.can-be-multi-strike-enhanced")(frame(user, { move: allMoves[MoveId.TACKLE] }))).toBe(false);
    expect(getCondition("move.can-be-multi-strike-enhanced")?.requires).toContain("moveUser");
  });

  it("move.chosen-is-damaging answers like Quick Draw's clause, with the roll and tag clauses passing", () => {
    const holder = mon({ randBattleSeedInt: () => 0, canAddTag: () => true });
    const quickDraw = new BypassSpeedChanceAbAttr(100);
    for (const command of [
      { move: { move: MoveId.TACKLE } },
      { move: { move: MoveId.THUNDERBOLT } },
      { move: { move: MoveId.SWORDS_DANCE } },
      { move: { move: MoveId.NONE } },
      {},
      undefined,
    ]) {
      initGlobalScene({ currentBattle: { turnCommands: [command] } } as never);
      const original = quickDraw.canApply({ simulated: false, pokemon: holder } as never);
      expect(atom("move.chosen-is-damaging")(frame(holder)), JSON.stringify(command)).toBe(original);
    }
  });
});

describe("wave A: stat atoms", () => {
  it("stat.is reads the stat slot; a multi-stat trigger shows only the first stat", () => {
    const check = atom("stat.is", { stats: "Speed, Attack" });
    expect(check(frame(mon(), { stat: Stat.SPD }))).toBe(true);
    expect(check(frame(mon(), { stat: Stat.ATK }))).toBe(true);
    expect(check(frame(mon(), { stat: Stat.DEF }))).toBe(false);
    expect(check(frame(mon()))).toBe(false);
    const multi = frameFromAttrParams("event.stat-stage-change", { pokemon: mon(), stats: [Stat.DEF, Stat.SPD] });
    expect(check(multi)).toBe(false);
  });

  it("stat.is-highest is HigherStatMultiplierAbAttr.gate: strict >, a tie goes to the first listed stat", () => {
    const candidates = [Stat.ATK, Stat.SPATK] as const;
    const attr = new HigherStatMultiplierAbAttr(candidates as never, 1.3);
    const check = atom("stat.is-highest", { stats: "Attack, Sp. Atk" });
    for (const [atk, spAtk] of [
      [100, 99],
      [100, 100],
      [100, 101],
      [0, 0],
    ]) {
      const raw = vi.fn((stat: number, _calc: boolean) => (stat === Stat.ATK ? atk : spAtk));
      const holder = mon({ getStat: raw });
      for (const stat of [Stat.ATK, Stat.SPATK, Stat.DEF]) {
        const original = attr.gate({ pokemon: holder, stat } as never);
        expect(check(frame(holder, { stat })), `${atk}/${spAtk} ${Stat[stat]}`).toBe(original);
      }
      // Raw stats only (getStat(_, false)), so the scan cannot recurse into the effective stat.
      expect(raw.mock.calls.every(call => call[1] === false)).toBe(true);
    }
    expect(() => atom("stat.is-highest", { stats: "" })).toThrow();
  });

  it("foe.average-defense-not-higher is DownloadAbAttr canApply (prepare + residual) and gate", () => {
    interface Foe {
      getEffectiveStat: (stat: number) => number;
    }
    const foe = (def: number, spDef: number): Foe => ({
      getEffectiveStat: (stat: number) => (stat === Stat.DEF ? def : spDef),
    });
    const cases: (Foe | null)[][] = [
      [],
      [null],
      [foe(80, 100)],
      [foe(100, 100)],
      [foe(101, 100)],
      [foe(0, 100)],
      [foe(100, 0)],
      [foe(100, 50), foe(50, 101)], // 75 vs 75.5 -> 75 vs 76
      [foe(101, 100), null, foe(100, 100)], // 100.5 -> 101 vs 100
      [foe(1, 1), foe(0, 0)], // 0.5 rounds to 1
    ];
    for (const foes of cases) {
      const holder = mon({ getAdjacentOpponents: () => foes });
      const download = new DownloadAbAttr();
      const params = { pokemon: holder, simulated: false } as never;
      const original = download.canApply(params) && download.gate(params);
      expect(atom("foe.average-defense-not-higher")(frame(holder)), JSON.stringify(foes)).toBe(original);
    }
  });

  it("foe.average-defense-not-higher does not recurse when getEffectiveStat runs the same rule again (stat triggers)", () => {
    const check = atom("foe.average-defense-not-higher");
    const inner: boolean[] = [];
    // One holder: the foe's stat calculation runs a field-wide stat ability, which is this very rule of the holder.
    const holder: FakeMon = mon();
    const foe = {
      getEffectiveStat: (stat: number) => {
        inner.push(check(frame(holder)));
        return stat === Stat.DEF ? 80 : 100;
      },
    };
    holder.getAdjacentOpponents = () => [foe];
    expect(check(frame(holder))).toBe(true);
    expect(inner).toEqual([false, false]);
    expect(check(frame(holder))).toBe(true);

    // Two holders that face each other, each with the rule on a stat trigger: A reads B, B reads A, A is latched.
    const calls: string[] = [];
    const a: FakeMon = mon();
    const b: FakeMon = mon();
    const statsOf = (self: FakeMon, name: string) => (stat: number) => {
      calls.push(name);
      check(frame(self));
      return stat === Stat.DEF ? 50 : 60;
    };
    a.getEffectiveStat = statsOf(a, "a");
    b.getEffectiveStat = statsOf(b, "b");
    a.getAdjacentOpponents = () => [b];
    b.getAdjacentOpponents = () => [a];
    expect(check(frame(a))).toBe(true);
    expect(calls.length).toBeLessThan(20);
  });
});

describe("wave A: Pokemon atoms", () => {
  it("mon.tera-type and mon.species read getTeraType and hasSpecies", () => {
    const holder = mon({
      getTeraType: () => PokemonType.STELLAR,
      hasSpecies: (species: SpeciesId) => species === SpeciesId.TERAPAGOS,
    });
    expect(atom("mon.tera-type", { type: "STELLAR" })(frame(holder))).toBe(true);
    expect(atom("mon.tera-type", { type: "FIRE" })(frame(holder))).toBe(false);
    expect(atom("mon.tera-type", { who: "other" })(frame(holder))).toBe(false);
    expect(atom("mon.species", { species: "Terapagos" })(frame(holder))).toBe(true);
    expect(atom("mon.species", { species: "PIKACHU" })(frame(holder))).toBe(false);
    expect(() => atom("mon.species", { species: "Not a mon" })).toThrow();
    expect(() => atom("mon.species", { species: "25" })).toThrow();
    // Elite Redux species resolve after the vanilla table: as written, as a player name, or by its key.
    const grotom = mon({ hasSpecies: (species: number) => species === ErSpeciesId.GROTOM });
    expect(atom("mon.species", { species: "Grotom" })(frame(grotom))).toBe(true);
    expect(atom("mon.species", { species: "GROTOM" })(frame(grotom))).toBe(true);
    expect(atom("mon.species", { species: "Grotom glass" })(frame(grotom))).toBe(false);
    expect(speciesIdOf("Phantowl")).toBe(ErSpeciesId.PHANTOWL);
    expect(speciesIdOf("Grotom Glass")).toBe(ErSpeciesId.GROTOM_GLASS);
    // Every vanilla name keeps the id it had.
    for (const [name, value] of Object.entries(SpeciesId)) {
      if (typeof value === "number" && !/^\d+$/.test(name)) {
        expect(speciesIdOf(name), name).toBe(value);
      }
    }
    expect(() => speciesIdOf("12")).toThrow();
  });

  it("status.asleep-or-comatose is SLEEP or the real isComatoseLike", () => {
    const comatose = mon({ hasAbility: (id: AbilityId) => id === AbilityId.COMATOSE });
    const asleep = mon({ status: { effect: StatusEffect.SLEEP } });
    const burned = mon({ status: { effect: StatusEffect.BURN } });
    for (const p of [comatose, asleep, burned, mon()]) {
      const original =
        (p.status as { effect?: StatusEffect } | null)?.effect === StatusEffect.SLEEP || isComatoseLike(p as never);
      expect(atom("status.asleep-or-comatose")(frame(p))).toBe(original);
    }
    expect(atom("status.asleep-or-comatose")(frame(comatose))).toBe(true);
    expect(atom("status.asleep-or-comatose", { who: "other" })(frame(asleep))).toBe(false);
  });

  it("mon.charge-stacks: boundaries around n on the shared charge store", () => {
    const holder = mon();
    for (let stacks = 0; stacks <= 4; stacks++) {
      for (const cmp of CMPS) {
        expect(atom("mon.charge-stacks", { cmp, n: 2 })(frame(holder)), `${stacks} ${cmp}`).toBe(
          compareNumbers(stacks, cmp, 2),
        );
      }
      addCharge(holder as never);
    }
  });

  it("mon.mega-evolved and mon.gigantamax-form answer like StellarizePowerAbAttr's default condition pieces", () => {
    const stellarize = new StellarizePowerAbAttr() as unknown as { condition: (...args: unknown[]) => boolean };
    const normalMove = allMoves[MoveId.TACKLE];
    const cases = [
      mon({ isTerastallized: false, isMega: () => true, getFormKey: () => "mega" }),
      mon({ isTerastallized: false, isMega: () => false, getFormKey: () => "gigantamax" }),
      mon({ isTerastallized: false, isMega: () => false, getFormKey: () => "GMax-rapid" }),
      mon({ isTerastallized: false, isMega: () => false, getFormKey: () => "" }),
    ];
    for (const target of cases) {
      const mega = atom("mon.mega-evolved", { who: "other" })(frame(mon(), { other: target as never }));
      const gmax = atom("mon.gigantamax-form", { who: "other" })(frame(mon(), { other: target as never }));
      // With a Normal move and a non-Tera target the class condition is exactly "mega or gigantamax".
      expect(mega || gmax, JSON.stringify(target)).toBe(stellarize.condition(mon(), target, normalMove));
      // Each piece alone: the other piece switched off on a copy of the target.
      expect(mega).toBe(stellarize.condition(mon(), { ...target, getFormKey: () => "" }, normalMove));
      expect(gmax).toBe(stellarize.condition(mon(), { ...target, isMega: () => false }, normalMove));
    }
    expect(atom("mon.mega-evolved", { who: "other" })(frame(mon()))).toBe(false);
    expect(atom("mon.gigantamax-form", { who: "other" })(frame(mon()))).toBe(false);
    // The default reads the ability owner.
    expect(getCondition("mon.mega-evolved")?.params[0].default).toBe("holder");
    expect(getCondition("mon.gigantamax-form")?.params[0].default).toBe("holder");
    expect(atom("mon.mega-evolved")(frame(cases[0]))).toBe(true);
    expect(atom("mon.gigantamax-form")(frame(cases[1]))).toBe(true);
    expect(stellarize.condition(mon(), null, normalMove)).toBe(false);
  });
});

describe("wave A: time atoms", () => {
  it("time.hits-taken: boundaries on battleData.hitCount", () => {
    for (const hitCount of [0, 1, 2, 3]) {
      for (const cmp of CMPS) {
        const holder = mon({ battleData: { hitCount } });
        expect(atom("time.hits-taken", { cmp, n: 2 })(frame(holder)), `${hitCount} ${cmp}`).toBe(
          compareNumbers(hitCount, cmp, 2),
        );
      }
    }
    expect(atom("time.hits-taken", { who: "other" })(frame(mon()))).toBe(false);
  });

  it("time.last-move-type answers like RechargeChargedOnElectricKoAbAttr.gate (Energized)", () => {
    const energized = new RechargeChargedOnElectricKoAbAttr();
    const lastUsed = (moves: { move: MoveId }[]) => mon({ getLastXMoves: () => moves });
    for (const history of [[{ move: MoveId.THUNDERBOLT }], [{ move: MoveId.TACKLE }], [{ move: MoveId.NONE }], []]) {
      const holder = lastUsed(history);
      const original = energized.gate({ pokemon: holder, simulated: false } as never);
      expect(atom("time.last-move-type", { type: "ELECTRIC" })(frame(holder)), JSON.stringify(history)).toBe(original);
    }
    expect(atom("time.last-move-type", { type: "NORMAL" })(frame(lastUsed([{ move: MoveId.TACKLE }])))).toBe(true);
    expect(atom("time.last-move-type", { type: "NORMAL" })(frame(mon()))).toBe(false);
  });

  it("time.acted-before calls the exported pokemonActedBefore helper", () => {
    const a = mon();
    const b = mon();
    const c = mon();
    for (const order of [[a, b], [b, a], [a], [b], []]) {
      initGlobalScene({ phaseManager: { dynamicQueueManager: { getLastTurnOrder: () => order } } } as never);
      expect(atom("time.acted-before")(frame(a, { other: b as never }))).toBe(
        pokemonActedBefore(a as never, b as never),
      );
      expect(atom("time.acted-before", { order: "other-first" })(frame(a, { other: b as never }))).toBe(
        pokemonActedBefore(b as never, a as never),
      );
    }
    initGlobalScene({ phaseManager: { dynamicQueueManager: { getLastTurnOrder: () => [a] } } } as never);
    expect(atom("time.acted-before")(frame(a, { other: c as never }))).toBe(true);
    expect(atom("time.acted-before")(frame(a))).toBe(false);
  });

  it("time.attacked-this-turn: acted and a last damaging move", () => {
    const cases = [
      mon({ turnData: { acted: true }, getLastXMoves: () => [{ move: MoveId.TACKLE }] }),
      mon({ turnData: { acted: true }, getLastXMoves: () => [{ move: MoveId.SWORDS_DANCE }] }),
      mon({ turnData: { acted: true }, getLastXMoves: () => [{ move: MoveId.NONE }] }),
      mon({ turnData: { acted: true }, getLastXMoves: () => [] }),
      mon({ turnData: { acted: false }, getLastXMoves: () => [{ move: MoveId.TACKLE }] }),
    ];
    const expected = [true, false, false, false, false];
    cases.forEach((holder, index) => {
      // plusle-minun.ts:102-108 attackedThisTurn
      const p = holder as unknown as { turnData: { acted: boolean }; getLastXMoves: () => { move: MoveId }[] };
      const last = p.getLastXMoves()[0];
      const original =
        p.turnData.acted
        && last !== undefined
        && last.move !== MoveId.NONE
        && allMoves[last.move]?.category !== MoveCategory.STATUS;
      expect(atom("time.attacked-this-turn")(frame(holder))).toBe(original);
      expect(original).toBe(expected[index]);
    });
  });

  it("time.max-uses-per-wave: boundaries, answered like PostSummonScriptedMoveAbAttr.gate", () => {
    const attr = new PostSummonScriptedMoveAbAttr({
      moveId: MoveId.WISH,
      oncePerBattleKey: "wishmaker",
      maxUsesPerBattle: 3,
    } as never);
    const fired = new Set<string>(["wishmakerX", "other#0"]);
    const holder = mon({ waveData: { entryEffectsFired: fired } });
    for (let used = 0; used <= 4; used++) {
      const original = attr.gate({ pokemon: holder, simulated: false } as never);
      expect(atom("time.max-uses-per-wave", { key: "wishmaker", max: 3 })(frame(holder)), `${used}`).toBe(original);
      expect(original).toBe(used < 3);
      fired.add(`wishmaker#${used}`);
    }
  });
});

describe("wave A: field and party atoms", () => {
  it("field.aura-on-field matches the Aura Break closures", () => {
    const withAbility = (ability: AbilityId) => mon({ hasAbility: (id: AbilityId) => id === ability });
    const fields = [[], [withAbility(AbilityId.DARK_AURA)], [withAbility(AbilityId.FAIRY_AURA)], [mon()]];
    for (const field of fields) {
      initGlobalScene({ getField: () => field } as never);
      const has = (id: AbilityId) => field.some(p => (p.hasAbility as (i: AbilityId) => boolean)(id));
      expect(atom("field.aura-on-field", { aura: "dark" })(frame(mon()))).toBe(has(AbilityId.DARK_AURA));
      expect(atom("field.aura-on-field", { aura: "fairy" })(frame(mon()))).toBe(has(AbilityId.FAIRY_AURA));
      expect(atom("field.aura-on-field")(frame(mon()))).toBe(has(AbilityId.DARK_AURA) || has(AbilityId.FAIRY_AURA));
    }
  });

  it("party.any-ally-active finds any active ally, not only the first", () => {
    const benched = mon({ isActive: () => false });
    const active = mon();
    expect(atom("party.any-ally-active")(frame(mon({ getAllies: () => [benched, active] })))).toBe(true);
    expect(atom("party.any-ally-active")(frame(mon({ getAllies: () => [benched, null] })))).toBe(false);
    expect(atom("party.any-ally-active")(frame(mon()))).toBe(false);
  });

  it("party.active-ally-chose-damaging-move: FIGHT command and a non-status move", () => {
    const ally = mon({ getBattlerIndex: () => 1 });
    const holder = mon({ getAllies: () => [ally] });
    const cases: [object | undefined, boolean][] = [
      [{ command: Command.FIGHT, move: { move: MoveId.TACKLE } }, true],
      [{ command: Command.FIGHT, move: { move: MoveId.SWORDS_DANCE } }, false],
      [{ command: Command.FIGHT, move: {} }, false],
      [{ command: Command.POKEMON, move: { move: MoveId.TACKLE } }, false],
      [undefined, false],
    ];
    for (const [command, want] of cases) {
      initGlobalScene({ currentBattle: { turnCommands: [undefined, command] } } as never);
      expect(atom("party.active-ally-chose-damaging-move")(frame(holder)), JSON.stringify(command)).toBe(want);
    }
    expect(atom("party.active-ally-chose-damaging-move")(frame(mon()))).toBe(false);
  });
});

describe("wave A: options on the live atoms (the defaults are today's behaviour)", () => {
  it("mon.has-type: default calls isOfType(type) as before; originalIfStellar calls isOfType(type, true, true)", () => {
    const isOfType = vi.fn(() => true);
    const holder = mon({ isOfType });
    atom("mon.has-type", { type: "FIRE" })(frame(holder));
    expect(isOfType).toHaveBeenLastCalledWith(PokemonType.FIRE);
    atom("mon.has-type", { type: "FIRE", originalIfStellar: true })(frame(holder));
    expect(isOfType).toHaveBeenLastCalledWith(PokemonType.FIRE, true, true);
    expect(getCondition("mon.has-type")?.params.find(p => p.id === "originalIfStellar")?.default).toBe(false);
  });

  it("mon.has-ability and party.ally-ability: default calls hasAbility(id) as before; current reads the main ability only", () => {
    const hasAbility = vi.fn((id: AbilityId) => id === AbilityId.LEVITATE || id === AbilityId.INTIMIDATE);
    const holder = mon({ hasAbility, getAbility: () => ({ id: AbilityId.INTIMIDATE }) });
    expect(atom("mon.has-ability", { ability: "Levitate" })(frame(holder))).toBe(true);
    expect(hasAbility).toHaveBeenLastCalledWith(AbilityId.LEVITATE);
    hasAbility.mockClear();
    expect(atom("mon.has-ability", { ability: "Levitate", current: true })(frame(holder))).toBe(false);
    expect(atom("mon.has-ability", { ability: "Intimidate", current: true })(frame(holder))).toBe(true);
    expect(hasAbility).not.toHaveBeenCalled();
    const withAlly = mon({ getAlly: () => holder });
    expect(atom("party.ally-ability", { ability: "Levitate" })(frame(withAlly))).toBe(true);
    expect(hasAbility).toHaveBeenLastCalledWith(AbilityId.LEVITATE);
    expect(atom("party.ally-ability", { ability: "Levitate", current: true })(frame(withAlly))).toBe(false);
    expect(atom("party.ally-ability", { ability: "Levitate", current: true })(frame(mon()))).toBe(false);
  });

  it("abilityIdOf: every vanilla name resolves as before; unknown text and digits are refused", () => {
    for (const [name, value] of Object.entries(AbilityId)) {
      if (typeof value === "number" && !/^\d+$/.test(name)) {
        expect(abilityIdOf(name), name).toBe(value);
      }
    }
    expect(abilityIdOf("Levitate")).toBe(AbilityId.LEVITATE);
    // Every Elite Redux key resolves to its own id, unless it also names another registered ability (a partner
    // composite with the same name), which is refused, never resolved to the other id.
    const refused: string[] = [];
    for (const [name, value] of Object.entries(ErAbilityId)) {
      if (name in AbilityId) {
        continue;
      }
      try {
        expect(abilityIdOf(name), name).toBe(value);
      } catch (error) {
        expect(String(error), name).toMatch(new RegExp(`different abilities \\(.*\\b${value}\\b`));
        refused.push(name);
      }
    }
    expect(refused.length).toBeLessThan(30);
    expect(() => abilityIdOf("Not an ability")).toThrow(/not a known ability/);
    expect(() => abilityIdOf("26")).toThrow();
    expect(() => atom("mon.has-ability", { ability: "Not an ability" })).toThrow();
  });

  it("abilityIdOf: every unique Elite Redux display name resolves to its id; a shared name is refused", () => {
    // Every registered Elite Redux ability (id 5000 and up), partner composites included, by the name shown in game.
    const byName = new Map<string, number[]>();
    for (const ability of allAbilities) {
      if (ability !== undefined && ability.id >= 5000) {
        const name = ability.name.replace(/ \([NP]\)$/, "");
        byName.set(name, [...(byName.get(name) ?? []), ability.id]);
      }
    }
    expect(byName.size).toBeGreaterThan(500);
    let checked = 0;
    for (const [name, ids] of byName) {
      // The vanilla table is asked first (unchanged behaviour), so a name that is also a vanilla ability keeps that id.
      if (ids.length > 1 || name in AbilityId || constantName(name) in AbilityId) {
        continue;
      }
      expect(abilityIdOf(name), name).toBe(ids[0]);
      checked++;
    }
    expect(checked).toBeGreaterThan(500);
    for (const punctuated of ["Jungle's Guard", "Olé!", "3 > 1"]) {
      expect(byName.has(punctuated), punctuated).toBe(true);
      expect(abilityIdOf(punctuated)).toBe(byName.get(punctuated)?.[0]);
    }
    expect(byName.get("As One")?.length).toBeGreaterThan(1);
    expect(() => abilityIdOf("As One")).toThrow(/different abilities/);
    expect(() => abilityIdOf("Embody Aspect")).toThrow(/different abilities/);
  });

  it("abilityIdOf: a name kept by an Elite Redux key and a partner composite is refused, not picked", () => {
    expect(ErAbilityId.KEEN_EDGE).toBe(5009);
    expect(allAbilities[5952]?.name.replace(/ \([NP]\)$/, "")).toBe("Keen Edge");
    expect(() => abilityIdOf("Keen Edge")).toThrow(/different abilities \(.*\b5009\b.*\b5952\b|\b5952\b.*\b5009\b/);
    for (const shared of [
      "Self Sufficient",
      "Short Circuit",
      "Ominous Shroud",
      "Stainless Steel",
      "Komodo",
      "Dragonfruit",
      "Voltron",
      "Waterborne",
    ]) {
      expect(() => abilityIdOf(shared), shared).toThrow(/different abilities/);
    }
    // A vanilla name never reaches this step: it resolves exactly as before.
    expect(abilityIdOf("KEEN_EYE")).toBe(AbilityId.KEEN_EYE);
    expect(abilityIdOf("Keen Eye")).toBe(AbilityId.KEEN_EYE);
  });

  it("abilityIdOf: a typed (N) / (P) marker is ignored and a name with no letters or digits is refused plainly", () => {
    expect(abilityIdOf("Klutz (N)")).toBe(AbilityId.KLUTZ);
    expect(abilityIdOf("Jungle's Guard (P)")).toBe(abilityIdOf("Jungle's Guard"));
    for (const blank of ["!!!", "  ", "é", "(N)"]) {
      expect(() => abilityIdOf(blank), blank).toThrow(/not a known ability/);
    }
  });

  it("abilityIdOf: an id missing from both tables resolves through the registered list (6062 Electrodynamics)", () => {
    expect(allAbilities[6062]).toBeDefined();
    expect(abilityIdOf("Electrodynamics")).toBe(6062);
    expect(abilityIdOf("Psionic")).toBe(6063);
  });
});
