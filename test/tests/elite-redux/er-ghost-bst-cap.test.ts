/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Regression: a cross-player ghost still passes the receiving wave's universal
// BST gate. Legal members preserve their exact species/moves, while an early
// legendary, evolved over-cap species, or stored mega form is clamped.
// ER_SCENARIO=1 gated (drives a real GameManager spawn).
// =============================================================================

import { allSpecies } from "#data/data-lists";
import {
  type GhostMember,
  type GhostTeamSnapshot,
  hasErGhostOverride,
  setPrefetchedGhostTeamsForTests,
} from "#data/elite-redux/er-ghost-teams";
import { resetErDifficulty, setErDifficulty } from "#data/elite-redux/er-run-difficulty";
import { AbilityId } from "#enums/ability-id";
import { Challenges } from "#enums/challenges";
import { MoveId } from "#enums/move-id";
import { SpeciesFormKey } from "#enums/species-form-key";
import { SpeciesId } from "#enums/species-id";
import { GameManager } from "#test/framework/game-manager";
import Phaser from "phaser";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

const RUN = process.env.ER_SCENARIO === "1";

const member = (speciesId: number, moves: number[], formIndex = 0): GhostMember => ({
  speciesId,
  formIndex,
  abilityIndex: 0,
  ivs: [31, 31, 31, 31, 31, 31],
  nature: 0,
  level: 20,
  gender: 0,
  shiny: false,
  variant: 0,
  passive: false,
  moves,
});

const LEGAL_MOVES = [MoveId.SPLASH];

function findEarlyMegaCandidate(): { speciesId: number; formIndex: number } {
  const megaKeys = new Set([SpeciesFormKey.MEGA, SpeciesFormKey.MEGA_X, SpeciesFormKey.MEGA_Y]);
  for (const species of allSpecies) {
    const baseBst = (species.forms?.[0] ?? species).getBaseStatTotal();
    const formIndex =
      species.forms?.findIndex(
        (form, index) => index > 0 && megaKeys.has(form.formKey as SpeciesFormKey) && form.getBaseStatTotal() > 460,
      ) ?? -1;
    if (baseBst <= 460 && formIndex > 0) {
      return { speciesId: species.speciesId, formIndex };
    }
  }
  throw new Error("Expected an ER mega with a wave-5-legal base species");
}

describe.skipIf(!RUN)("ER ghost teams - universal BST cap", () => {
  let phaserGame: Phaser.Game;
  let game: GameManager;

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });

  beforeEach(() => {
    setErDifficulty("hell");
    game = new GameManager(phaserGame);
    game.override.battleStyle("single").startingWave(5).startingLevel(10).ability(AbilityId.BALL_FETCH);
  });

  afterEach(() => {
    setPrefetchedGhostTeamsForTests([]);
    resetErDifficulty();
    for (const c of game.scene.gameMode?.challenges ?? []) {
      c.value = 0;
    }
  });

  it("caps overpowered species and forms while preserving legal members", async () => {
    const mega = findEarlyMegaCandidate();
    const snapshot: GhostTeamSnapshot = {
      id: "ghost-bst-cap-1",
      trainerName: "Uploader",
      difficulty: "hell",
      waveReached: 40,
      isVictory: true,
      timestamp: 1,
      party: [
        member(SpeciesId.DIALGA, [MoveId.OUTRAGE, MoveId.EARTHQUAKE, MoveId.FIRE_PUNCH, MoveId.ROOST]),
        member(SpeciesId.GARCHOMP, [MoveId.DRAGON_CLAW, MoveId.EARTHQUAKE, MoveId.FLY, MoveId.CRUNCH]),
        member(
          mega.speciesId,
          [MoveId.SHADOW_BALL, MoveId.WILL_O_WISP, MoveId.SUCKER_PUNCH, MoveId.PROTECT],
          mega.formIndex,
        ),
        member(SpeciesId.MAGIKARP, LEGAL_MOVES),
      ],
    };
    setPrefetchedGhostTeamsForTests([snapshot]);
    game.challengeMode.addChallenge(Challenges.GHOST_TRAINERS, 1, 1);
    await game.challengeMode.startBattle(SpeciesId.MAGIKARP);

    const host = game.scene.currentBattle.trainer;
    expect(host, "wave-5 ghost-trainers battle should field a ghost").not.toBeNull();
    expect(hasErGhostOverride(host!)).toBe(true);

    const enemyParty = game.scene.getEnemyParty();
    expect(enemyParty).toHaveLength(snapshot.party.length);
    expect(enemyParty.every(enemy => enemy.getSpeciesForm().getBaseStatTotal() <= 460)).toBe(true);

    expect(enemyParty[0].species.speciesId).not.toBe(SpeciesId.DIALGA);
    expect(enemyParty[1].species.speciesId).toBe(SpeciesId.GABITE);
    expect(enemyParty[2].species.speciesId).toBe(mega.speciesId);
    expect(enemyParty[2].formIndex).toBe(0);

    expect(enemyParty[3].species.speciesId).toBe(SpeciesId.MAGIKARP);
    const legalMoves = enemyParty[3].moveset.filter(Boolean).map(move => move!.moveId);
    expect(legalMoves).toStrictEqual(LEGAL_MOVES);
  });
});
