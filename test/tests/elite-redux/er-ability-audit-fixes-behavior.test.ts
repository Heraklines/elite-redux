/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// ER ability AUDIT FIXES — runtime BEHAVIOR proofs (GameManager).
//
// The wiring is pinned in `er-ability-audit-fixes.test.ts`; this file drives the
// real battle engine to prove the runtime effect for the fixes whose logic lives
// in engine/primitive code the config test can't exercise. Gated ER_SCENARIO=1.
// All asserted effects are 100%-deterministic (no sub-100% procs, which the test
// RNG clamp would suppress).
// =============================================================================

import { TerrainType } from "#app/data/terrain";
import { ER_ID_MAP } from "#data/elite-redux/er-id-map";
import { AbilityId } from "#enums/ability-id";
import { BattlerTagType } from "#enums/battler-tag-type";
import { MoveId } from "#enums/move-id";
import { SpeciesId } from "#enums/species-id";
import { Stat } from "#enums/stat";
import { GameManager } from "#test/framework/game-manager";
import Phaser from "phaser";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

const RUN = process.env.ER_SCENARIO === "1";

const HEAT_SINK = ER_ID_MAP.abilities[865] as AbilityId;
const BLIND_RAGE = ER_ID_MAP.abilities[694] as AbilityId;
const LAST_STAND = ER_ID_MAP.abilities[634] as AbilityId;
const DENTING_BLOWS = ER_ID_MAP.abilities[643] as AbilityId;
const FROM_THE_SHADOWS = ER_ID_MAP.abilities[702] as AbilityId;
const BEAUTIFUL_MUSIC = ER_ID_MAP.abilities[622] as AbilityId;

