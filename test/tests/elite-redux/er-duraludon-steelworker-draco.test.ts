/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Mega Duraludon tester reports (ER 2.65 dex is authority):
//
// 1. STEELWORKER (id 200) - dex: "Normal moves become Steel. Steel resists Ghost
//    and Dark." Our port grants a Steel-type holder a 0.5x damage multiplier vs
//    Ghost and Dark (ReceivedTypeDamageMultiplierAbAttr, gated on isOfType STEEL).
//    ABILITY-granted resist (like Thick Fat), NOT a global type-chart change, so
//    the base "not very effective" text stays silent - consistent with every other
//    ability-based resist. We prove the MATH deterministically via getAttackDamage
//    (toggling ONLY the defender's ability): Ghost/Dark deal HALF damage.
//
// 2. DRACO MORALE (id 670 / ErAbilityId.DRACO_MORALE) - dex: "Uses Dragon Cheer on
//    switch-in." Dragon Cheer grants a CRIT-STAGE boost (CritBoostTag), which is
//    NOT one of the 7 stat stages - so it correctly never shows a stat-arrow. Its
//    feedback is the "is getting pumped!" message (identical to Focus Energy) plus
//    (post popup-fix) the ability banner. We prove the crit tag applies + message.
//
// Gated behind ER_SCENARIO=1.
// =============================================================================

import { allMoves } from "#data/data-lists";
import { AbilityId } from "#enums/ability-id";
import { BattlerTagType } from "#enums/battler-tag-type";
import { ErAbilityId } from "#enums/er-ability-id";
import { MoveId } from "#enums/move-id";
import { PokemonType } from "#enums/pokemon-type";
import { SpeciesId } from "#enums/species-id";
import type { Pokemon } from "#field/pokemon";
import { GameManager } from "#test/framework/game-manager";
import { getPokemonSpecies } from "#utils/pokemon-utils";
import Phaser from "phaser";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const RUN = process.env.ER_SCENARIO === "1";

function duraludonMegaFormIndex(): number {
  const idx = getPokemonSpecies(SpeciesId.DURALUDON).forms.findIndex(f => f.formKey === "mega");
  return idx < 0 ? 0 : idx;
}

/**
 * Deterministic damage the defender would take from `source`'s `move`, with the
 * defender's own ability effects ON (`ignoreAbility:false`) or OFF (`true`). The
 * attacker's contribution is identical in both calls, so the ratio isolates the
 * defender ability (Steelworker's Ghost/Dark resist). Uses a fixed damage roll.
 */
function defenderDamage(defender: Pokemon, source: Pokemon, moveId: MoveId, defenderAbilityOn: boolean): number {
  return defender.getAttackDamage({
    source,
    move: allMoves[moveId],
    ignoreAbility: !defenderAbilityOn,
    isCritical: false,
    simulated: true,
    forcedRandomMultiplier: 1,
  }).damage;
}

