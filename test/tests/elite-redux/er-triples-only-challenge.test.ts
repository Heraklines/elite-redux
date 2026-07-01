/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// ER "Triples Only" challenge: every regular battle becomes a 3v3 TRIPLE, driven
// by the challenge ALONE (no BATTLE_STYLE_OVERRIDE). It is kept SEPARATE from the
// Doubles Only challenge (a new enum id, not a shared "format" value) so it never
// trips the many DOUBLES_ONLY checks in achievements / community challenges, and
// the two are made mutually exclusive in the challenge-select UI. ER_SCENARIO=1.
// =============================================================================

import { globalScene } from "#app/global-scene";
import { DoublesOnlyChallenge, TriplesOnlyChallenge } from "#data/challenge";
import { AbilityId } from "#enums/ability-id";
import { Challenges } from "#enums/challenges";
import { SpeciesId } from "#enums/species-id";
import { GameManager } from "#test/framework/game-manager";
import { GameChallengesUiHandler } from "#ui/handlers/challenges-select-ui-handler";
import Phaser from "phaser";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

const RUN = process.env.ER_SCENARIO === "1";

/** Reach the private mutual-exclusion helper without loosening the class to `any`. */
type ExclusivityAccess = { enforceFormatExclusivity(changed: { id: Challenges; value: number }): void };

describe.skipIf(!RUN)("ER Triples Only challenge", () => {
  let phaserGame: Phaser.Game;
  let game: GameManager;

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });

  beforeEach(() => {
    game = new GameManager(phaserGame);
    game.override
      .enemySpecies(SpeciesId.MAGIKARP)
      .enemyAbility(AbilityId.BALL_FETCH)
      .ability(AbilityId.BALL_FETCH)
      .startingLevel(50)
      .enemyLevel(50);
  });

  it("forces a plain battle to a 3v3 triple (arrangement + both fields are 3-wide)", async () => {
    game.challengeMode.addChallenge(Challenges.TRIPLES_ONLY, 1, 0);
    await game.challengeMode.startBattle(SpeciesId.SNORLAX, SpeciesId.PIKACHU, SpeciesId.EEVEE);

    expect(globalScene.currentBattle.arrangement.playerCapacity).toBe(3);
    expect(globalScene.currentBattle.arrangement.enemyCapacity).toBe(3);
    // Battle derives `double` from the arrangement, so a triple reports NOT-double.
    expect(globalScene.currentBattle.double).toBe(false);
    expect(globalScene.getPlayerField()).toHaveLength(3);
    expect(globalScene.getEnemyField()).toHaveLength(3);
  });

  it("is mutually exclusive with Doubles Only (turning one on forces the other off)", async () => {
    // A started game guarantees a fully initialised gameMode for the handler to read.
    await game.challengeMode.startBattle(SpeciesId.SNORLAX);

    const handler = new GameChallengesUiHandler();
    const enforce = (handler as unknown as ExclusivityAccess).enforceFormatExclusivity.bind(handler);
    const doubles = new DoublesOnlyChallenge();
    const triples = new TriplesOnlyChallenge();
    globalScene.gameMode.challenges = [doubles, triples];

    // Turning Doubles ON leaves Triples (already off) off.
    doubles.value = 1;
    enforce(doubles);
    expect(triples.value).toBe(0);

    // Turning Triples ON forces Doubles back OFF - never both at once.
    triples.value = 1;
    enforce(triples);
    expect(doubles.value).toBe(0);
    expect(triples.value).toBe(1);
  });
});
