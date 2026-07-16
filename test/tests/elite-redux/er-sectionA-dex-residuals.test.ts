/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// ER 2.65 dex "Section A" residuals — the non-c-source numeric/mechanic fixes.
// The dex (er-moves.ts / er-ability-rom-descriptions.ts) is the single source of
// truth; where the port diverged, the dex wins. This file pins the 12 findings:
//
//   96  Normalize (ability)  — "10% power boost" ×1.1 (was stacking vanilla ×1.2
//                              → net ×1.32); strip the vanilla boost.
//   179 Reversal (move)      — pp 10.
//   183 Mach Punch (move)    — pp 15.
//   185 Feint Attack (move)  — power 80 / pp 10 / always-hit.
//   350 Violent Rush (abil)  — first turn SPD ×1.5 + ATK ×1.2 (literal Attack,
//                              not an all-move power boost).
//   370 Opportunist (abil)   — +1 priority when targeting a foe at ≤50% HP.
//   509 Fighter (ability)    — low-HP boost boundary is INCLUSIVE ("1/3 or lower").
//   730 Mistsplosion (move)  — power 200.
//   766 Scorched Earth (move)— Fire OR Ground, whichever is more effective.
//   801 Black Magic (move)   — USE_HIGHEST_OFFENSE (higher of Atk/SpAtk).
//   811 Flash Freeze (move)  — never misses if the user is Ice-type.
//   974 Vexing Void (move)   — never misses in (Eerie) Fog.
//
// Gated behind ER_SCENARIO=1.
// =============================================================================

import { allAbilities, allMoves } from "#data/data-lists";
import { ER_USER_TYPE_ALWAYS_HIT, ER_WEATHER_ALWAYS_HIT } from "#data/elite-redux/archetypes/conditional-always-hit";
import { TypeDamageBoostAbAttr } from "#data/elite-redux/archetypes/type-damage-boost";
import { ER_ID_MAP } from "#data/elite-redux/er-id-map";
import { AbilityId } from "#enums/ability-id";
import { BattlerTagType } from "#enums/battler-tag-type";
import { MoveCategory } from "#enums/move-category";
import { MoveId } from "#enums/move-id";
import { PokemonType } from "#enums/pokemon-type";
import { SpeciesId } from "#enums/species-id";
import { Stat } from "#enums/stat";
import { WeatherType } from "#enums/weather-type";
import { GameManager } from "#test/framework/game-manager";
import { NumberHolder } from "#utils/common";
import Phaser from "phaser";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

const RUN = process.env.ER_SCENARIO === "1";

