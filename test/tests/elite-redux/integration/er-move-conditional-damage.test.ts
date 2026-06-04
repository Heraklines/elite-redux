/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// #103 / #125 (moves) — ER custom moves with the "conditional-damage" archetype
// (a MovePowerMultiplierAttr gated on a runtime condition). Bravado (957) is the
// Facade analog: "Doubles damage if burned, paralyzed, or poisoned." We pin the
// 2x multiplier by comparing the same move with vs without a status, using
// POISON so the burn attack-drop doesn't confound a physical move.
//
// Damage variance is mocked to a constant so the ratio is deterministic.
// Gated behind ER_SCENARIO=1.
// =============================================================================

import { AbilityId } from "#enums/ability-id";
import { MoveId } from "#enums/move-id";
import { SpeciesId } from "#enums/species-id";
import { StatusEffect } from "#enums/status-effect";
import { Pokemon } from "#field/pokemon";
import { GameManager } from "#test/framework/game-manager";
import Phaser from "phaser";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const RUN_SCENARIOS = process.env.ER_SCENARIO === "1";

async function erMove(id: number): Promise<number | undefined> {
  const erIdMap = (await import("#data/elite-redux/er-id-map")).ER_ID_MAP;
  return erIdMap.moves[id];
}

describe.skipIf(!RUN_SCENARIOS)("ER move conditional-damage (#125)", () => {
  let phaserGame: Phaser.Game;
  let game: GameManager;

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });

  beforeEach(() => {
    game = new GameManager(phaserGame);
  });

  it("Bravado (957): 2x damage when the user is statused", async () => {
    const move = await erMove(957);
    if (move === undefined) {
      return;
    }
    // Use a high-SpAtk attacker (Mewtwo) into a high-HP / moderate-SpDef wall
    // (Wobbuffet) so the per-hit damage is large. The damage formula's additive
    // "+2" term and integer flooring make power->damage badly non-linear at low
    // damage magnitudes (a Snorlax->Snorlax special hit deals ~30, where 2x power
    // measured ~3.6x damage); at ~130+ damage the ratio tracks the power multiplier.
    game.override
      .battleStyle("single")
      .ability(AbilityId.NO_GUARD)
      .enemyAbility(AbilityId.BALL_FETCH)
      .enemySpecies(SpeciesId.WOBBUFFET)
      .enemyMoveset(MoveId.SPLASH)
      .moveset([move])
      .startingLevel(100)
      .enemyLevel(100)
      .criticalHits(false);
    await game.classicMode.startBattle([SpeciesId.MEWTWO]);
    vi.spyOn(Pokemon.prototype, "randBattleSeedIntRange").mockImplementation((_min: number, max: number) => max);
    const enemy = game.field.getEnemyPokemon();
    const player = game.field.getPlayerPokemon();

    // Baseline — user not statused.
    let hp0 = enemy.hp;
    game.move.use(move);
    await game.toNextTurn();
    const dmgBase = hp0 - enemy.hp;

    // Poison the user (no attack drop, unlike burn), reset the enemy, fire again.
    player.doSetStatus(StatusEffect.POISON);
    enemy.hp = enemy.getMaxHp();
    hp0 = enemy.hp;
    game.move.use(move);
    await game.toEndOfTurn();
    const dmgBoosted = hp0 - enemy.hp;

    expect(dmgBase, "baseline dealt damage").toBeGreaterThan(0);
    const ratio = dmgBoosted / dmgBase;
    expect(ratio, `expected ~2.0x when statused (got ${ratio.toFixed(3)})`).toBeGreaterThan(1.9);
    expect(ratio, `expected ~2.0x when statused (got ${ratio.toFixed(3)})`).toBeLessThan(2.1);
  });
});
