/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// ER ability-engine audit fixes — BATCH 5 runtime BEHAVIOR proofs (GameManager).
//
// Covers:
//   #46  Tera Shell (607) + Teraform Zero (739) — resist EVERY hit of a multi-hit
//   #52  Soothsayer (773)  — 3-turn NVE effectiveness FLOOR (not a flat x0.5)
//   #54  Gleam Eyes (707)  — foe held items suppressed (Embargo-style)
//   #56  Drakelp Head (932)— consume-on-first-defend (first hit halved + ATK-1 once)
//   #60  Lead Coat (296)   — weight-triple; Evaporate (444) — ally self-drop immunity
//
// Plus regression guards for the shared primitives (vanilla Heavy Metal weight,
// vanilla berry consumption path). Gated ER_SCENARIO=1. All asserted effects are
// deterministic (no sub-100% procs that the test RNG clamp would hide).
// =============================================================================

import { allMoves } from "#data/data-lists";
import { ER_ID_MAP } from "#data/elite-redux/er-id-map";
import { AbilityId } from "#enums/ability-id";
import { ArenaTagSide } from "#enums/arena-tag-side";
import { ArenaTagType } from "#enums/arena-tag-type";
import { BattlerIndex } from "#enums/battler-index";
import { BerryType } from "#enums/berry-type";
import { MoveId } from "#enums/move-id";
import { SpeciesId } from "#enums/species-id";
import { Stat } from "#enums/stat";
import { GameManager } from "#test/framework/game-manager";
import Phaser from "phaser";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

const RUN = process.env.ER_SCENARIO === "1";

const SOOTHSAYER = ER_ID_MAP.abilities[773] as AbilityId;
const GLEAM_EYES = ER_ID_MAP.abilities[707] as AbilityId;
const DRAKELP_HEAD = ER_ID_MAP.abilities[932] as AbilityId;
const LEAD_COAT = ER_ID_MAP.abilities[296] as AbilityId;
const EVAPORATE = ER_ID_MAP.abilities[444] as AbilityId;
const TERAFORM_ZERO = ER_ID_MAP.abilities[739] as AbilityId;

