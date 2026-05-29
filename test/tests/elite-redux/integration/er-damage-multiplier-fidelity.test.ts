/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// #103 Batch A — exact-number real-battle verification of ER damage-multiplier
// abilities against the v2.65.3b C source (vendor/elite-redux/source/src/
// battle_util.c) AND their in-game descriptions. Unlike the smoke tests
// (`damage > 0`), these pin the actual multiplier by toggling the boost within a
// single battle and asserting the damage RATIO. The [0.85,1.0] damage-variance
// roll is mocked to a constant so the ratio is deterministic.
//
// Gated behind ER_SCENARIO=1.
// =============================================================================

import { AbilityId } from "#enums/ability-id";
import { MoveId } from "#enums/move-id";
import { SpeciesId } from "#enums/species-id";
import { Pokemon } from "#field/pokemon";
import { GameManager } from "#test/framework/game-manager";
import Phaser from "phaser";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const RUN_SCENARIOS = process.env.ER_SCENARIO === "1";

async function erId(id: number): Promise<AbilityId | undefined> {
  const erIdMap = (await import("#data/elite-redux/er-id-map")).ER_ID_MAP;
  return erIdMap.abilities[id] as AbilityId | undefined;
}

describe.skipIf(!RUN_SCENARIOS)("ER damage-multiplier fidelity (#103 Batch A)", () => {
  let phaserGame: Phaser.Game;
  let game: GameManager;

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });

  beforeEach(() => {
    game = new GameManager(phaserGame);
  });

  // Dune Terror (ER 431): C-source ABILITY_DUNE_TERROR + description — Ground-type
  // moves get +20% power (x1.2). This piece was previously unwired (only the sand
  // damage-reduction half existed). We isolate the boost by suppressing the
  // ability mid-battle and comparing the same Ground move's damage.
  it("Dune Terror: Ground moves get a 1.2x power boost", async () => {
    const duneTerror = await erId(431);
    if (duneTerror === undefined) {
      return;
    }
    game.override
      .battleStyle("single")
      .ability(duneTerror)
      .enemyAbility(AbilityId.BALL_FETCH)
      .enemySpecies(SpeciesId.SNORLAX) // Normal: Ground is neutral, no effectiveness skew
      .enemyMoveset(MoveId.SPLASH)
      .moveset(MoveId.EARTHQUAKE)
      .startingLevel(100)
      .enemyLevel(100)
      .criticalHits(false);
    await game.classicMode.startBattle([SpeciesId.SNORLAX]); // Normal user: Earthquake non-STAB

    // Pin the [0.85,1.0] damage-variance roll to its max so the ratio is exact.
    vi.spyOn(Pokemon.prototype, "randBattleSeedIntRange").mockImplementation((_min: number, max: number) => max);

    const player = game.field.getPlayerPokemon();
    const enemy = game.field.getEnemyPokemon();

    // Turn 1 — ability active: boosted Earthquake.
    let hp0 = enemy.hp;
    game.move.use(MoveId.EARTHQUAKE);
    await game.toNextTurn();
    const dmgBoosted = hp0 - enemy.hp;

    // Suppress the ability, heal, fire again — unboosted baseline.
    player.summonData.abilitySuppressed = true;
    enemy.hp = enemy.getMaxHp();
    hp0 = enemy.hp;
    game.move.use(MoveId.EARTHQUAKE);
    await game.toEndOfTurn();
    const dmgBase = hp0 - enemy.hp;

    expect(dmgBase, "baseline Earthquake dealt damage").toBeGreaterThan(0);
    const ratio = dmgBoosted / dmgBase;
    expect(ratio, `Dune Terror should boost Ground moves ~1.2x (got ${ratio.toFixed(3)})`).toBeGreaterThan(1.15);
    expect(ratio, `Dune Terror should boost Ground moves ~1.2x (got ${ratio.toFixed(3)})`).toBeLessThan(1.25);
  });

  // Fossilized (ER 303): C-source + description — "Halves dmg taken by Rock moves.
  // Boosts own Rock moves by 1.2x." The defensive half was previously unwired.
  // Verify the holder takes HALF damage from an incoming Rock move.
  it("Fossilized: halves incoming Rock-move damage (defensive half)", async () => {
    const fossilized = await erId(303);
    if (fossilized === undefined) {
      return;
    }
    game.override
      .battleStyle("single")
      .ability(fossilized)
      .enemyAbility(AbilityId.BALL_FETCH)
      .enemySpecies(SpeciesId.RHYPERIOR) // high Atk Rock user
      .enemyMoveset(MoveId.ROCK_SLIDE)
      .moveset(MoveId.SPLASH)
      .startingLevel(100)
      .enemyLevel(100)
      .criticalHits(false);
    await game.classicMode.startBattle([SpeciesId.SNORLAX]); // Normal: Rock is neutral

    vi.spyOn(Pokemon.prototype, "randBattleSeedIntRange").mockImplementation((_min: number, max: number) => max);
    const player = game.field.getPlayerPokemon();

    // Turn 1 — ability active: reduced Rock damage taken.
    let hp0 = player.hp;
    game.move.use(MoveId.SPLASH);
    await game.toNextTurn();
    const dmgReduced = hp0 - player.hp;

    // Suppress ability, heal, take the hit again at full.
    player.summonData.abilitySuppressed = true;
    player.hp = player.getMaxHp();
    hp0 = player.hp;
    game.move.use(MoveId.SPLASH);
    await game.toEndOfTurn();
    const dmgFull = hp0 - player.hp;

    expect(dmgFull, "baseline Rock Slide dealt damage").toBeGreaterThan(0);
    const ratio = dmgReduced / dmgFull;
    expect(ratio, `Fossilized should halve Rock damage (~0.5x, got ${ratio.toFixed(3)})`).toBeGreaterThan(0.45);
    expect(ratio, `Fossilized should halve Rock damage (~0.5x, got ${ratio.toFixed(3)})`).toBeLessThan(0.55);
  });
});
