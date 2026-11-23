/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// B12 chunk 4 probes. What the shared L1 grid and L2 twin cannot see, driven on the ORIGINAL attr and on its REBUILD side by side:
//   * OffensiveTypeMultiplier: the foe's type for every type, single and dual, a missing foe, the power,
//   * TypeFilteredEffectChanceMultiplier: the guard (chance above 0, not Order Up or Electro Shot) survives a replaced gate, the clamp at 100,
//     and the library move.type atom reads false in this moment today (why Corrupted Mind stays legacy, request R-B12-30),
//   * TypeGatedStatTriggerOnAttack: the gate for every move (a status move counts), the stat phases, the hazard clear, the preview flag,
//   * TypeImmunityHighestAttackStatStage: the inherited immunity rule (a status move counts), the cancel flag, the higher-stat pick, the preview flag,
//   * TypedImmunityWithArenaTag: the attack-move gate for every move, the residual immunity rule, the field effect and its side, the preview flag,
//   * UserFieldFlagImmunity: the gate for every move, the own-move guard, the matchup zero (not the cancel flag),
//   * WakeStatBoost: the once-per-battle charge, the one phase for the whole list, the flag write, the preview flag,
//   * WeatherBasedMoveBlock: every move of the game against the 15-move list, the own-move guard, the already-cancelled guard,
//   * the codecs.
import { type AbAttr, TypeImmunityAbAttr } from "#abilities/ab-attrs";
import { globalScene } from "#app/global-scene";
import { allMoves } from "#data/data-lists";
import { getBinding } from "#data/elite-redux/ability-studio/bindings";
import { buildAttr, readDeclParams, recomposeAttr } from "#data/elite-redux/ability-studio/build-attr";
import {
  CORE_STAT_LIST_WORDS,
  flagInOptionsCodec,
  formatStatList,
  hazardSwitchCodec,
  parseStatList,
  statChangesInOptionsCodec,
  statListCodec,
  typeInOptionsCodec,
} from "#data/elite-redux/ability-studio/decl/B12/b12-chunk4-codecs";
import { declRegistry } from "#data/elite-redux/ability-studio/decl-registry";
import { OffensiveTypeMultiplierAbAttr } from "#data/elite-redux/archetypes/type-effectiveness-mod";
import { TypeFilteredEffectChanceMultiplierAbAttr } from "#data/elite-redux/archetypes/type-filtered-effect-chance";
import { TypeGatedStatTriggerOnAttackAbAttr } from "#data/elite-redux/archetypes/type-gated-stat-trigger-on-attack";
import { TypeImmunityHighestAttackStatStageAbAttr } from "#data/elite-redux/archetypes/type-immunity-highest-attack-stat-stage";
import { TypedImmunityWithArenaTagAbAttr } from "#data/elite-redux/archetypes/typed-immunity-with-arena-tag";
import { UserFieldFlagImmunityAbAttr } from "#data/elite-redux/archetypes/user-field-flag-immunity";
import { WakeStatBoostAbAttr } from "#data/elite-redux/archetypes/wake-stat-boost";
import { WeatherBasedMoveBlockAbAttr } from "#data/elite-redux/archetypes/weather-based-move-block";
import { ArenaTagSide } from "#enums/arena-tag-side";
import { ArenaTagType } from "#enums/arena-tag-type";
import { MoveFlags } from "#enums/move-flags";
import { MoveId } from "#enums/move-id";
import { PokemonType } from "#enums/pokemon-type";
import { Stat } from "#enums/stat";
import { startWorld } from "#test/tests/elite-redux/decomp/harness/game";
import { type AttrSite, allAttrSites } from "#test/tests/elite-redux/decomp/harness/sites";
import { setTypesOf } from "#test/tests/elite-redux/decomp/harness/world";
import { BooleanHolder, NumberHolder } from "#utils/common";
import Phaser from "phaser";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

type AnyAttr = AbAttr & {
  canApply(params: never): boolean;
  apply(params: never): void;
};

function sitesOf(className: string): AttrSite[] {
  return allAttrSites().filter(site => site.className === className);
}

/** The attr rebuilt from its declaration, or undefined when its gate is a legacy-closure. */
function rebuild(site: AttrSite): AnyAttr | undefined {
  const module = declRegistry.get(site.className)!;
  const gate = getBinding(site.abilityId, site.attrIndex, "gate");
  if (gate !== undefined && gate.spec === undefined) {
    return;
  }
  return recomposeAttr(module, site.attr, site.abilityId, site.attrIndex) as AnyAttr;
}

const realMoves = () => allMoves.filter(move => move !== undefined && move.id !== MoveId.NONE);

const PHASE = "StatStageChangePhase";

