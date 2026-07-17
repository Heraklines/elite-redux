/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Regression (#ghost-identity) - a save/reload DURING a ghost battle must keep the
// ghost's identity. The ghost snapshot lived ONLY in an in-memory WeakMap
// (GHOST_BY_TRAINER) that was never serialised, so reloading mid-ghost-battle kept
// the enemy party (restored from PokemonData) but reverted the trainer to a plain NPC:
// the uploader name, the piano BGM, and the authored presentation (name/title/dialogue)
// were all lost.
//
// The fix persists the snapshot on TrainerData and re-applies it via markTrainerAsGhost
// in toTrainer(). This drives a real ghost battle, then simulates the save/reload of the
// battle trainer (new TrainerData(trainer) -> JSON round-trip -> new TrainerData -> toTrainer)
// and asserts the reconstructed trainer carries the full ghost identity again.
//
// ER_SCENARIO=1 gated (needs a real globalScene for `new Trainer` in toTrainer()).
// =============================================================================

import type { GhostTrainerProfile } from "#data/elite-redux/er-ghost-profile";
import {
  type GhostTeamSnapshot,
  hasErGhostOverride,
  setPrefetchedGhostTeamsForTests,
} from "#data/elite-redux/er-ghost-teams";
import { AbilityId } from "#enums/ability-id";
import { Challenges } from "#enums/challenges";
import { MoveId } from "#enums/move-id";
import { SpeciesId } from "#enums/species-id";
import { TrainerSlot } from "#enums/trainer-slot";
import { TrainerData } from "#system/trainer-data";
import { GameManager } from "#test/framework/game-manager";
import Phaser from "phaser";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

const RUN = process.env.ER_SCENARIO === "1";

const PRESENTATION: GhostTrainerProfile = {
  trainerType: undefined,
  displayName: "Revenant",
  title: "Champion",
  dialogue: {
    intro: "I have waited, {player}.",
    defeated: "You bested me.",
  },
};

const SNAPSHOT: GhostTeamSnapshot = {
  id: "ghost-reload-1",
  trainerName: "Uploader",
  difficulty: "hell",
  waveReached: 30,
  isVictory: true,
  timestamp: 1,
  presentation: PRESENTATION,
  party: [
    {
      speciesId: SpeciesId.SNORLAX,
      formIndex: 0,
      abilityIndex: 0,
      ivs: [31, 31, 31, 31, 31, 31],
      nature: 0,
      level: 20,
      gender: 0,
      shiny: false,
      variant: 0,
      passive: false,
      moves: [MoveId.TACKLE],
    },
  ],
};

describe.skipIf(!RUN)("ER ghost teams - identity survives a save/reload mid-battle (#ghost-identity)", () => {
  let phaserGame: Phaser.Game;
  let game: GameManager;

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });

  beforeEach(() => {
    game = new GameManager(phaserGame);
    game.override.battleStyle("single").startingWave(5).startingLevel(10).ability(AbilityId.BALL_FETCH);
  });

  afterEach(() => {
    setPrefetchedGhostTeamsForTests([]);
    for (const c of game.scene.gameMode?.challenges ?? []) {
      c.value = 0;
    }
  });

  it("reconstructs the ghost name, piano BGM, and authored presentation after a save/reload round-trip", async () => {
    setPrefetchedGhostTeamsForTests([SNAPSHOT]);
    game.challengeMode.addChallenge(Challenges.GHOST_TRAINERS, 1, 1);
    await game.challengeMode.startBattle(SpeciesId.MAGIKARP);

    const live = game.scene.currentBattle.trainer;
    expect(live, "wave-5 ghost-trainers battle should field a ghost").not.toBeNull();
    expect(hasErGhostOverride(live!)).toBe(true);
    // Baseline: the live ghost carries its identity.
    expect(live!.name).toBe("Revenant");
    expect(live!.getBattleBgm()).toBe("battle_ghost_piano");

    // Simulate the session save -> reload of the current-battle trainer.
    const saved = new TrainerData(live!);
    // The persisted snapshot must be JSON-safe (it rides the session blob).
    const roundTripped = JSON.parse(JSON.stringify(saved)) as TrainerData;
    const restored = new TrainerData(roundTripped).toTrainer();

    // The reconstructed trainer regains the FULL ghost identity (the bug: it did not).
    expect(hasErGhostOverride(restored)).toBe(true);
    expect(restored.name).toBe("Revenant");
    expect(restored.getBattleBgm()).toBe("battle_ghost_piano");
    expect(restored.getMixedBattleBgm()).toBe("battle_ghost_piano");
    expect(restored.getName(TrainerSlot.TRAINER, true)).toBe("Champion Revenant");
    expect(restored.getEncounterMessages()[0]).toContain("I have waited");
    expect(restored.getVictoryMessages()[0]).toContain("bested me");
  });
});
