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
  erShatteredPsycheEndBattle,
  erShatteredPsycheIsAbsorbed,
  erShatteredPsycheOnLeaveField,
  splitFusedHp,
} from "#data/elite-redux/abilities/shattered-psyche";
import { AbilityId } from "#enums/ability-id";
import { BattleType } from "#enums/battle-type";
import { MoveId } from "#enums/move-id";
import { SpeciesId } from "#enums/species-id";
import { TrainerSlot } from "#enums/trainer-slot";
import { TrainerType } from "#enums/trainer-type";
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
      .startingWave(2)
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

    // One enemy was absorbed without being treated as fainted; the survivor
    // carries the combined max HP.
    const active = game.scene.getEnemyField().filter(e => e?.isActive(true));
    expect(active.length, "one fused enemy entity remains").toBe(1);
    const survivor = active[0];
    expect(survivor.getMaxHp(), "combined max HP").toBe(aMax + bMax);
    expect(e1.isFainted(), "temporary absorption is not a KO").toBe(false);
    expect(e1.hp, "the absorbed constituent keeps its own HP until the split").toBeGreaterThan(0);
    expect(erShatteredPsycheIsAbsorbed(e1), "constituent is temporarily unavailable").toBe(true);
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
    const primaryMoves = survivor.getMoveset(true).map(m => m.moveId);
    const constituentMoves = e1.getMoveset(true).map(m => m.moveId);
    expect(survivor.getMaxHp()).toBe(aMax + bMax);
    // Set the fused entity to half its combined HP, then un-fuse it.
    survivor.hp = Math.floor((aMax + bMax) / 2);
    const combinedHp = survivor.hp;
    erShatteredPsycheOnLeaveField(survivor);

    const split = splitFusedHp(combinedHp, aMax, bMax);
    // Both mons, their field seats, and their exact movesets are restored.
    expect(survivor.getMaxHp(), "own max restored").toBe(aMax);
    expect(survivor.hp, "primary proportional share").toBe(split.primaryHp);
    expect(e1.hp, "constituent proportional share").toBe(split.constituentHp);
    expect(e1.isOnField(), "the absorbed field seat is restored").toBe(true);
    expect(e1.isAllowedInBattle(), "the constituent is battle-eligible again").toBe(true);
    expect(survivor.getMoveset(true).map(m => m.moveId)).toEqual(primaryMoves);
    expect(e1.getMoveset(true).map(m => m.moveId)).toEqual(constituentMoves);
    expect(survivor.fusionSpecies ?? null, "blended look cleared").toBeNull();
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

  it("trainer doubles: absorption does not summon a reserve or run a fake KO", async () => {
    game.override
      .battleType(BattleType.TRAINER)
      .randomTrainer({ trainerType: TrainerType.ACE_TRAINER })
      .battleStyle("double")
      .enemySpecies(SpeciesId.SNORLAX)
      .moveset([MoveId.SPLASH]);
    await game.classicMode.startBattle(SpeciesId.MEW, SpeciesId.SNORLAX);
    // Ability overrides apply to the whole player field; this regression needs one Primal Mew holder,
    // not two independent Shattered Psyche activations consuming both an active and the reserve.
    game.scene.getPlayerField()[1].summonData.ability = AbilityId.BALL_FETCH;

    const field = game.scene.getEnemyField();
    expect(field).toHaveLength(2);
    game.scene.currentBattle.enemyParty.length = 2;
    const absorbed = field[1];
    const reserve = globalScene.addEnemyPokemon(getPokemonSpecies(SpeciesId.MUNCHLAX), 100, absorbed.trainerSlot);
    game.scene.currentBattle.enemyParty.push(reserve);
    expect(reserve.isActive(), "the fixture reserve is battle-eligible").toBe(true);
    expect(reserve.trainerSlot, "the fixture reserve belongs to the absorbed slot's trainer").toBe(
      absorbed.trainerSlot,
    );

    game.move.select(MoveId.SPLASH, 0);
    game.move.select(MoveId.SPLASH, 1);
    await game.toNextTurn();

    expect(absorbed.isFainted(), "the absorbed mon was not fainted").toBe(false);
    expect(erShatteredPsycheIsAbsorbed(absorbed)).toBe(true);
    expect(reserve.isOnField(), "no reserve replaces a constituent that is still fused").toBe(false);
    expect(game.scene.getEnemyField(true)).toHaveLength(1);
    expect(game.scene.currentBattle.turn).toBeGreaterThan(1);
  });

  it("singles: the active foe temporarily absorbs a seeded bench pick", async () => {
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

    // The active foe carries the combined HP; the bench mon remains alive but
    // cannot be independently summoned while contained in the fusion.
    expect(active.getMaxHp(), "combined max HP").toBe(aMax + bMax);
    expect(active.fusionSpecies?.speciesId, "blended with the bench mon").toBe(SpeciesId.MUNCHLAX);
    expect(reserve.isFainted(), "bench mon was not defeated").toBe(false);
    expect(reserve.isAllowedInBattle(), "bench mon is unavailable during fusion").toBe(false);
    expect(erShatteredPsycheIsAbsorbed(reserve)).toBe(true);

    erShatteredPsycheEndBattle();
    expect(active.getMaxHp(), "battle boundary restores primary max HP").toBe(aMax);
    expect(active.fusionSpecies ?? null, "battle boundary clears the temporary look").toBeNull();
    expect(reserve.isAllowedInBattle(), "bench constituent is restored before rewards").toBe(true);
    expect(active.hp + reserve.hp, "the split conserves combined current HP").toBeLessThanOrEqual(aMax + bMax);
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
    expect(reserve.isFainted()).toBe(false);
    expect(erShatteredPsycheIsAbsorbed(reserve)).toBe(true);
  });

  it("restores a real DNA fusion instead of erasing it during defusion", async () => {
    game.override.battleStyle("double").enemySpecies(SpeciesId.SNORLAX).moveset([MoveId.SPLASH]);
    await game.classicMode.startBattle(SpeciesId.MEW, SpeciesId.SNORLAX);
    const [primary, constituent] = game.scene.getEnemyField();
    const originalFusion = getPokemonSpecies(SpeciesId.EEVEE);
    primary.fusionSpecies = originalFusion;
    primary.fusionFormIndex = 0;
    primary.fusionAbilityIndex = 1;
    primary.fusionShiny = true;
    primary.fusionVariant = 2;
    primary.generateName();
    primary.calculateStats();

    game.move.select(MoveId.SPLASH, 0);
    game.move.select(MoveId.SPLASH, 1);
    await game.toEndOfTurn();
    expect(primary.fusionSpecies?.speciesId).toBe(constituent.species.speciesId);

    erShatteredPsycheOnLeaveField(primary);
    expect(primary.fusionSpecies).toBe(originalFusion);
    expect(primary.fusionAbilityIndex).toBe(1);
    expect(primary.fusionShiny).toBe(true);
    expect(primary.fusionVariant).toBe(2);
  });

  it("reaches the reward screen with both player field seats and moves restored", async () => {
    game.override
      .battleType(BattleType.TRAINER)
      .randomTrainer({ trainerType: TrainerType.ACE_TRAINER })
      .battleStyle("double")
      .ability(AbilityId.BALL_FETCH)
      .enemyAbility(SHATTERED)
      .enemySpecies(SpeciesId.MEW)
      .moveset([MoveId.SPLASH, MoveId.TACKLE]);
    await game.classicMode.startBattle(SpeciesId.SNORLAX, SpeciesId.EEVEE);
    game.scene.currentBattle.enemyParty.length = 2;
    // Only one enemy holder is needed for this boundary regression.
    game.scene.getEnemyField()[1].summonData.ability = AbilityId.BALL_FETCH;

    const [lead, partner] = game.scene.getPlayerField();
    const leadMoves = lead.getMoveset(true).map(m => m.moveId);
    const partnerMoves = partner.getMoveset(true).map(m => m.moveId);

    game.move.select(MoveId.SPLASH, 0);
    game.move.select(MoveId.SPLASH, 1);
    await game.toEndOfTurn();
    expect(erShatteredPsycheIsAbsorbed(partner)).toBe(true);

    await game.doKillOpponents();
    await game.phaseInterceptor.to("SelectModifierPhase", false);

    expect(game.isCurrentPhase("SelectModifierPhase"), "the normal reward screen opens").toBe(true);
    expect(lead.fusionSpecies ?? null, "temporary fusion identity is gone before rewards").toBeNull();
    expect(lead.isOnField(), "lead remains in its own field seat").toBe(true);
    expect(partner.isOnField(), "partner returns to its distinct field seat").toBe(true);
    expect(partner.isAllowedInBattle()).toBe(true);
    expect(lead.getMoveset(true).map(m => m.moveId)).toEqual(leadMoves);
    expect(partner.getMoveset(true).map(m => m.moveId)).toEqual(partnerMoves);
  });
});