describe.skipIf(!RUN)("ER ability batch-5 fixes — behavior", () => {
  let phaserGame: Phaser.Game;
  let game: GameManager;

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });

  beforeEach(() => {
    game = new GameManager(phaserGame);
    game.override.battleStyle("single").criticalHits(false).enemyLevel(100).startingLevel(100);
  });

  // ---------------------------------------------------------------------------
  // #46 — Tera Shell (607, vanilla) + Teraform Zero (739) resist EVERY sub-hit.
  //
  // The mechanism is `turnData.moveEffectiveness`: FullHpResistType.apply floors
  // the effectiveness to 0.5 AND caches it, and getMoveEffectiveness returns the
  // cached value on later strikes — so once hit 1 (at full HP) latches 0.5, every
  // remaining strike stays 0.5 even though HP is no longer full. This is exactly
  // the dex's "activates on each hit, unlike other similar abilities" and it is
  // ALREADY correct in the port; this test locks it against a cache refactor.
  // ---------------------------------------------------------------------------
  it("Tera Shell (607): a full-HP holder resists every hit of a multi-hit move (cache latch)", async () => {
    game.override.ability(AbilityId.BALL_FETCH).enemySpecies(SpeciesId.SNORLAX).enemyAbility(AbilityId.TERA_SHELL);
    await game.classicMode.startBattle(SpeciesId.MACHAMP);
    const player = game.field.getPlayerPokemon();
    const enemy = game.field.getEnemyPokemon();
    const doubleKick = allMoves[MoveId.DOUBLE_KICK]; // Fighting, 2 hits, super-effective (2x) vs Normal

    // Hit 1 — holder at full HP → effectiveness floored to 0.5 (from 2x) and cached.
    enemy.turnData.moveEffectiveness = null;
    expect(enemy.isFullHp()).toBe(true);
    expect(enemy.getMoveEffectiveness(player, doubleKick, false, false)).toBe(0.5);

    // Simulate hit 1's damage: the holder is no longer at full HP.
    enemy.hp = Math.floor(enemy.getMaxHp() * 0.5);
    expect(enemy.isFullHp()).toBe(false);

    // Hit 2 — WITHOUT clearing the cache (as a real multi-hit runs): still 0.5.
    expect(enemy.getMoveEffectiveness(player, doubleKick, false, false)).toBe(0.5);

    // Prove it is the latch, not re-evaluation: clearing the cache re-checks
    // isFullHp (now false) and the super-effective 2x returns.
    enemy.turnData.moveEffectiveness = null;
    expect(enemy.getMoveEffectiveness(player, doubleKick, false, false)).toBe(2);
  });

  it("Teraform Zero (739): same per-hit resist latch as Tera Shell", async () => {
    game.override.ability(AbilityId.BALL_FETCH).enemySpecies(SpeciesId.SNORLAX).enemyAbility(TERAFORM_ZERO);
    await game.classicMode.startBattle(SpeciesId.MACHAMP);
    const player = game.field.getPlayerPokemon();
    const enemy = game.field.getEnemyPokemon();
    const doubleKick = allMoves[MoveId.DOUBLE_KICK];

    enemy.turnData.moveEffectiveness = null;
    expect(enemy.getMoveEffectiveness(player, doubleKick, false, false)).toBe(0.5);
    enemy.hp = Math.floor(enemy.getMaxHp() * 0.5);
    expect(enemy.getMoveEffectiveness(player, doubleKick, false, false)).toBe(0.5);
    enemy.turnData.moveEffectiveness = null;
    expect(enemy.getMoveEffectiveness(player, doubleKick, false, false)).toBe(2);
  });

  // ---------------------------------------------------------------------------
  // #52 — Soothsayer (773): a 3-turn effectiveness FLOOR at 0.5, not a flat x0.5.
  // A super-effective hit is CLAMPED to 0.5; a resisted hit is left untouched;
  // after 3 turns the floor lifts.
  // ---------------------------------------------------------------------------
  it("Soothsayer (773): floors super-effective to 0.5x, leaves resisted hits alone, for 3 turns", async () => {
    // Aggron (Steel/Rock): Fighting = 4x (super-effective), Normal = 0.5x (resisted).
    game.override.ability(AbilityId.BALL_FETCH).enemySpecies(SpeciesId.AGGRON).enemyAbility(SOOTHSAYER);
    await game.classicMode.startBattle(SpeciesId.MACHAMP);
    const player = game.field.getPlayerPokemon();
    const enemy = game.field.getEnemyPokemon();
    const se = allMoves[MoveId.SUPERPOWER]; // Fighting → 4x vs Steel/Rock
    const resisted = allMoves[MoveId.TACKLE]; // Normal → 0.5x vs Steel/Rock
    // Natural (unfloored) type-chart multipliers — read from getAttackTypeEffectiveness
    // so the assertions are chart-agnostic.
    const natSe = enemy.getAttackTypeEffectiveness(player.getMoveType(se), { source: player });
    const natResisted = enemy.getAttackTypeEffectiveness(player.getMoveType(resisted), { source: player });
    expect(natSe).toBeGreaterThan(0.5); // sanity: super-effective
    expect(natResisted).toBeLessThanOrEqual(0.5); // sanity: resisted

    // Turn 1 (window open): the super-effective hit is floored DOWN to 0.5.
    enemy.tempSummonData.turnCount = 1;
    enemy.turnData.moveEffectiveness = null;
    expect(enemy.getMoveEffectiveness(player, se, false, false)).toBe(0.5);

    // A resisted hit is left at its natural value (a flat x0.5 would over-reduce it).
    enemy.turnData.moveEffectiveness = null;
    expect(enemy.getMoveEffectiveness(player, resisted, false, false)).toBe(natResisted);

    // Turn 3 is still inside the 3-turn window.
    enemy.tempSummonData.turnCount = 3;
    enemy.turnData.moveEffectiveness = null;
    expect(enemy.getMoveEffectiveness(player, se, false, false)).toBe(0.5);

    // Turn 4 — the window has closed; the natural super-effective multiplier returns.
    enemy.tempSummonData.turnCount = 4;
    enemy.turnData.moveEffectiveness = null;
    expect(enemy.getMoveEffectiveness(player, se, false, false)).toBe(natSe);
  });

  // ---------------------------------------------------------------------------
  // #56 — Drakelp Head (932): the FIRST damaging hit is halved and drops that
  // attacker's Attack once; every later hit is full and drops nothing more.
  // A SPECIAL attacker isolates the damage (the -1 Attack never touches its
  // Special-Attack damage).
  // ---------------------------------------------------------------------------
  it("Drakelp Head (932): first hit halved + attacker ATK-1 once; second hit full, no further drop", async () => {
    game.override
      .ability(AbilityId.BALL_FETCH)
      .enemySpecies(SpeciesId.SNORLAX) // bulky, survives two special hits
      .enemyAbility(DRAKELP_HEAD)
      .enemyMoveset(MoveId.SPLASH);
    await game.classicMode.startBattle(SpeciesId.ALAKAZAM);
    const player = game.field.getPlayerPokemon();
    const enemy = game.field.getEnemyPokemon();

    // Turn 1 — first damaging hit.
    const hpBefore1 = enemy.hp;
    game.move.use(MoveId.PSYCHIC);
    await game.toEndOfTurn();
    const dmg1 = hpBefore1 - enemy.hp;
    expect(player.getStatStage(Stat.ATK)).toBe(-1); // attacker's ATK dropped once

    // Turn 2 — the one-shot is spent: full damage, no further ATK drop.
    const hpBefore2 = enemy.hp;
    game.move.use(MoveId.PSYCHIC);
    await game.toEndOfTurn();
    const dmg2 = hpBefore2 - enemy.hp;

    expect(player.getStatStage(Stat.ATK)).toBe(-1); // still -1, not -2
    expect(dmg1).toBeGreaterThan(0);
    // Second (full) hit is markedly larger than the first (halved) hit.
    expect(dmg2).toBeGreaterThan(dmg1 * 1.6);
  });

  // ---------------------------------------------------------------------------
  // #54 — Gleam Eyes (707): a foe's held berry cannot be consumed while the
  // holder is on the field. With the foe already below its Sitrus threshold, its
  // BerryPhase check runs each turn — WITHOUT Gleam Eyes the berry is eaten, WITH
  // it the consumption is suppressed. (`berriesEaten` is the unambiguous signal.)
  // ---------------------------------------------------------------------------
  it("Gleam Eyes (707): suppresses the foe's Sitrus Berry (never consumed)", async () => {
    game.override
      .ability(GLEAM_EYES)
      .enemySpecies(SpeciesId.SNORLAX)
      .enemyAbility(AbilityId.BALL_FETCH)
      .enemyMoveset(MoveId.SPLASH)
      .enemyHeldItems([{ name: "BERRY", type: BerryType.SITRUS, count: 1 }]);
    await game.classicMode.startBattle(SpeciesId.ALAKAZAM);
    const enemy = game.field.getEnemyPokemon();
    enemy.hp = Math.floor(enemy.getMaxHp() * 0.4); // below Sitrus's 50% threshold

    game.move.use(MoveId.SPLASH);
    await game.toEndOfTurn();

    // The berry was NOT consumed and did not heal the foe above the threshold.
    expect(enemy.battleData.berriesEaten).not.toContain(BerryType.SITRUS);
    expect(enemy.getHpRatio()).toBeLessThan(0.5);
  });

  it("Gleam Eyes control: WITHOUT it, the foe's Sitrus Berry IS consumed", async () => {
    game.override
      .ability(AbilityId.BALL_FETCH)
      .enemySpecies(SpeciesId.SNORLAX)
      .enemyAbility(AbilityId.BALL_FETCH)
      .enemyMoveset(MoveId.SPLASH)
      .enemyHeldItems([{ name: "BERRY", type: BerryType.SITRUS, count: 1 }]);
    await game.classicMode.startBattle(SpeciesId.ALAKAZAM);
    const enemy = game.field.getEnemyPokemon();
    enemy.hp = Math.floor(enemy.getMaxHp() * 0.4);

    game.move.use(MoveId.SPLASH);
    await game.toEndOfTurn();

    // The vanilla berry path is intact: Sitrus eaten and its heal applied.
    expect(enemy.battleData.berriesEaten).toContain(BerryType.SITRUS);
  });

  // ---------------------------------------------------------------------------
  // #60a — Lead Coat (296): triples the holder's weight (mirrors Chrome Coat 539).
  // ---------------------------------------------------------------------------
  it("Lead Coat (296): triples the holder's weight", async () => {
    game.override.ability(AbilityId.BALL_FETCH).enemySpecies(SpeciesId.SNORLAX).enemyAbility(LEAD_COAT);
    await game.classicMode.startBattle(SpeciesId.MACHAMP);
    const enemy = game.field.getEnemyPokemon();
    // Snorlax base weight is 460 kg; Lead Coat's WeightMultiplierAbAttr(3) → 1380 kg.
    expect(enemy.getWeight()).toBeCloseTo(enemy.species.weight * 3, 1);
  });

  it("regression: vanilla Heavy Metal still only DOUBLES weight (shared primitive intact)", async () => {
    game.override.ability(AbilityId.BALL_FETCH).enemySpecies(SpeciesId.SNORLAX).enemyAbility(AbilityId.HEAVY_METAL);
    await game.classicMode.startBattle(SpeciesId.MACHAMP);
    const enemy = game.field.getEnemyPokemon();
    expect(enemy.getWeight()).toBeCloseTo(enemy.species.weight * 2, 1);
  });

  // ---------------------------------------------------------------------------
  // #60b — Evaporate (444): while its Mist is up, the immunity also shields the
  // doubles PARTNER's self-inflicted stat drops (not just the holder's).
  // ---------------------------------------------------------------------------
  it("Evaporate (444): with Mist up, the ally's Overheat self-drop is blocked", async () => {
    game.override
      .battleStyle("double")
      .ability(EVAPORATE)
      .moveset([MoveId.SPLASH, MoveId.OVERHEAT])
      .enemySpecies(SpeciesId.SNORLAX)
      .enemyAbility(AbilityId.BALL_FETCH)
      .enemyMoveset(MoveId.SPLASH);
    await game.classicMode.startBattle(SpeciesId.BLASTOISE, SpeciesId.CHARIZARD);
    const [holder, ally] = game.scene.getPlayerField();
    // Raise the Evaporate holder's Mist (the same tag Evaporate sets when hit by Water).
    game.scene.arena.addTag(ArenaTagType.MIST, 5, MoveId.NONE, holder.id, ArenaTagSide.PLAYER, true);

    game.move.select(MoveId.SPLASH, 0);
    game.move.select(MoveId.OVERHEAT, 1, BattlerIndex.ENEMY);
    await game.toEndOfTurn();

    // Overheat's self SpAtk -2 is cancelled for the ally by the holder's field Mist.
    expect(ally.getStatStage(Stat.SPATK)).toBe(0);
  });

  it("Evaporate control: WITHOUT Mist, the ally's Overheat self-drop applies (-2)", async () => {
    game.override
      .battleStyle("double")
      .ability(EVAPORATE)
      .moveset([MoveId.SPLASH, MoveId.OVERHEAT])
      .enemySpecies(SpeciesId.SNORLAX)
      .enemyAbility(AbilityId.BALL_FETCH)
      .enemyMoveset(MoveId.SPLASH);
    await game.classicMode.startBattle(SpeciesId.BLASTOISE, SpeciesId.CHARIZARD);
    const [, ally] = game.scene.getPlayerField();
    // No Mist raised → the immunity is inert (it is gated on the holder's Mist).

    game.move.select(MoveId.SPLASH, 0);
    game.move.select(MoveId.OVERHEAT, 1, BattlerIndex.ENEMY);
    await game.toEndOfTurn();

    expect(ally.getStatStage(Stat.SPATK)).toBe(-2);
  });

  it("Evaporate control: Mist alone (non-Evaporate holder) does NOT block the ally's self-drop", async () => {
    // Proves the ally coverage is Evaporate's field attr, not vanilla Mist (which
    // only blocks OTHER-source drops).
    game.override
      .battleStyle("double")
      .ability(AbilityId.BALL_FETCH)
      .moveset([MoveId.SPLASH, MoveId.OVERHEAT])
      .enemySpecies(SpeciesId.SNORLAX)
      .enemyAbility(AbilityId.BALL_FETCH)
      .enemyMoveset(MoveId.SPLASH);
    await game.classicMode.startBattle(SpeciesId.BLASTOISE, SpeciesId.CHARIZARD);
    const [holder, ally] = game.scene.getPlayerField();
    game.scene.arena.addTag(ArenaTagType.MIST, 5, MoveId.NONE, holder.id, ArenaTagSide.PLAYER, true);

    game.move.select(MoveId.SPLASH, 0);
    game.move.select(MoveId.OVERHEAT, 1, BattlerIndex.ENEMY);
    await game.toEndOfTurn();

    expect(ally.getStatStage(Stat.SPATK)).toBe(-2);
  });
});
