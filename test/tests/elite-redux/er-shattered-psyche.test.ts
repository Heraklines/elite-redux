/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// ER Shattered Psyche (5968, Primal Mew's innate) - combat harness coverage.
//
//   - DOUBLES: the two enemy field mons fuse into one entity with COMBINED HP;
//     the fused entity takes BOTH mons' actions (two moves) that turn.
//   - SINGLES: the active opponent fuses with a SEEDED bench pick; combined HP.
//   - Un-fuse: HP splits back proportionally (pure splitFusedHp + a live entity).
//   - Once per battle: it does not re-fuse on a later turn.
//   - No bench (singles, lone foe): no-op, and the once-per-battle use is NOT
//     consumed (it can still fire once a bench mon exists).
//
// Forced ACTIVE via override (player innates are inert in a scenario unless
// forced - the documented gotcha). Gated ER_SCENARIO=1.
// =============================================================================

import { globalScene } from "#app/global-scene";
import {
  ER_SHATTERED_PSYCHE_ABILITY_ID,
  erShatteredPsycheOnLeaveField,
  splitFusedHp,
} from "#data/elite-redux/abilities/shattered-psyche";
import { AbilityId } from "#enums/ability-id";
import { MoveId } from "#enums/move-id";
import { SpeciesId } from "#enums/species-id";
import { TrainerSlot } from "#enums/trainer-slot";
import { GameManager } from "#test/framework/game-manager";
import { getPokemonSpecies } from "#utils/pokemon-utils";
import Phaser from "phaser";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

const RUN = process.env.ER_SCENARIO === "1";
const SHATTERED = ER_SHATTERED_PSYCHE_ABILITY_ID as AbilityId;

describe("ER Shattered Psyche - splitFusedHp (pure)", () => {
  it("splits proportionally to each constituent's original max and sums to the input", () => {
    // Equal maxes -> even split.
    expect(splitFusedHp(100, 100, 100)).toEqual({ primaryHp: 50, constituentHp: 50 });
    // 3:1 max ratio -> 3:1 hp share, exact sum.
    const r = splitFusedHp(80, 150, 50);
    expect(r.primaryHp + r.constituentHp).toBe(80);
    expect(r.primaryHp).toBe(60);
    expect(r.constituentHp).toBe(20);
    // Zero / degenerate inputs are safe.
    expect(splitFusedHp(0, 100, 100)).toEqual({ primaryHp: 0, constituentHp: 0 });
    expect(splitFusedHp(40, 0, 0)).toEqual({ primaryHp: 40, constituentHp: 0 });
  });
});