// ---------------------------------------------------------------------------
// DATA / UNIT tier — one GameManager boot, read the patched allMoves/allAbilities.
// ---------------------------------------------------------------------------
describe.skipIf(!RUN)("ER Section A dex residuals — data", () => {
  let phaserGame: Phaser.Game;

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
    void new GameManager(phaserGame);
  });

  it("179 Reversal has pp 10", () => {
    expect(allMoves[MoveId.REVERSAL].pp).toBe(10);
  });

  it("183 Mach Punch has pp 15", () => {
    const m = allMoves[MoveId.MACH_PUNCH];
    expect(m.pp).toBe(15);
    expect(m.priority).toBe(1);
  });

  it("185 Feint Attack is 80 BP / pp 10 / always-hit", () => {
    const m = allMoves[MoveId.FEINT_ATTACK];
    expect(m.power).toBe(80);
    expect(m.pp).toBe(10);
    expect(m.accuracy).toBe(-1); // -1 = never misses
  });

  it("730 Mistsplosion (Misty Explosion) is 200 BP", () => {
    expect(allMoves[MoveId.MISTY_EXPLOSION].power).toBe(200);
  });

  it("96 Normalize carries exactly ONE power boost, at ×1.1 (no ×1.32 stack)", () => {
    const ab = allAbilities[AbilityId.NORMALIZE];
    const boosts = ab.attrs.filter(a => a.constructor.name === "MovePowerBoostAbAttr");
    expect(boosts.length).toBe(1);
    expect((boosts[0] as unknown as { getPowerMultiplier(): number }).getPowerMultiplier()).toBeCloseTo(1.1, 5);
    // The type-conversion + ignore-resistances pieces stay.
    expect(ab.attrs.some(a => a.constructor.name === "MoveTypeChangeAbAttr")).toBe(true);
    expect(ab.attrs.some(a => a.constructor.name === "IgnoreResistancesAbAttr")).toBe(true);
  });

  it("350 Violent Rush wires first-turn SPD+ATK multipliers and NO all-move boost", () => {
    const abId = ER_ID_MAP.abilities[350];
    expect(abId).toBeDefined();
    const ab = allAbilities[abId];
    const firstTurn = ab.attrs.filter(a => a.constructor.name === "FirstTurnStatMultiplierAbAttr");
    expect(firstTurn.length).toBe(2); // SPD ×1.5 + ATK ×1.2
    // The old approximation added a plain MovePowerBoostAbAttr (boosted special
    // moves too). It must be gone — the dex says a literal "20% Attack".
    expect(ab.attrs.some(a => a.constructor.name === "MovePowerBoostAbAttr")).toBe(false);
  });

  it("370 Opportunist grants +1 priority gated on a foe at ≤50% HP", () => {
    const ab = allAbilities[AbilityId.OPPORTUNIST];
    const prio = ab.attrs.filter(a => a.constructor.name === "ChangeMovePriorityAbAttr");
    expect(prio.length).toBeGreaterThan(0);
    // Probe the target-HP-gated predicate directly.
    const attr = prio[0] as { canApply(p: { pokemon: unknown; move: unknown; priority: NumberHolder }): boolean };
    const move = allMoves[MoveId.TACKLE];
    const lowFoe = { getHpRatio: () => 0.5 };
    const fullFoe = { getHpRatio: () => 1.0 };
    const withFoe = (foe: unknown) =>
      attr.canApply({ pokemon: { getOpponents: () => [foe] }, move, priority: new NumberHolder(0) });
    expect(withFoe(lowFoe)).toBe(true); // exactly 50% → inclusive
    expect(withFoe(fullFoe)).toBe(false);
  });

  it("509 Fighter low-HP boost boundary is INCLUSIVE (1/3 HP → ×1.5)", () => {
    // Direct primitive check: exactly at the threshold must give the low-HP mult.
    const attr = new TypeDamageBoostAbAttr({
      type: PokemonType.FIGHTING,
      multiplier: 1.2,
      lowHpMultiplier: 1.5,
      lowHpThreshold: 1 / 3,
    });
    expect(attr.resolveMultiplier(1 / 3)).toBeCloseTo(1.5, 5); // boundary inclusive
    expect(attr.resolveMultiplier(0.34)).toBeCloseTo(1.2, 5); // just above → high-HP mult
    expect(attr.resolveMultiplier(0.3)).toBeCloseTo(1.5, 5); // below → low-HP mult

    // And Fighter itself carries such a boost.
    const fighterId = ER_ID_MAP.abilities[509];
    expect(fighterId).toBeDefined();
    const fighter = allAbilities[fighterId];
    const boost = fighter.attrs.find(a => a.constructor.name === "TypeDamageBoostAbAttr") as
      | TypeDamageBoostAbAttr
      | undefined;
    expect(boost).toBeDefined();
    expect(boost?.resolveMultiplier(1 / 3)).toBeCloseTo(1.5, 5);
  });

  it("766 Scorched Earth picks the more effective of Fire/Ground at damage time", () => {
    const move = allMoves[ER_ID_MAP.moves[766]];
    // BestEffectivenessChartOverrideAttr subclasses ErSuperEffectiveVsTypeAttr, so
    // filter by constructor name rather than getAttrs' registered-class lookup.
    const attr = move.attrs.find(a => a.constructor.name === "BestEffectivenessChartOverrideAttr") as
      | {
          apply(u: unknown, t: unknown, m: unknown, args: [NumberHolder, readonly PokemonType[], PokemonType]): boolean;
        }
      | undefined;
    expect(attr).toBeDefined();
    if (!attr) {
      throw new Error("BestEffectivenessChartOverrideAttr not attached to Scorched Earth");
    }
    const u = {};
    const t = {};
    const bestVs = (defTypes: PokemonType[]) => {
      const h = new NumberHolder(1);
      attr.apply(u, t, move, [h, defTypes, PokemonType.FIRE]);
      return h.value;
    };
    // vs Water: Fire ×0.5, Ground ×1 → picks Ground (1).
    expect(bestVs([PokemonType.WATER])).toBe(1);
    // vs Steel: Fire ×2, Ground ×2 → 2.
    expect(bestVs([PokemonType.STEEL])).toBe(2);
    // vs Flying: Fire ×1, Ground ×0 → picks Fire (1), NOT the Ground immunity.
    expect(bestVs([PokemonType.FLYING])).toBe(1);
    // vs Electric: Fire ×1, Ground ×2 → picks Ground (2) super-effective.
    expect(bestVs([PokemonType.ELECTRIC])).toBe(2);
  });

  it("801 Black Magic is SPECIAL-based and carries the highest-offense resolver", () => {
    const move = allMoves[ER_ID_MAP.moves[801]];
    expect(move.category).toBe(MoveCategory.SPECIAL);
    expect(move.getAttrs("PhotonGeyserCategoryAttr").length).toBeGreaterThan(0);
    expect(move.type).toBe(PokemonType.DARK);
  });

  it("811 Flash Freeze is registered as an Ice-user never-miss move", () => {
    const id = ER_ID_MAP.moves[811];
    expect(id).toBeDefined();
    expect(ER_USER_TYPE_ALWAYS_HIT.get(id)).toBe(PokemonType.ICE);
  });

  it("974 Vexing Void is registered as a fog never-miss move (incl. Eerie Fog)", () => {
    const id = ER_ID_MAP.moves[974];
    expect(id).toBeDefined();
    const weathers = ER_WEATHER_ALWAYS_HIT.get(id);
    expect(weathers).toBeDefined();
    expect(weathers).toContain(WeatherType.EERIE_FOG);
    expect(weathers).toContain(WeatherType.FOG);
  });
});

