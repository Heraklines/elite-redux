/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// Multi-Headed (ER 347): "Attack 2-3 times based on heads. 3-headed: 1st 100%,
// 2nd 20%, 3rd 15% (2-headed: 100%/25%)." Pokerogue's AddSecondStrike (Parental
// Bond) deals FULL damage on every strike, so Multi-Headed hit 3× at 100% — the
// later strikes must be scaled down. We assert via getAttackDamage at each strike
// index. Gated behind ER_SCENARIO=1.
import { allMoves } from "#data/data-lists";
import { ER_ID_MAP } from "#data/elite-redux/er-id-map";
import { AbilityId } from "#enums/ability-id";
import { MoveId } from "#enums/move-id";
import { SpeciesId } from "#enums/species-id";
import type { Pokemon } from "#field/pokemon";
import { GameManager } from "#test/framework/game-manager";
import Phaser from "phaser";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

const RUN = process.env.ER_SCENARIO === "1";

describe.skipIf(!RUN)("ER Multi-Headed (347) — later strikes deal reduced damage", () => {
  let phaserGame: Phaser.Game;
  let game: GameManager;

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });

  beforeEach(() => {
    game = new GameManager(phaserGame);
    game.override
      .criticalHits(false)
      .battleStyle("single")
      .enemySpecies(SpeciesId.SNORLAX)
      .enemyAbility(AbilityId.BALL_FETCH)
      .enemyLevel(100)
      .enemyMoveset(MoveId.SPLASH)
      .startingLevel(100)
      .moveset([MoveId.TACKLE]);
  });

  // Damage of a single strike at `hitsLeft` (3 total → hitsLeft 3=1st, 2=2nd, 1=3rd).
  const strike = (atk: Pokemon, tgt: Pokemon, hitsLeft: number): number => {
    atk.turnData.hitCount = 3;
    atk.turnData.hitsLeft = hitsLeft;
    return tgt.getAttackDamage({ source: atk, move: allMoves[MoveId.TACKLE] }).damage;
  };

  it("3-headed: 2nd strike ~20% and 3rd ~15% of the full 1st strike", async () => {
    game.override.ability(ER_ID_MAP.abilities[347] as AbilityId); // Multi-Headed
    await game.classicMode.startBattle([SpeciesId.MAGIKARP]);
    const atk = game.field.getPlayerPokemon();
    const tgt = game.field.getEnemyPokemon();

    const d0 = strike(atk, tgt, 3); // 1st head — full
    const d1 = strike(atk, tgt, 2); // 2nd head — ~20%
    const d2 = strike(atk, tgt, 1); // 3rd head — ~15%

    expect(d0).toBeGreaterThan(0);
    expect(d1).toBeLessThan(d0 * 0.3); // clearly reduced (~0.2, robust vs damage roll)
    expect(d2).toBeLessThan(d1); // 3rd (0.15) < 2nd (0.20)
  });

  it("does NOT reduce later strikes for a non-Multi-Headed attacker", async () => {
    game.override.ability(AbilityId.BALL_FETCH);
    await game.classicMode.startBattle([SpeciesId.MAGIKARP]);
    const atk = game.field.getPlayerPokemon();
    const tgt = game.field.getEnemyPokemon();

    const d0 = strike(atk, tgt, 3);
    const d1 = strike(atk, tgt, 2);
    // No Multi-Headed → both strikes full power (only the damage roll varies).
    expect(d1).toBeGreaterThan(d0 * 0.7);
  });
});