describe.skipIf(!RUN)("ER Shattered Psyche (5968)", () => {
  let phaserGame: Phaser.Game;
  let game: GameManager;

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });

  beforeEach(() => {
    game = new GameManager(phaserGame);
    game.override
      .criticalHits(false)
      .startingLevel(100)
      .enemyLevel(100)
      .ability(SHATTERED)
      .enemyAbility(AbilityId.BALL_FETCH)
      .enemyMoveset(MoveId.TACKLE);
  });

  it("doubles: the two enemy mons fuse into one entity with combined HP + two actions", async () => {
    game.override.battleStyle("double").enemySpecies(SpeciesId.SNORLAX).moveset([MoveId.SPLASH]);
    await game.classicMode.startBattle(SpeciesId.MEW, SpeciesId.SNORLAX);
    const [e0, e1] = game.scene.getEnemyField();
    const aMax = e0.getMaxHp();
    const bMax = e1.getMaxHp();
    expect(aMax).toBeGreaterThan(0);

    game.move.select(MoveId.SPLASH, 0);
    game.move.select(MoveId.SPLASH, 1);
    await game.toEndOfTurn();

    // One enemy was absorbed (fainted); the survivor carries the combined max HP.
    const active = game.scene.getEnemyField().filter(e => e?.isActive(true));
    expect(active.length, "one fused enemy entity remains").toBe(1);
    const survivor = active[0];
    expect(survivor.getMaxHp(), "combined max HP").toBe(aMax + bMax);
    // The fused entity took BOTH actions this turn (two moves used).
    expect(survivor.getMoveHistory().length, "two moves this turn").toBeGreaterThanOrEqual(2);
  });

  it("doubles: proportional un-fuse restores the entity's own max + share when it leaves the field", async () => {
    game.override.battleStyle("double").enemySpecies(SpeciesId.SNORLAX).moveset([MoveId.SPLASH]);
    await game.classicMode.startBattle(SpeciesId.MEW, SpeciesId.SNORLAX);
    const [e0, e1] = game.scene.getEnemyField();
    const aMax = e0.getMaxHp();
    const bMax = e1.getMaxHp();

    game.move.select(MoveId.SPLASH, 0);
    game.move.select(MoveId.SPLASH, 1);
    await game.toEndOfTurn();

    const survivor = game.scene.getEnemyField().find(e => e?.isActive(true))!;
    expect(survivor.getMaxHp()).toBe(aMax + bMax);
    // Set the fused entity to half its combined HP, then un-fuse it.
    survivor.hp = Math.floor((aMax + bMax) / 2);
    const combinedHp = survivor.hp;
    erShatteredPsycheOnLeaveField(survivor);

    // Its own max HP is restored, and the HP is its proportional share.
    expect(survivor.getMaxHp(), "own max restored").toBe(aMax);
    expect(survivor.hp, "proportional share").toBe(splitFusedHp(combinedHp, aMax, bMax).primaryHp);
    expect(survivor.fusionSpecies, "blended look cleared").toBeNull();
  });

  it("doubles: it fuses only ONCE per battle (no re-fuse on a later turn)", async () => {
    game.override.battleStyle("double").enemySpecies(SpeciesId.SNORLAX).moveset([MoveId.SPLASH]);
    await game.classicMode.startBattle(SpeciesId.MEW, SpeciesId.SNORLAX);
    const [e0, e1] = game.scene.getEnemyField();
    const combined = e0.getMaxHp() + e1.getMaxHp();

    game.move.select(MoveId.SPLASH, 0);
    game.move.select(MoveId.SPLASH, 1);
    await game.toNextTurn();
    const survivor = game.scene.getEnemyField().find(e => e?.isActive(true))!;
    expect(survivor.getMaxHp()).toBe(combined);

    // Turn 2: no second fusion (nothing left to fuse; max HP unchanged, still one entity).
    game.move.select(MoveId.SPLASH, 0);
    game.move.select(MoveId.SPLASH, 1);
    await game.toEndOfTurn();
    const active = game.scene.getEnemyField().filter(e => e?.isActive(true));
    expect(active.length).toBe(1);
    expect(active[0].getMaxHp(), "max HP unchanged (no re-fuse)").toBe(combined);
  });

  it("singles: the active foe fuses with a seeded bench pick (combined HP, bench mon consumed)", async () => {
    game.override.battleStyle("single").enemySpecies(SpeciesId.SNORLAX).moveset([MoveId.SPLASH]);
    await game.classicMode.startBattle(SpeciesId.MEW);
    const active = game.scene.getEnemyPokemon()!;
    // Add a benched enemy so the singles fusion has a bench mon to pull.
    const reserve = globalScene.addEnemyPokemon(getPokemonSpecies(SpeciesId.MUNCHLAX), 100, TrainerSlot.NONE);
    globalScene.getEnemyParty().push(reserve);
    const aMax = active.getMaxHp();
    const bMax = reserve.getMaxHp();
    expect(reserve.isOnField()).toBe(false);

    game.move.select(MoveId.SPLASH, 0);
    await game.toEndOfTurn();

    // The active foe carries the combined HP; the bench mon was absorbed (defeated).
    expect(active.getMaxHp(), "combined max HP").toBe(aMax + bMax);
    expect(active.fusionSpecies?.speciesId, "blended with the bench mon").toBe(SpeciesId.MUNCHLAX);
    expect(reserve.isFainted(), "bench mon consumed").toBe(true);
  });

  it("singles: a lone foe with NO bench does nothing and does not consume the use", async () => {
    game.override.battleStyle("single").enemySpecies(SpeciesId.SNORLAX).moveset([MoveId.SPLASH]);
    await game.classicMode.startBattle(SpeciesId.MEW);
    const active = game.scene.getEnemyPokemon()!;
    const aMax = active.getMaxHp();

    // Turn 1: no bench -> no fusion.
    game.move.select(MoveId.SPLASH, 0);
    await game.toNextTurn();
    expect(active.getMaxHp(), "no fusion (no bench)").toBe(aMax);
    expect(active.fusionSpecies ?? null, "not fused").toBeNull();

    // Add a bench mon; the un-consumed use fires on the next turn.
    const reserve = globalScene.addEnemyPokemon(getPokemonSpecies(SpeciesId.MUNCHLAX), 100, TrainerSlot.NONE);
    globalScene.getEnemyParty().push(reserve);
    const bMax = reserve.getMaxHp();

    game.move.select(MoveId.SPLASH, 0);
    await game.toEndOfTurn();
    expect(active.getMaxHp(), "fuses once the bench exists").toBe(aMax + bMax);
    expect(reserve.isFainted()).toBe(true);
  });
});
