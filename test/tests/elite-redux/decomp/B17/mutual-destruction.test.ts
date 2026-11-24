/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// B17 / Mutual Destruction in a real battle. The shared L2 template for "when I faint" never reaches a PostFaint attr
// (decomp-l2-reach.json), so this is the battle-level proof for MutualDestructionPostFaintAbAttr: the holder is
// knocked out by a direct attack and the attacker loses all of its remaining HP.
// The ally case (an ally knocks the holder out: nothing happens) cannot run as a real double battle in this checkout:
// the existing test/tests/abilities/innards-out.test.ts double-battle case times out too (the battle never becomes a
// double). That direction is proven with stand-ins in gates.test.ts.
// The Pokemon with the ability is the ENEMY here (same shape as test/tests/abilities/innards-out.test.ts).
import { AbilityId } from "#enums/ability-id";
import { HitResult } from "#enums/hit-result";
import { MoveId } from "#enums/move-id";
import { SpeciesId } from "#enums/species-id";
import { GameManager } from "#test/framework/game-manager";
import Phaser from "phaser";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const MUTUAL_DESTRUCTION = 6104 as AbilityId;

describe("B17 Mutual Destruction in a real battle", () => {
  let phaserGame: Phaser.Game;
  let game: GameManager;

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });

  beforeEach(() => {
    game = new GameManager(phaserGame);
    game.override
      .ability(AbilityId.BALL_FETCH)
      .battleStyle("single")
      .criticalHits(false)
      .enemySpecies(SpeciesId.MAGIKARP)
      .enemyAbility(MUTUAL_DESTRUCTION)
      .enemyMoveset(MoveId.SPLASH)
      .startingLevel(100);
  });

  it("takes all of the attacker's remaining HP when a direct attack knocks the holder out", async () => {
    await game.classicMode.startBattle(SpeciesId.FEEBAS);
    const magikarp = game.field.getEnemyPokemon();
    const feebas = game.field.getPlayerPokemon();
    magikarp.hp = 20;
    const hpBefore = feebas.hp;
    const damage = vi.spyOn(feebas, "damageAndUpdate");
    game.move.use(MoveId.X_SCISSOR);
    // Stop when the victory starts: the holder's faint reaction ran before it, and the run would otherwise end in a
    // game over (Feebas is alone and loses all of its HP).
    await game.phaseInterceptor.to("VictoryPhase");
    expect(magikarp.isFainted()).toBe(true);
    const indirectHits = damage.mock.calls.filter(([, options]) => options?.result === HitResult.INDIRECT);
    expect(indirectHits, "one indirect hit that takes all of the attacker's HP").toHaveLength(1);
    expect(indirectHits[0][0]).toBe(hpBefore);
  });
});
