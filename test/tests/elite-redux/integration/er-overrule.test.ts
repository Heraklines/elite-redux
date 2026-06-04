/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Overrule 815 — "When this Pokémon's moves land critical hits, they (a) ignore
// defensive abilities that reduce damage AND (b) deal double damage if they are
// resisted." Both effects are crit-gated and live in `Pokemon.getAttackDamage`
// behind the OverruleCritAbAttr marker. We exercise them by calling
// getAttackDamage directly with isCritical true/false.
//
// Gated behind ER_SCENARIO=1.
// =============================================================================

import { allMoves } from "#data/data-lists";
import { ER_ID_MAP } from "#data/elite-redux/er-id-map";
import { AbilityId } from "#enums/ability-id";
import { MoveId } from "#enums/move-id";
import { SpeciesId } from "#enums/species-id";
import { GameManager } from "#test/framework/game-manager";
import Phaser from "phaser";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

const RUN = process.env.ER_SCENARIO === "1";

describe.skipIf(!RUN)("ER Overrule (815)", () => {
  let phaserGame: Phaser.Game;
  let game: GameManager;

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });

  beforeEach(() => {
    game = new GameManager(phaserGame);
  });

  it("on a crit, a RESISTED move deals double damage (negating the resist)", async () => {
    game.override
      .battleStyle("single")
      .ability(ER_ID_MAP.abilities[815] as AbilityId) // Overrule
      .enemySpecies(SpeciesId.REGIROCK) // pure Rock — resists Normal (0.5×)
      .enemyAbility(AbilityId.BALL_FETCH);
    await game.classicMode.startBattle([SpeciesId.MACHAMP]);

    const user = game.field.getPlayerPokemon();
    const enemy = game.field.getEnemyPokemon();
    // Tackle (Normal) vs Regirock (pure Rock): Normal is resisted by Rock → 0.5×.
    const move = allMoves[MoveId.TACKLE];

    const critDmg = enemy.getAttackDamage({ source: user, move, isCritical: true, simulated: true }).damage;
    const nonCritDmg = enemy.getAttackDamage({ source: user, move, isCritical: false, simulated: true }).damage;

    // A normal crit is ×1.5 of a non-crit. With Overrule's resisted-×2 on top, the
    // crit should be ≈ ×3 of the non-crit (1.5 × 2), i.e. well beyond a plain crit.
    expect(critDmg).toBeGreaterThan(nonCritDmg * 2.5);
  });

  it("on a crit, the defender's damage-reducing ability (Multiscale) is ignored", async () => {
    game.override
      .battleStyle("single")
      .ability(ER_ID_MAP.abilities[815] as AbilityId) // Overrule
      .enemySpecies(SpeciesId.DRAGONITE) // Multiscale: halves damage at full HP
      .enemyAbility(AbilityId.MULTISCALE);
    await game.classicMode.startBattle([SpeciesId.MACHAMP]);

    const user = game.field.getPlayerPokemon();
    const enemy = game.field.getEnemyPokemon();
    enemy.hp = enemy.getMaxHp(); // full HP → Multiscale active
    const move = allMoves[MoveId.TACKLE]; // neutral vs Dragon/Flying

    // Crit (Overrule ignores Multiscale) vs crit with abilities NOT ignored
    // (ignoreSourceAbility=true disables Overrule → Multiscale halves).
    const critIgnoring = enemy.getAttackDamage({ source: user, move, isCritical: true, simulated: true }).damage;
    const critWithMultiscale = enemy.getAttackDamage({
      source: user,
      move,
      isCritical: true,
      ignoreSourceAbility: true, // turns Overrule off
      simulated: true,
    }).damage;

    // Ignoring Multiscale ≈ double the damage of the Multiscale-halved crit.
    expect(critIgnoring).toBeGreaterThan(critWithMultiscale * 1.5);
  });
});