describe.skipIf(!RUN)("Steelworker resist (Steel-type holder) - ER 2.65 dex", () => {
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
      .ability(AbilityId.STEELWORKER)
      .enemySpecies(SpeciesId.GENGAR)
      .enemyAbility(AbilityId.BALL_FETCH)
      .enemyLevel(100)
      .startingLevel(100);
  });

  it("Registeel (pure Steel) with Steelworker takes HALF from Ghost and Dark", async () => {
    await game.classicMode.startBattle(SpeciesId.REGISTEEL);
    const player = game.field.getPlayerPokemon();
    const enemy = game.field.getEnemyPokemon();
    expect(player.getAbility().id).toBe(AbilityId.STEELWORKER);
    expect(player.isOfType(PokemonType.STEEL)).toBe(true);

    for (const moveId of [MoveId.SHADOW_BALL, MoveId.DARK_PULSE]) {
      const withResist = defenderDamage(player, enemy, moveId, true);
      const withoutResist = defenderDamage(player, enemy, moveId, false);
      expect(withoutResist).toBeGreaterThan(0);
      // Steelworker halves the incoming Ghost/Dark hit.
      expect(withResist).toBeGreaterThanOrEqual(Math.floor(withoutResist * 0.5) - 1);
      expect(withResist).toBeLessThanOrEqual(Math.ceil(withoutResist * 0.5) + 1);
    }
  });

  it("Steelworker's resist is ABILITY-based: the base type chart stays neutral (no 'not very effective')", async () => {
    await game.classicMode.startBattle(SpeciesId.REGISTEEL);
    const player = game.field.getPlayerPokemon();
    const enemy = game.field.getEnemyPokemon();
    // Ghost/Dark vs pure Steel is neutral on the modern chart; the resist lives in
    // the ability, NOT the chart, so getMoveEffectiveness is 1 (hence no message).
    expect(player.getMoveEffectiveness(enemy, allMoves[MoveId.SHADOW_BALL])).toBe(1);
    expect(player.getMoveEffectiveness(enemy, allMoves[MoveId.DARK_PULSE])).toBe(1);
  });

  it("non-Steel Steelworker holder does NOT get the resist (dex: 'if the user is Steel-type')", async () => {
    game.override.ability(AbilityId.STEELWORKER);
    await game.classicMode.startBattle(SpeciesId.PIKACHU); // pure Electric, not Steel
    const player = game.field.getPlayerPokemon();
    const enemy = game.field.getEnemyPokemon();
    expect(player.isOfType(PokemonType.STEEL)).toBe(false);

    const withAbility = defenderDamage(player, enemy, MoveId.SHADOW_BALL, true);
    const withoutAbility = defenderDamage(player, enemy, MoveId.SHADOW_BALL, false);
    // No Steel typing -> no Ghost resist -> damage unchanged by the ability.
    expect(withAbility).toBe(withoutAbility);
  });
});

describe.skipIf(!RUN)("Mega Duraludon - Steelworker innate resist + Draco Morale crit boost", () => {
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
      .starterForms({ [SpeciesId.DURALUDON]: duraludonMegaFormIndex() })
      .enemySpecies(SpeciesId.GENGAR)
      .enemyAbility(AbilityId.BALL_FETCH)
      .enemyLevel(100)
      .startingLevel(100);
  });

  it("Mega Duraludon is Steel/Dragon and Steelworker halves its incoming Ghost/Dark", async () => {
    // Force Steelworker as active AND passive so the mega form's own ability list
    // can't shadow it (the real form carries Steelworker as an innate).
    game.override.ability(AbilityId.STEELWORKER).passiveAbility(AbilityId.STEELWORKER);
    await game.classicMode.startBattle(SpeciesId.DURALUDON);
    const player = game.field.getPlayerPokemon();
    const enemy = game.field.getEnemyPokemon();
    expect(player.isOfType(PokemonType.STEEL)).toBe(true);
    expect(player.isOfType(PokemonType.DRAGON)).toBe(true);

    for (const moveId of [MoveId.SHADOW_BALL, MoveId.DARK_PULSE]) {
      const withResist = defenderDamage(player, enemy, moveId, true);
      const withoutResist = defenderDamage(player, enemy, moveId, false);
      expect(withoutResist).toBeGreaterThan(0);
      expect(withResist).toBeGreaterThanOrEqual(Math.floor(withoutResist * 0.5) - 1);
      expect(withResist).toBeLessThanOrEqual(Math.ceil(withoutResist * 0.5) + 1);
    }
  });

  it("Draco Morale casts Dragon Cheer on entry: crit-stage tag applies + 'pumped' message fires", async () => {
    game.override.ability(ErAbilityId.DRACO_MORALE as unknown as AbilityId).enemyMoveset(MoveId.SPLASH);
    const messageSpy = vi.spyOn(game.scene.phaseManager, "queueMessage");
    await game.classicMode.startBattle(SpeciesId.DURALUDON);
    const player = game.field.getPlayerPokemon();

    // Dragon Cheer's crit-stage boost is applied as a CritBoostTag (NOT a stat stage,
    // so it correctly shows no stat-arrow on the battle screen).
    const tag = player.getTag(BattlerTagType.DRAGON_CHEER);
    expect(tag).toBeDefined();
    // Mega Duraludon is a Dragon type, so Dragon Cheer grants +2 crit stages.
    expect((tag as unknown as { critStages: number }).critStages).toBe(2);
    // The on-screen feedback is the "is getting pumped!" message (same as Focus Energy).
    const pumped = messageSpy.mock.calls.some(c => typeof c[0] === "string" && /pumped/i.test(c[0]));
    expect(pumped).toBe(true);
  });
});