describe("B12 chunk 4: the type-gated, immunity and wake-up archetype classes", () => {
  let phaserGame: Phaser.Game;
  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("every bound user rebuilds as a fresh equal attr and the legacy users are exactly the ones the notes list", () => {
    const legacy: string[] = [];
    const rebuilt: Record<string, number> = {};
    for (const className of [
      "OffensiveTypeMultiplierAbAttr",
      "TypeFilteredEffectChanceMultiplierAbAttr",
      "TypeGatedStatTriggerOnAttackAbAttr",
      "TypeImmunityHighestAttackStatStageAbAttr",
      "TypedImmunityWithArenaTagAbAttr",
      "UserFieldFlagImmunityAbAttr",
      "WakeStatBoostAbAttr",
      "WeatherBasedMoveBlockAbAttr",
    ]) {
      for (const site of sitesOf(className)) {
        const attr = rebuild(site);
        if (attr === undefined) {
          legacy.push(`${site.abilityName}:${site.attrIndex}:${className}`);
        } else {
          expect(attr).not.toBe(site.attr);
          expect(attr.constructor).toBe(site.attr.constructor);
          expect(attr.showAbility).toBe(site.attr.showAbility);
          rebuilt[className] = (rebuilt[className] ?? 0) + 1;
        }
      }
    }
    expect(rebuilt).toEqual({
      OffensiveTypeMultiplierAbAttr: 6,
      TypeGatedStatTriggerOnAttackAbAttr: 2,
      TypeImmunityHighestAttackStatStageAbAttr: 5,
      UserFieldFlagImmunityAbAttr: 1,
      WeatherBasedMoveBlockAbAttr: 2,
    });
    expect(legacy.sort()).toEqual(
      [
        "Corrupted Mind:1:TypeFilteredEffectChanceMultiplierAbAttr",
        "Evaporate:0:TypedImmunityWithArenaTagAbAttr",
        "Rude Awakening:1:WakeStatBoostAbAttr",
      ].sort(),
    );
  });

  // -------------------------------------------------------------------------------------------
  // Offensive type multiplier
  it("OffensiveTypeMultiplier: canApply equals 'the foe is of the type' for every type, dual types and a missing foe (original and rebuild)", async () => {
    const { holder, foe } = await startWorld(phaserGame);
    const sites = sitesOf("OffensiveTypeMultiplierAbAttr");
    expect(sites.length).toBe(6);
    const move = allMoves[MoveId.TACKLE];
    let trueCount = 0;
    for (const site of sites) {
      const type = (site.attr as unknown as { targetDefenderType: PokemonType }).targetDefenderType;
      const copy = rebuild(site)!;
      const states: (readonly PokemonType[])[] = [];
      for (let candidate = 0; candidate <= 17; candidate++) {
        states.push([candidate as PokemonType], [candidate as PokemonType, type]);
      }
      for (const types of states) {
        setTypesOf(foe, types);
        const params = {
          pokemon: holder,
          opponent: foe,
          move,
          power: new NumberHolder(100),
          simulated: false,
        } as never;
        const expected = foe.isOfType(type);
        expect((site.attr as AnyAttr).canApply(params), `${site.abilityName} ${types.join("/")}`).toBe(expected);
        expect(copy.canApply(params), `${site.abilityName} rebuilt ${types.join("/")}`).toBe(expected);
        trueCount += expected ? 1 : 0;
      }
      // A missing foe never counts.
      const missing = {
        pokemon: holder,
        opponent: undefined,
        move,
        power: new NumberHolder(100),
        simulated: false,
      } as never;
      expect((site.attr as AnyAttr).canApply(missing)).toBe(false);
      expect(copy.canApply(missing)).toBe(false);
      // The power.
      for (const target of [site.attr as AnyAttr, copy]) {
        const power = new NumberHolder(100);
        target.apply({ pokemon: holder, opponent: foe, move, power, simulated: false } as never);
        expect(power.value).toBeCloseTo(150);
      }
    }
    expect(trueCount).toBeGreaterThan(30);
    setTypesOf(foe, undefined);
  });

  it("OffensiveTypeMultiplier: a Terastallized foe counts as its Tera type, original and rebuild alike", async () => {
    const { holder, foe } = await startWorld(phaserGame);
    const site = sitesOf("OffensiveTypeMultiplierAbAttr").find(s => s.abilityName === "Dragonslayer")!;
    const copy = rebuild(site)!;
    const move = allMoves[MoveId.TACKLE];
    setTypesOf(foe, [PokemonType.WATER]);
    foe.teraType = PokemonType.DRAGON;
    (foe as unknown as { isTerastallized: boolean }).isTerastallized = true;
    const params = { pokemon: holder, opponent: foe, move, power: new NumberHolder(100), simulated: false } as never;
    const expected = foe.isOfType(PokemonType.DRAGON);
    expect((site.attr as AnyAttr).canApply(params)).toBe(expected);
    expect(copy.canApply(params)).toBe(expected);
    (foe as unknown as { isTerastallized: boolean }).isTerastallized = false;
    setTypesOf(foe, undefined);
  });

  // -------------------------------------------------------------------------------------------
  // Type filtered effect chance
  it("TypeFilteredEffectChance: the guard (chance above 0, not Order Up or Electro Shot) and the type gate hold for every move; the guard survives a replaced gate", async () => {
    const { holder } = await startWorld(phaserGame);
    const site = sitesOf("TypeFilteredEffectChanceMultiplierAbAttr")[0];
    const module = declRegistry.get(site.className)!;
    expect(readDeclParams(module, site.attr)).toEqual({ type: "PSYCHIC", multiplier: 1.4 });
    // The two ways of replacing the gate by hand: the same closure, and "always true".
    const sameGate = buildAttr(
      module,
      { type: "PSYCHIC", multiplier: 1.4 },
      {
        gate: ((p: { pokemon: typeof holder; move: (typeof allMoves)[number] }) =>
          p.pokemon.getMoveType(p.move) === PokemonType.PSYCHIC) as never,
      },
    ) as AnyAttr;
    const anyType = buildAttr(module, { type: "PSYCHIC", multiplier: 1.4 }, { gate: (() => true) as never }) as AnyAttr;
    let psychicTrue = 0;
    for (const move of realMoves()) {
      for (const chance of [-1, 0, 10, 30, 70, 100]) {
        const params = { pokemon: holder, move, chance: new NumberHolder(chance), simulated: false } as never;
        const exempt = move.id === MoveId.ORDER_UP || move.id === MoveId.ELECTRO_SHOT;
        const guards = chance > 0 && !exempt;
        const expected = guards && holder.getMoveType(move) === PokemonType.PSYCHIC;
        expect((site.attr as AnyAttr).canApply(params), `${MoveId[move.id]} ${chance}`).toBe(expected);
        expect(sameGate.canApply(params), `same gate ${MoveId[move.id]} ${chance}`).toBe(expected);
        expect(anyType.canApply(params), `any type ${MoveId[move.id]} ${chance}`).toBe(guards);
        psychicTrue += expected ? 1 : 0;
      }
    }
    expect(psychicTrue).toBeGreaterThan(30);
    // The effect: x1.4 and never above 100.
    for (const target of [site.attr as AnyAttr, sameGate]) {
      for (const [from, to] of [
        [30, 42],
        [50, 70],
        [80, 100],
        [100, 100],
      ] as const) {
        const chance = new NumberHolder(from);
        target.apply({ pokemon: holder, move: allMoves[MoveId.PSYCHIC], chance, simulated: false } as never);
        expect(chance.value).toBeCloseTo(to);
      }
    }
  });

  it("TypeFilteredEffectChance: the library move.type atom reads false in the effect-chance moment today (why the user is legacy until R-B12-30)", async () => {
    const { holder } = await startWorld(phaserGame);
    const site = sitesOf("TypeFilteredEffectChanceMultiplierAbAttr")[0];
    const module = declRegistry.get(site.className)!;
    const libraryGate = buildAttr(
      module,
      { type: "PSYCHIC", multiplier: 1.4 },
      { gate: { block: "move.type", params: { type: "PSYCHIC", effective: true } } as never },
    ) as AnyAttr;
    const params = {
      pokemon: holder,
      move: allMoves[MoveId.PSYCHIC],
      chance: new NumberHolder(30),
      simulated: false,
    } as never;
    expect((site.attr as AnyAttr).canApply(params)).toBe(true);
    expect(libraryGate.canApply(params)).toBe(false);
  });

  // -------------------------------------------------------------------------------------------
  // Type gated stat trigger on attack
  it("TypeGatedStatTriggerOnAttack: canApply is the move's type for EVERY move, a status move of the type included (original and rebuild)", async () => {
    const { holder, foe } = await startWorld(phaserGame);
    const sites = sitesOf("TypeGatedStatTriggerOnAttackAbAttr");
    expect(sites.length).toBe(2);
    let fightingStatus = 0;
    for (const site of sites) {
      const copy = rebuild(site)!;
      for (const move of realMoves()) {
        const params = { pokemon: holder, opponent: foe, move, damage: 20, hitResult: 1, simulated: false } as never;
        const expected = holder.getMoveType(move) === PokemonType.FIGHTING;
        expect((site.attr as AnyAttr).canApply(params), `${site.abilityName} ${MoveId[move.id]}`).toBe(expected);
        expect(copy.canApply(params), `${site.abilityName} rebuilt ${MoveId[move.id]}`).toBe(expected);
        if (expected && move.category === 2) {
          fightingStatus++;
        }
      }
    }
    // Bulk Up (and others) are Fighting STATUS moves: the class accepts them.
    expect(fightingStatus).toBeGreaterThan(0);
  });

  it("TypeGatedStatTriggerOnAttack: one phase per listed stat in order, hazards cleared on MY side only, nothing when simulated (original and rebuild)", async () => {
    const { holder, foe } = await startWorld(phaserGame);
    const site = sitesOf("TypeGatedStatTriggerOnAttackAbAttr")[0];
    const copy = rebuild(site)!;
    const arena = globalScene.arena;
    const mySide = holder.isPlayer() ? ArenaTagSide.PLAYER : ArenaTagSide.ENEMY;
    const theirSide = mySide === ArenaTagSide.PLAYER ? ArenaTagSide.ENEMY : ArenaTagSide.PLAYER;
    const hazards = [
      ArenaTagType.SPIKES,
      ArenaTagType.TOXIC_SPIKES,
      ArenaTagType.STEALTH_ROCK,
      ArenaTagType.STICKY_WEB,
    ];
    const lay = (): void => {
      for (const side of [mySide, theirSide]) {
        for (const tag of hazards) {
          arena.removeTagOnSide(tag, side);
          arena.addTag(tag, 0, undefined, foe.id, side);
        }
      }
    };
    const move = allMoves[MoveId.MACH_PUNCH];
    const spy = vi.spyOn(globalScene.phaseManager, "unshiftNew").mockImplementation((() => undefined) as never);
    for (const attr of [site.attr as AnyAttr, copy]) {
      lay();
      attr.apply({ pokemon: holder, opponent: foe, move, damage: 20, hitResult: 1, simulated: true } as never);
      expect(spy).not.toHaveBeenCalled();
      for (const tag of hazards) {
        expect(arena.getTagOnSide(tag, mySide), `simulated keeps ${tag}`).toBeDefined();
      }
      attr.apply({ pokemon: holder, opponent: foe, move, damage: 20, hitResult: 1, simulated: false } as never);
      expect(spy).toHaveBeenCalledTimes(1);
      expect(spy).toHaveBeenCalledWith(PHASE, holder.getBattlerIndex(), true, [Stat.SPD], 1);
      for (const tag of hazards) {
        expect(arena.getTagOnSide(tag, mySide), `cleared ${tag}`).toBeUndefined();
        expect(arena.getTagOnSide(tag, theirSide), `foe side keeps ${tag}`).toBeDefined();
      }
      spy.mockClear();
    }
    // Several stats in the given order, and no hazard clearing without the switch.
    const multi = new TypeGatedStatTriggerOnAttackAbAttr({
      type: PokemonType.FIGHTING,
      stats: [
        { stat: Stat.ATK, stages: 1 },
        { stat: Stat.DEF, stages: -2 },
      ],
    }) as AnyAttr;
    lay();
    multi.apply({ pokemon: holder, opponent: foe, move, damage: 20, hitResult: 1, simulated: false } as never);
    expect(spy.mock.calls).toEqual([
      [PHASE, holder.getBattlerIndex(), true, [Stat.ATK], 1],
      [PHASE, holder.getBattlerIndex(), true, [Stat.DEF], -2],
    ]);
    for (const tag of hazards) {
      expect(arena.getTagOnSide(tag, mySide)).toBeDefined();
    }
    for (const side of [mySide, theirSide]) {
      for (const tag of hazards) {
        arena.removeTagOnSide(tag, side);
      }
    }
    // The rebuilt params read back exactly.
    const module = declRegistry.get(site.className)!;
    expect(readDeclParams(module, site.attr)).toEqual({ type: "FIGHTING", stats: "Speed +1", clearHazards: true });
    expect(readDeclParams(module, multi)).toEqual({
      type: "FIGHTING",
      stats: "Attack +1, Defense -2",
      clearHazards: false,
    });
  });

  // -------------------------------------------------------------------------------------------
  // Type immunity that raises the higher attacking stat
  it("TypeImmunityHighestAttackStatStage: the immunity rule is the parent's, untouched, for every move (a status move of the type counts)", async () => {
    const { holder, foe } = await startWorld(phaserGame);
    const sites = sitesOf("TypeImmunityHighestAttackStatStageAbAttr");
    expect(sites.length).toBe(5);
    let statusAbsorbed = 0;
    for (const site of sites) {
      const type = (site.attr as unknown as { immuneType: PokemonType }).immuneType;
      const plain = new TypeImmunityAbAttr(type) as unknown as AnyAttr;
      const copy = rebuild(site)!;
      for (const move of realMoves()) {
        const params = {
          pokemon: holder,
          opponent: foe,
          move,
          typeMultiplier: new NumberHolder(1),
          cancelled: new BooleanHolder(false),
          simulated: false,
        } as never;
        const expected = plain.canApply(params);
        expect((site.attr as AnyAttr).canApply(params), `${site.abilityName} ${MoveId[move.id]}`).toBe(expected);
        expect(copy.canApply(params), `${site.abilityName} rebuilt ${MoveId[move.id]}`).toBe(expected);
        if (expected && move.category === 2) {
          statusAbsorbed++;
        }
      }
    }
    expect(statusAbsorbed).toBeGreaterThan(0);
  });

  it("TypeImmunityHighestAttackStatStage: zero matchup AND the cancel flag; the higher raw stat is raised (Attack on a tie); nothing is queued when simulated", async () => {
    const { holder, foe } = await startWorld(phaserGame);
    const site = sitesOf("TypeImmunityHighestAttackStatStageAbAttr").find(s => s.abilityName === "Lightning Rod")!;
    const copy = rebuild(site)!;
    const move = allMoves[MoveId.THUNDERBOLT];
    const spy = vi.spyOn(globalScene.phaseManager, "unshiftNew").mockImplementation((() => undefined) as never);
    for (const attr of [site.attr as AnyAttr, copy]) {
      for (const [atk, spatk, expected] of [
        [200, 100, Stat.ATK],
        [100, 200, Stat.SPATK],
        [150, 150, Stat.ATK],
      ] as const) {
        vi.spyOn(holder, "getStat").mockImplementation(((stat: Stat) => (stat === Stat.ATK ? atk : spatk)) as never);
        const typeMultiplier = new NumberHolder(1);
        const cancelled = new BooleanHolder(false);
        spy.mockClear();
        attr.apply({ pokemon: holder, opponent: foe, move, typeMultiplier, cancelled, simulated: false } as never);
        expect(typeMultiplier.value).toBe(0);
        expect(cancelled.value).toBe(true);
        expect(spy).toHaveBeenCalledTimes(1);
        expect(spy).toHaveBeenCalledWith(PHASE, holder.getBattlerIndex(), true, [expected], 1);
      }
      // Simulated: the immunity still shows, no phase is queued.
      const typeMultiplier = new NumberHolder(1);
      const cancelled = new BooleanHolder(false);
      spy.mockClear();
      attr.apply({ pokemon: holder, opponent: foe, move, typeMultiplier, cancelled, simulated: true } as never);
      expect(typeMultiplier.value).toBe(0);
      expect(cancelled.value).toBe(true);
      expect(spy).not.toHaveBeenCalled();
    }
    // The more stages option reaches the phase.
    const two = new TypeImmunityHighestAttackStatStageAbAttr({ immuneType: PokemonType.GRASS, stages: 2 }) as AnyAttr;
    spy.mockClear();
    two.apply({
      pokemon: holder,
      opponent: foe,
      move,
      typeMultiplier: new NumberHolder(1),
      cancelled: new BooleanHolder(false),
      simulated: false,
    } as never);
    expect(spy.mock.calls[0][4]).toBe(2);
  });

  // -------------------------------------------------------------------------------------------
  // Typed immunity with a field effect
  it("TypedImmunityWithArenaTag: canApply is 'an attack move' then the parent's rule, for every move; the class test is not the library's 'not a status move'", async () => {
    const { holder, foe } = await startWorld(phaserGame);
    const site = sitesOf("TypedImmunityWithArenaTagAbAttr")[0];
    const module = declRegistry.get(site.className)!;
    expect(readDeclParams(module, site.attr)).toEqual({ type: "WATER", arenaTag: "MIST", turns: 5 });
    const plain = new TypeImmunityAbAttr(PokemonType.WATER) as unknown as AnyAttr;
    const sameGate = buildAttr(
      module,
      { type: "WATER", arenaTag: "MIST", turns: 5 },
      { gate: ((p: { move: (typeof allMoves)[number] }) => p.move.is("AttackMove")) as never },
    ) as AnyAttr;
    const anyMove = buildAttr(
      module,
      { type: "WATER", arenaTag: "MIST", turns: 5 },
      { gate: (() => true) as never },
    ) as AnyAttr;
    let waterAttack = 0;
    let waterStatus = 0;
    const attackTestDiffers: string[] = [];
    for (const move of realMoves()) {
      // The class test and the library atom's test ('category is not Status') are NOT the same set of moves: collect the difference.
      if (move.is("AttackMove") !== (move.category !== 2)) {
        attackTestDiffers.push(
          `${MoveId[move.id]}:${move.is("AttackMove") ? "attack-only" : "damaging-category-only"}`,
        );
      }
      const params = {
        pokemon: holder,
        opponent: foe,
        move,
        typeMultiplier: new NumberHolder(1),
        cancelled: new BooleanHolder(false),
        simulated: false,
      } as never;
      const immune = plain.canApply(params);
      const expected = move.is("AttackMove") && immune;
      expect((site.attr as AnyAttr).canApply(params), MoveId[move.id]).toBe(expected);
      expect(sameGate.canApply(params), `same gate ${MoveId[move.id]}`).toBe(expected);
      // Without the gate, a status move of the type passes too: the immunity rule stays as the residual.
      expect(anyMove.canApply(params), `no gate ${MoveId[move.id]}`).toBe(immune);
      if (expected) {
        waterAttack++;
      } else if (immune) {
        waterStatus++;
      }
    }
    expect(waterAttack).toBeGreaterThan(10);
    expect(waterStatus).toBeGreaterThan(0);
    console.log(`ATTACK_TEST_DIFFERS ${attackTestDiffers.sort().join(",")}`);
    // The library atom move.damaging reads no move user in the type-immunity moment today (why Evaporate is legacy until R-B12-30).
    const libraryGate = buildAttr(
      module,
      { type: "WATER", arenaTag: "MIST", turns: 5 },
      { gate: { block: "move.damaging", params: {} } as never },
    ) as AnyAttr;
    const water = allMoves[MoveId.WATER_GUN];
    const waterParams = {
      pokemon: holder,
      opponent: foe,
      move: water,
      typeMultiplier: new NumberHolder(1),
      cancelled: new BooleanHolder(false),
      simulated: false,
    } as never;
    expect((site.attr as AnyAttr).canApply(waterParams)).toBe(true);
    expect(libraryGate.canApply(waterParams)).toBe(false);
  });

  it("TypedImmunityWithArenaTag: zero matchup, the field effect on MY side for the set turns, nothing set when simulated", async () => {
    const { holder, foe } = await startWorld(phaserGame);
    const site = sitesOf("TypedImmunityWithArenaTagAbAttr")[0];
    const module = declRegistry.get(site.className)!;
    const copy = buildAttr(
      module,
      { type: "WATER", arenaTag: "MIST", turns: 5 },
      { gate: (() => true) as never },
    ) as AnyAttr;
    const move = allMoves[MoveId.WATER_GUN];
    const spy = vi.spyOn(globalScene.arena, "addTag").mockImplementation((() => true) as never);
    for (const attr of [site.attr as AnyAttr, copy]) {
      for (const [mon, side] of [
        [holder, holder.isPlayer() ? ArenaTagSide.PLAYER : ArenaTagSide.ENEMY],
        [foe, foe.isPlayer() ? ArenaTagSide.PLAYER : ArenaTagSide.ENEMY],
      ] as const) {
        spy.mockClear();
        const typeMultiplier = new NumberHolder(1);
        attr.apply({
          pokemon: mon,
          opponent: holder,
          move,
          typeMultiplier,
          cancelled: new BooleanHolder(false),
          simulated: false,
        } as never);
        expect(typeMultiplier.value).toBe(0);
        expect(spy).toHaveBeenCalledTimes(1);
        expect(spy).toHaveBeenCalledWith(ArenaTagType.MIST, 5, undefined, mon.id, side);
        spy.mockClear();
        const simulatedMultiplier = new NumberHolder(1);
        attr.apply({
          pokemon: mon,
          opponent: holder,
          move,
          typeMultiplier: simulatedMultiplier,
          cancelled: new BooleanHolder(false),
          simulated: true,
        } as never);
        expect(simulatedMultiplier.value).toBe(0);
        expect(spy).not.toHaveBeenCalled();
      }
    }
  });

  // -------------------------------------------------------------------------------------------
  // Noise Cancel
  it("UserFieldFlagImmunity: canApply equals 'not my own move' and 'the move has the property' for every move, original and rebuild; apply zeroes the matchup only", async () => {
    const { holder, foe } = await startWorld(phaserGame);
    const site = sitesOf("UserFieldFlagImmunityAbAttr")[0];
    const copy = rebuild(site)!;
    const module = declRegistry.get(site.className)!;
    expect(readDeclParams(module, site.attr)).toEqual({ flag: "SOUND_BASED" });
    let soundTrue = 0;
    for (const move of realMoves()) {
      const params = {
        pokemon: holder,
        opponent: foe,
        move,
        typeMultiplier: new NumberHolder(1),
        cancelled: new BooleanHolder(false),
        simulated: false,
      } as never;
      const expected = move.doesFlagEffectApply({ flag: MoveFlags.SOUND_BASED, user: foe, target: holder });
      expect((site.attr as AnyAttr).canApply(params), MoveId[move.id]).toBe(expected);
      expect(copy.canApply(params), `rebuilt ${MoveId[move.id]}`).toBe(expected);
      soundTrue += expected ? 1 : 0;
      // A Pokemon never blocks its own move.
      const own = { ...(params as object), opponent: holder } as never;
      expect((site.attr as AnyAttr).canApply(own)).toBe(false);
      expect(copy.canApply(own)).toBe(false);
    }
    expect(soundTrue).toBeGreaterThan(20);
    for (const attr of [site.attr as AnyAttr, copy]) {
      const typeMultiplier = new NumberHolder(2);
      const cancelled = new BooleanHolder(false);
      attr.apply({
        pokemon: holder,
        opponent: foe,
        move: allMoves[MoveId.HYPER_VOICE],
        typeMultiplier,
        cancelled,
        simulated: false,
      } as never);
      expect(typeMultiplier.value).toBe(0);
      expect(cancelled.value).toBe(false);
    }
  });

  // -------------------------------------------------------------------------------------------
  // Rude Awakening's wake-up boost
  it("WakeStatBoost: the once-per-battle charge gates it; apply spends the charge, queues ONE phase for the whole list, and does nothing when simulated", async () => {
    const { holder } = await startWorld(phaserGame);
    const site = sitesOf("WakeStatBoostAbAttr")[0];
    const module = declRegistry.get(site.className)!;
    expect(readDeclParams(module, site.attr)).toEqual({ stats: CORE_STAT_LIST_WORDS.join(", "), stages: 1 });
    // Legacy gate: the rebuild here replaces the gate with the same closure by hand.
    const copy = buildAttr(
      module,
      { stats: CORE_STAT_LIST_WORDS.join(", "), stages: 1 },
      { gate: ((p: { pokemon: typeof holder }) => !p.pokemon.battleData.rudeAwakeningTriggered) as never },
    ) as AnyAttr;
    const spy = vi.spyOn(globalScene.phaseManager, "unshiftNew").mockImplementation((() => undefined) as never);
    const params = (simulated: boolean) => ({ pokemon: holder, simulated }) as never;
    for (const attr of [site.attr as AnyAttr, copy]) {
      holder.battleData.rudeAwakeningTriggered = false;
      spy.mockClear();
      expect(attr.canApply(params(false))).toBe(true);
      attr.apply(params(true));
      expect(spy).not.toHaveBeenCalled();
      expect(holder.battleData.rudeAwakeningTriggered).toBe(false);
      attr.apply(params(false));
      expect(holder.battleData.rudeAwakeningTriggered).toBe(true);
      expect(spy).toHaveBeenCalledTimes(1);
      expect(spy).toHaveBeenCalledWith(
        PHASE,
        holder.getBattlerIndex(),
        true,
        [Stat.ATK, Stat.DEF, Stat.SPATK, Stat.SPDEF, Stat.SPD],
        1,
      );
      expect(attr.canApply(params(false))).toBe(false);
    }
    holder.battleData.rudeAwakeningTriggered = false;
    // A chosen list and stage count reach the phase in the order written.
    const custom = buildAttr(module, { stats: "Speed, Attack", stages: 2 }, { gate: (() => true) as never }) as AnyAttr;
    spy.mockClear();
    custom.apply(params(false));
    expect(spy).toHaveBeenCalledWith(PHASE, holder.getBattlerIndex(), true, [Stat.SPD, Stat.ATK], 2);
    holder.battleData.rudeAwakeningTriggered = false;
    // The class defaults to the five core stats when the options leave the list out.
    const defaults = new WakeStatBoostAbAttr({ stages: 1 }) as AnyAttr;
    spy.mockClear();
    defaults.apply(params(false));
    expect(spy.mock.calls[0][3]).toEqual([Stat.ATK, Stat.DEF, Stat.SPATK, Stat.SPDEF, Stat.SPD]);
    holder.battleData.rudeAwakeningTriggered = false;
  });

  // -------------------------------------------------------------------------------------------
  // Weather based move block
  it("WeatherBasedMoveBlock: exactly the 15 listed moves are blocked, in every state of the guards (original and rebuild)", async () => {
    const { holder, foe } = await startWorld(phaserGame);
    const sites = sitesOf("WeatherBasedMoveBlockAbAttr");
    expect(sites.length).toBe(2);
    const listed = new Set<MoveId>([
      MoveId.WEATHER_BALL,
      MoveId.SOLAR_BEAM,
      MoveId.SOLAR_BLADE,
      MoveId.HURRICANE,
      MoveId.THUNDER,
      MoveId.BLIZZARD,
      MoveId.SILVER_WIND,
      MoveId.WILDBOLT_STORM,
      MoveId.BLEAKWIND_STORM,
      MoveId.SANDSEAR_STORM,
      MoveId.SPRINGTIDE_STORM,
      MoveId.SHEER_COLD,
      MoveId.FIRE_PLEDGE,
      MoveId.WATER_PLEDGE,
      MoveId.GRASS_PLEDGE,
    ]);
    for (const site of sites) {
      const copy = rebuild(site)!;
      let blocked = 0;
      for (const move of realMoves()) {
        const make = (opponent: typeof foe, cancelled: boolean) =>
          ({ pokemon: holder, opponent, move, cancelled: new BooleanHolder(cancelled), simulated: false }) as never;
        const expected = listed.has(move.id);
        for (const attr of [site.attr as AnyAttr, copy]) {
          expect(attr.canApply(make(foe, false)), `${site.abilityName} ${MoveId[move.id]}`).toBe(expected);
          // Already cancelled by another ability: nothing.
          expect(attr.canApply(make(foe, true)), `cancelled ${MoveId[move.id]}`).toBe(false);
          // My own move: nothing.
          expect(attr.canApply(make(holder, false)), `own ${MoveId[move.id]}`).toBe(false);
        }
        blocked += expected ? 1 : 0;
      }
      expect(blocked).toBe(15);
      const cancelled = new BooleanHolder(false);
      copy.apply({
        pokemon: holder,
        opponent: foe,
        move: allMoves[MoveId.THUNDER],
        cancelled,
        simulated: false,
      } as never);
      expect(cancelled.value).toBe(true);
    }
    // For the notes: the moves that carry the game's weather flag but are not on the list.
    const flagged = realMoves()
      .filter(move => move.hasFlag(MoveFlags.WEATHER_BASED) && !listed.has(move.id))
      .map(move => MoveId[move.id])
      .sort();
    console.log(`WEATHER_FLAG_NOT_LISTED ${flagged.join(",")}`);
  });

  // -------------------------------------------------------------------------------------------
  // Codecs and the refactor's footprint
  it("the codecs read the options back exactly and refuse what they cannot read in plain words", () => {
    const opts = {
      type: PokemonType.FIGHTING,
      flag: MoveFlags.SOUND_BASED,
      stats: [{ stat: Stat.SPD, stages: 1 }],
      clearHazards: true,
    };
    expect(typeInOptionsCodec("type").fromInstance(opts)).toBe("FIGHTING");
    expect(typeInOptionsCodec("type").toCtor("FIGHTING")).toBe(PokemonType.FIGHTING);
    expect(() => typeInOptionsCodec("type").toCtor("FIGHTINGS")).toThrow(/known type/);
    expect(flagInOptionsCodec.fromInstance(opts)).toBe("SOUND_BASED");
    expect(flagInOptionsCodec.toCtor("SOUND_BASED")).toBe(MoveFlags.SOUND_BASED);
    expect(() => flagInOptionsCodec.toCtor("LOUD")).toThrow(/move property/);
    expect(statChangesInOptionsCodec.fromInstance(opts)).toBe("Speed +1");
    expect(statChangesInOptionsCodec.toCtor("Speed +1, Defense -1")).toEqual([
      { stat: Stat.SPD, stages: 1 },
      { stat: Stat.DEF, stages: -1 },
    ]);
    expect(hazardSwitchCodec.fromInstance(opts)).toBe(true);
    expect(hazardSwitchCodec.fromInstance({ type: 1 })).toBe(false);
    expect(hazardSwitchCodec.toCtor(true)).toBe(true);
    expect(hazardSwitchCodec.toCtor(false)).toBe(false);
    expect(parseStatList("Attack, sp. def")).toEqual([Stat.ATK, Stat.SPDEF]);
    expect(formatStatList([Stat.ATK, Stat.DEF, Stat.SPATK, Stat.SPDEF, Stat.SPD])).toBe(
      CORE_STAT_LIST_WORDS.join(", "),
    );
    expect(formatStatList([Stat.ACC])).toBeUndefined();
    expect(formatStatList([])).toBeUndefined();
    expect(statListCodec.fromInstance([Stat.SPD])).toBe("Speed");
    expect(() => parseStatList("")).toThrow(/at least one stat/);
    expect(() => parseStatList("Accuracy")).toThrow(/five stats/);
  });

  it("the refactored classes keep their name, their banner setting and their constructor arity", async () => {
    await startWorld(phaserGame);
    const make: Record<string, () => AbAttr> = {
      OffensiveTypeMultiplierAbAttr: () => new OffensiveTypeMultiplierAbAttr(PokemonType.DRAGON, 1.5),
      TypeFilteredEffectChanceMultiplierAbAttr: () =>
        new TypeFilteredEffectChanceMultiplierAbAttr(PokemonType.PSYCHIC, 1.4),
      TypeGatedStatTriggerOnAttackAbAttr: () =>
        new TypeGatedStatTriggerOnAttackAbAttr({ type: PokemonType.FIGHTING, stats: [{ stat: Stat.SPD, stages: 1 }] }),
      TypeImmunityHighestAttackStatStageAbAttr: () =>
        new TypeImmunityHighestAttackStatStageAbAttr({ immuneType: PokemonType.ELECTRIC, stages: 1 }),
      TypedImmunityWithArenaTagAbAttr: () =>
        new TypedImmunityWithArenaTagAbAttr({ immuneType: PokemonType.WATER, arenaTag: ArenaTagType.MIST, turns: 5 }),
      UserFieldFlagImmunityAbAttr: () => new UserFieldFlagImmunityAbAttr({ flag: MoveFlags.SOUND_BASED }),
      WakeStatBoostAbAttr: () => new WakeStatBoostAbAttr({ stages: 1 }),
      WeatherBasedMoveBlockAbAttr: () => new WeatherBasedMoveBlockAbAttr(),
    };
    const banner: Record<string, boolean> = {
      OffensiveTypeMultiplierAbAttr: false,
      TypeFilteredEffectChanceMultiplierAbAttr: false,
      TypeGatedStatTriggerOnAttackAbAttr: false,
      TypeImmunityHighestAttackStatStageAbAttr: true,
      TypedImmunityWithArenaTagAbAttr: true,
      UserFieldFlagImmunityAbAttr: true,
      WakeStatBoostAbAttr: false,
      WeatherBasedMoveBlockAbAttr: true,
    };
    for (const [name, create] of Object.entries(make)) {
      const attr = create();
      expect(attr.constructor.name).toBe(name);
      expect(attr.showAbility, name).toBe(banner[name]);
    }
    // The class instances the game built show the same banner settings.
    for (const [name, shown] of Object.entries(banner)) {
      for (const site of sitesOf(name)) {
        expect(site.attr.showAbility, `${site.abilityName} ${name}`).toBe(shown);
      }
    }
  });
});
