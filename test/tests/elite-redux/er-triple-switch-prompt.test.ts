/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// Triple battle-start "Will you switch X?" prompt (SWITCH battle style) must name ALL THREE
// field mons - including the 3rd (RIGHT) slot. And if a mon's display name ever resolves EMPTY
// (an ER form / save state), the prompt must fall back to the species name, never a blank
// "Will you switch ?". Driven via the TRIPLES_ONLY challenge (the player-facing triple path).

import { globalScene } from "#app/global-scene";
import { AbilityId } from "#enums/ability-id";
import { BattleStyle } from "#enums/battle-style";
import { BattleType } from "#enums/battle-type";
import { Button } from "#enums/buttons";
import { Challenges } from "#enums/challenges";
import { MoveId } from "#enums/move-id";
import { SpeciesId } from "#enums/species-id";
import { UiMode } from "#enums/ui-mode";
import { GameManager } from "#test/framework/game-manager";
import Phaser from "phaser";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const RUN = process.env.ER_SCENARIO === "1";

describe.skipIf(!RUN)("ER triple battle-start switch prompt", () => {
  let phaserGame: Phaser.Game;
  let game: GameManager;

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });

  beforeEach(() => {
    game = new GameManager(phaserGame);
    game.override
      .battleType(BattleType.WILD)
      .enemySpecies(SpeciesId.MAGIKARP)
      .enemyAbility(AbilityId.BALL_FETCH)
      .enemyMoveset(MoveId.SPLASH)
      .ability(AbilityId.BALL_FETCH)
      .startingLevel(50)
      .enemyLevel(50);
  });

  /** Decline every CheckSwitch prompt (cursor 1 = No), re-arming for each of the three. */
  function declineEverySwitch(): void {
    const answer = () => {
      game.onNextPrompt(
        "CheckSwitchPhase",
        UiMode.CONFIRM,
        () => {
          const handler = game.scene.ui.getHandler();
          handler.setCursor(1);
          handler.processInput(Button.ACTION);
          answer();
        },
        () => game.isCurrentPhase("CommandPhase") || game.isCurrentPhase("TurnInitPhase"),
      );
    };
    answer();
  }

  it("names all three field mons (no blank 'Will you switch ?')", async () => {
    game.challengeMode.addChallenge(Challenges.TRIPLES_ONLY, 1, 0);
    await game.challengeMode.runToSummon(SpeciesId.SNORLAX, SpeciesId.PIKACHU, SpeciesId.EEVEE, SpeciesId.MAGIKARP);
    game.settings.battleStyle(BattleStyle.SWITCH);
    const showText = vi.spyOn(globalScene.ui, "showText");
    declineEverySwitch();

    await game.phaseInterceptor.to("CommandPhase");

    const switchQuestions = showText.mock.calls.map(c => String(c[0])).filter(t => /witch/i.test(t));
    expect(switchQuestions).toHaveLength(3);
    expect(switchQuestions[0]).toMatch(/Snorlax/);
    expect(switchQuestions[1]).toMatch(/Pikachu/);
    expect(switchQuestions[2]).toMatch(/Eevee/);
  });

  it("falls back to the species name if the 3rd mon's display name is empty", async () => {
    game.challengeMode.addChallenge(Challenges.TRIPLES_ONLY, 1, 0);
    await game.challengeMode.runToSummon(SpeciesId.SNORLAX, SpeciesId.PIKACHU, SpeciesId.EEVEE, SpeciesId.MAGIKARP);
    // Simulate the reported bug: the 3rd field mon's own `name` resolves empty.
    globalScene.getPlayerField()[2].name = "";
    game.settings.battleStyle(BattleStyle.SWITCH);
    const showText = vi.spyOn(globalScene.ui, "showText");
    declineEverySwitch();

    await game.phaseInterceptor.to("CommandPhase");

    const switchQuestions = showText.mock.calls.map(c => String(c[0])).filter(t => /witch/i.test(t));
    expect(switchQuestions).toHaveLength(3);
    // The 3rd prompt names the species (Eevee) via the fallback - never a blank slot.
    expect(switchQuestions[2]).toMatch(/Eevee/);
    expect(switchQuestions[2]).not.toMatch(/switch\s*\?/i);
  });
});