// ---------------------------------------------------------------------------
// COMBAT tier — drive real battles through the engine (green expect = real proof).
// ---------------------------------------------------------------------------
describe.skipIf(!RUN)("ER Section A dex residuals — combat", () => {
  let phaserGame: Phaser.Game;
  let game: GameManager;

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });

  beforeEach(() => {
    game = new GameManager(phaserGame);
    game.override
      .battleStyle("single")
      .criticalHits(false)
      .startingLevel(100)
      .enemyLevel(100)
      .enemyAbility(AbilityId.BALL_FETCH)
      .enemyMoveset(MoveId.SPLASH);
  });

  it("811 Flash Freeze: an ICE user connects even when the accuracy roll would miss", async () => {
    const flashFreeze = ER_ID_MAP.moves[811] as MoveId;
    // GLALIE is pure Ice. Force every accuracy roll to its MAX (a hard miss for a
    // <100% move) — only the Ice-user never-miss clause can land it.
    game.override.moveset([flashFreeze, MoveId.SPLASH]).enemySpecies(SpeciesId.SNORLAX).ability(AbilityId.BALL_FETCH);
    (game.scene as unknown as { randBattleSeedInt(range: number, min?: number): number }).randBattleSeedInt = (
      range: number,
      min = 0,
    ) => range - 1 + min;
    await game.classicMode.startBattle(SpeciesId.GLALIE);
    const enemy = game.field.getEnemyPokemon();

    game.move.select(flashFreeze);
    await game.phaseInterceptor.to("TurnEndPhase");

    // Frostbite (an ER battler tag) landed → the move hit despite the max roll.
    expect(enemy.getTag(BattlerTagType.ER_FROSTBITE)).toBeDefined();
  });

  it("811 Flash Freeze: a NON-ice user still misses under the same forced miss", async () => {
    const flashFreeze = ER_ID_MAP.moves[811] as MoveId;
    // CHARIZARD is Fire/Flying (not Ice) → no never-miss clause → the forced-max
    // accuracy roll makes it miss, so no frostbite tag.
    game.override.moveset([flashFreeze, MoveId.SPLASH]).enemySpecies(SpeciesId.SNORLAX).ability(AbilityId.BALL_FETCH);
    (game.scene as unknown as { randBattleSeedInt(range: number, min?: number): number }).randBattleSeedInt = (
      range: number,
      min = 0,
    ) => range - 1 + min;
    await game.classicMode.startBattle(SpeciesId.CHARIZARD);
    const enemy = game.field.getEnemyPokemon();

    game.move.select(flashFreeze);
    await game.phaseInterceptor.to("TurnEndPhase");

    expect(enemy.getTag(BattlerTagType.ER_FROSTBITE)).toBeUndefined();
  });

  it("974 Vexing Void: never misses in Eerie Fog (hits despite a forced-max roll)", async () => {
    const vexingVoid = ER_ID_MAP.moves[974] as MoveId;
    game.override
      .moveset([vexingVoid, MoveId.SPLASH])
      .ability(AbilityId.BALL_FETCH)
      .enemySpecies(SpeciesId.CHANSEY) // tanky → survives the hit, damage is observable
      .weather(WeatherType.EERIE_FOG);
    (game.scene as unknown as { randBattleSeedInt(range: number, min?: number): number }).randBattleSeedInt = (
      range: number,
      min = 0,
    ) => range - 1 + min;
    await game.classicMode.startBattle(SpeciesId.GENGAR);
    const enemy = game.field.getEnemyPokemon();
    const before = enemy.hp;

    game.move.select(vexingVoid);
    await game.phaseInterceptor.to("TurnEndPhase");

    expect(enemy.hp).toBeLessThan(before); // it connected in the fog
  });

  it("974 Vexing Void: WITHOUT fog the same forced-max roll misses", async () => {
    const vexingVoid = ER_ID_MAP.moves[974] as MoveId;
    game.override.moveset([vexingVoid, MoveId.SPLASH]).ability(AbilityId.BALL_FETCH).enemySpecies(SpeciesId.CHANSEY);
    (game.scene as unknown as { randBattleSeedInt(range: number, min?: number): number }).randBattleSeedInt = (
      range: number,
      min = 0,
    ) => range - 1 + min;
    await game.classicMode.startBattle(SpeciesId.GENGAR);
    const enemy = game.field.getEnemyPokemon();
    const before = enemy.hp;

    game.move.select(vexingVoid);
    await game.phaseInterceptor.to("TurnEndPhase");

    expect(enemy.hp).toBe(before); // missed (no fog, <100% acc, max roll)
  });

  it("801 Black Magic: a special attacker (Gengar) strikes off Sp.Atk, not Atk", async () => {
    const blackMagic = ER_ID_MAP.moves[801] as MoveId;
    game.override.moveset([blackMagic, MoveId.SPLASH]).ability(AbilityId.BALL_FETCH).enemySpecies(SpeciesId.CHANSEY);
    await game.classicMode.startBattle(SpeciesId.GENGAR);
    const gengar = game.field.getPlayerPokemon();
    const enemy = game.field.getEnemyPokemon();
    const move = allMoves[blackMagic];

    // The category resolver keeps it SPECIAL for Gengar (SpAtk 130 >> Atk 65).
    const catHolder = new NumberHolder(move.category);
    const attr = move.getAttrs("PhotonGeyserCategoryAttr")[0] as {
      apply(u: unknown, t: unknown, m: unknown, args: [NumberHolder]): boolean;
    };
    attr.apply(gengar, enemy, move, [catHolder]);
    expect(catHolder.value).toBe(MoveCategory.SPECIAL);

    const before = enemy.hp;
    game.move.select(blackMagic);
    await game.phaseInterceptor.to("TurnEndPhase");
    expect(enemy.hp).toBeLessThan(before);
  });

  it("801 Black Magic: a physical attacker (Machamp) flips the resolver to PHYSICAL", async () => {
    const blackMagic = ER_ID_MAP.moves[801] as MoveId;
    game.override.moveset([blackMagic, MoveId.SPLASH]).ability(AbilityId.BALL_FETCH).enemySpecies(SpeciesId.CHANSEY);
    await game.classicMode.startBattle(SpeciesId.MACHAMP);
    const machamp = game.field.getPlayerPokemon();
    const enemy = game.field.getEnemyPokemon();
    const move = allMoves[blackMagic];

    const catHolder = new NumberHolder(move.category);
    const attr = move.getAttrs("PhotonGeyserCategoryAttr")[0] as {
      apply(u: unknown, t: unknown, m: unknown, args: [NumberHolder]): boolean;
    };
    attr.apply(machamp, enemy, move, [catHolder]);
    expect(catHolder.value).toBe(MoveCategory.PHYSICAL); // Machamp Atk 130 > SpAtk 65
  });

  it("350 Violent Rush: first-turn ATK is boosted ×1.2 (physical Attack) and expires after the first move", async () => {
    const vrId = ER_ID_MAP.abilities[350] as AbilityId;
    game.override
      .moveset([MoveId.TACKLE, MoveId.SPLASH])
      .ability(vrId) // force the innate active on the player (scenario gotcha)
      .enemySpecies(SpeciesId.SNORLAX);
    await game.classicMode.startBattle(SpeciesId.MACHAMP);
    const player = game.field.getPlayerPokemon();

    // First turn (no move recorded yet): ATK ×1.2 AND SPD ×1.5 are live.
    const baseAtk = player.getStat(Stat.ATK);
    const baseSpd = player.getStat(Stat.SPD);
    expect(player.getEffectiveStat(Stat.ATK)).toBe(Math.floor(baseAtk * 1.2));
    expect(player.getEffectiveStat(Stat.SPD)).toBe(Math.floor(baseSpd * 1.5));

    // Move once; the first-turn window closes.
    game.move.select(MoveId.TACKLE);
    await game.phaseInterceptor.to("TurnEndPhase");

    // Second turn: both boosts have expired (literal Attack boost, not all-move).
    expect(player.getEffectiveStat(Stat.ATK)).toBe(baseAtk);
    expect(player.getEffectiveStat(Stat.SPD)).toBe(baseSpd);
  });

  it("96 Normalize: a non-Normal move is converted to Normal and connects", async () => {
    // Behavioral sanity in a real battle — Ember becomes Normal (→ 1× vs the
    // Normal-type Snorlax) and lands. The EXACT ×1.1 (vs the buggy ×1.32 stack)
    // is pinned deterministically by the data-tier test above
    // (exactly one MovePowerBoostAbAttr, multiplier 1.1).
    game.override.moveset([MoveId.EMBER, MoveId.SPLASH]).enemySpecies(SpeciesId.SNORLAX).ability(AbilityId.NORMALIZE);
    (game.scene as unknown as { randBattleSeedInt(range: number, min?: number): number }).randBattleSeedInt = () => 0;
    await game.classicMode.startBattle(SpeciesId.PIKACHU);
    const player = game.field.getPlayerPokemon();
    const enemy = game.field.getEnemyPokemon();
    const before = enemy.hp;

    game.move.select(MoveId.EMBER);
    await game.phaseInterceptor.to("TurnEndPhase");

    expect(enemy.hp).toBeLessThan(before);
    // The move was converted to Normal by Normalize.
    expect(player.getMoveType(allMoves[MoveId.EMBER])).toBe(PokemonType.NORMAL);
  });
});