describe.skipIf(!RUN)("ER ability audit fixes — behavior", () => {
  let phaserGame: Phaser.Game;
  let game: GameManager;

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });

  beforeEach(() => {
    game = new GameManager(phaserGame);
    game.override.battleStyle("single").criticalHits(false).enemyLevel(100).startingLevel(100);
  });

  it("Heat Sink (865): absorbs a Fire move and boosts the HIGHEST attacking stat (Regice: SpAtk)", async () => {
    game.override
      .ability(HEAT_SINK)
      .enemySpecies(SpeciesId.SNORLAX)
      .enemyAbility(AbilityId.BALL_FETCH)
      .enemyMoveset(MoveId.EMBER);
    await game.classicMode.startBattle([SpeciesId.REGICE]);
    const player = game.field.getPlayerPokemon();
    expect(player.getStatStage(Stat.SPATK)).toBe(0);
    const hpBefore = player.hp;

    game.move.use(MoveId.SPLASH);
    await game.toEndOfTurn();

    // Fire is absorbed (no damage) and Regice's highest attacking stat (SpAtk
    // 100 > Atk 50) rises by 1 — the old wire boosted Attack unconditionally.
    expect(player.hp).toBe(hpBefore);
    expect(player.getStatStage(Stat.SPATK)).toBe(1);
    expect(player.getStatStage(Stat.ATK)).toBe(0);
  });

  it("Last Stand (634): DEF scales ~1.3x at 50% HP vs 1.0x at full HP (linear gradient)", async () => {
    game.override.ability(LAST_STAND).enemySpecies(SpeciesId.SNORLAX).enemyAbility(AbilityId.BALL_FETCH);
    await game.classicMode.startBattle([SpeciesId.REGIROCK]);
    const player = game.field.getPlayerPokemon();

    const fullDef = player.getEffectiveStat(Stat.DEF);
    player.hp = Math.floor(player.getMaxHp() * 0.5);
    const halfDef = player.getEffectiveStat(Stat.DEF);

    // 1.0x at full → 1.3x at 50%. Ratio ≈ 1.3 (integer rounding tolerance).
    expect(halfDef / fullDef).toBeGreaterThan(1.25);
    expect(halfDef / fullDef).toBeLessThan(1.35);
  });

  it("Blind Rage (694): its Mold Breaker PRESERVES the defender's Grass Pelt (base-stat ability)", async () => {
    // Grass Pelt (the dex's named example) is a StatMultiplierAbAttr(DEF, 1.5)
    // in Grassy Terrain — exactly the "modifies base stats" class Blind Rage
    // must NOT bypass.
    game.override
      .ability(BLIND_RAGE)
      .moveset(MoveId.TACKLE)
      .startingTerrain(TerrainType.GRASSY)
      .enemySpecies(SpeciesId.SNORLAX)
      .enemyAbility(AbilityId.GRASS_PELT)
      .enemyMoveset(MoveId.SPLASH);
    await game.classicMode.startBattle([SpeciesId.SNORLAX]);
    const player = game.field.getPlayerPokemon();
    const enemy = game.field.getEnemyPokemon();
    const move = player.getMoveset()[0].getMove();

    const defAbilitiesOn = enemy.getEffectiveStat(Stat.DEF, player, move, false);
    // Under the attacker's ability-ignore, Blind Rage's marker keeps Grass Pelt.
    const defUnderBlindRageIgnore = enemy.getEffectiveStat(Stat.DEF, player, move, true);
    expect(defUnderBlindRageIgnore).toBe(defAbilitiesOn);
  });

  it("Blind Rage control: WITHOUT the preserve marker, ability-ignore DOES bypass Grass Pelt", async () => {
    // A marker-less attacker (Ball Fetch) proves the gate: under ability-ignore
    // the defender's Grass Pelt is skipped → lower Def. Blind Rage's marker (the
    // positive test above) is what re-enables it.
    game.override
      .ability(AbilityId.BALL_FETCH)
      .moveset(MoveId.TACKLE)
      .startingTerrain(TerrainType.GRASSY)
      .enemySpecies(SpeciesId.SNORLAX)
      .enemyAbility(AbilityId.GRASS_PELT)
      .enemyMoveset(MoveId.SPLASH);
    await game.classicMode.startBattle([SpeciesId.SNORLAX]);
    const player = game.field.getPlayerPokemon();
    const enemy = game.field.getEnemyPokemon();
    const move = player.getMoveset()[0].getMove();

    const defAbilitiesOn = enemy.getEffectiveStat(Stat.DEF, player, move, false);
    const defUnderIgnore = enemy.getEffectiveStat(Stat.DEF, player, move, true);
    expect(defUnderIgnore).toBeLessThan(defAbilitiesOn);
  });

  it("Denting Blows (643): a HAMMER move that HITS lowers the target's Def by 1", async () => {
    game.override
      .ability(DENTING_BLOWS)
      .moveset(MoveId.WOOD_HAMMER)
      .enemySpecies(SpeciesId.SNORLAX)
      .enemyAbility(AbilityId.BALL_FETCH)
      .enemyMoveset(MoveId.SPLASH);
    await game.classicMode.startBattle([SpeciesId.SNORLAX]);
    const enemy = game.field.getEnemyPokemon();
    const before = enemy.getStatStage(Stat.DEF);

    game.move.use(MoveId.WOOD_HAMMER);
    await game.toEndOfTurn();

    // Exactly one stage lower after a single connecting hammer hit.
    expect(enemy.getStatStage(Stat.DEF)).toBe(before - 1);
  });

  it("From the Shadows (702): a moving-first hit TRAPS the target (100% clause)", async () => {
    game.override
      .ability(FROM_THE_SHADOWS)
      .moveset(MoveId.TACKLE)
      .enemySpecies(SpeciesId.SNORLAX)
      .enemyAbility(AbilityId.BALL_FETCH)
      .enemyMoveset(MoveId.SPLASH);
    await game.classicMode.startBattle([SpeciesId.JOLTEON]); // fast → moves first
    const enemy = game.field.getEnemyPokemon();

    game.move.use(MoveId.TACKLE);
    await game.toEndOfTurn();

    expect(enemy.getTag(BattlerTagType.TRAPPED)).toBeTruthy();
  });

  it("Beautiful Music (622): infatuation IGNORES gender (a genderless target can be infatuated)", async () => {
    game.override.ability(BEAUTIFUL_MUSIC).enemySpecies(SpeciesId.MAGNEMITE).enemyAbility(AbilityId.BALL_FETCH);
    await game.classicMode.startBattle([SpeciesId.EXPLOUD]);
    const player = game.field.getPlayerPokemon();
    const enemy = game.field.getEnemyPokemon(); // Magnemite is genderless

    // canAdd is the fix: vanilla InfatuatedTag requires opposite gender, so a
    // genderless target could never be infatuated. The gender-ignore marker on
    // the source (Beautiful Music) lifts that requirement.
    enemy.addTag(BattlerTagType.INFATUATED, 1, undefined, player.id);
    expect(enemy.getTag(BattlerTagType.INFATUATED)).toBeTruthy();
  });

  it("Beautiful Music control: a source WITHOUT the marker can NOT infatuate a genderless target", async () => {
    game.override.ability(AbilityId.BALL_FETCH).enemySpecies(SpeciesId.MAGNEMITE).enemyAbility(AbilityId.BALL_FETCH);
    await game.classicMode.startBattle([SpeciesId.EXPLOUD]);
    const player = game.field.getPlayerPokemon();
    const enemy = game.field.getEnemyPokemon();

    enemy.addTag(BattlerTagType.INFATUATED, 1, undefined, player.id);
    expect(enemy.getTag(BattlerTagType.INFATUATED)).toBeFalsy();
  });
});
