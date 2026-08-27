/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// Regression for the 2026-08-27 staging capture from cuwan. The wave-2
// xChaotik ghost rendered both sides, then overflowed the JavaScript stack in
// PostSummonPhase before CommandPhase opened (the screen looked like it was
// still deploying Pokemon and button presses could animate but do nothing).

import { setPendingDevGhostTeam } from "#app/dev-tools/registry";
import type { GhostMember, GhostTeamSnapshot } from "#data/elite-redux/er-ghost-teams";
import { setErDifficulty } from "#data/elite-redux/er-run-difficulty";
import { ErSpeciesId } from "#enums/er-species-id";
import { MoveId } from "#enums/move-id";
import { SpeciesId } from "#enums/species-id";
import { GameManager } from "#test/framework/game-manager";
import Phaser from "phaser";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

const RUN = process.env.ER_SCENARIO === "1";

const member = (speciesId: number, moves: readonly MoveId[]): GhostMember => ({
  speciesId,
  formIndex: 0,
  abilityIndex: 0,
  ivs: [31, 31, 31, 31, 31, 31],
  nature: 0,
  level: 16,
  gender: 0,
  shiny: false,
  variant: 0,
  passive: true,
  moves: [...moves],
});

const XCHAOTIK_GHOST: GhostTeamSnapshot = {
  id: "staging-xchaotik-wave-2-repro",
  trainerName: "xChaotik",
  difficulty: "youngster",
  mode: "challenge",
  pacing: "normal",
  waveReached: 16,
  progressionWaveReached: 16,
  isVictory: false,
  timestamp: Date.parse("2026-08-27T17:14:01Z"),
  party: [
    member(SpeciesId.SILCOON, [MoveId.POISON_STING, MoveId.TACKLE, MoveId.BATON_PASS, MoveId.BLEAKWIND_STORM]),
    member(SpeciesId.LOKIX, [MoveId.LUNGE, MoveId.DETECT, MoveId.DOUBLE_KICK, MoveId.ME_FIRST]),
    member(SpeciesId.SEEL, [MoveId.SLACK_OFF, MoveId.BOUNCY_BUBBLE, MoveId.PLAY_ROUGH, MoveId.ICE_SHARD]),
    member(SpeciesId.FINNEON, [MoveId.BUBBLE_BEAM, MoveId.CAMOUFLAGE, MoveId.CAPTIVATE, MoveId.SPLASH]),
    member(ErSpeciesId.GROWLITHE_REDUX, [MoveId.BULLET_SEED, MoveId.FIRE_FANG, MoveId.GROWL, MoveId.LEER]),
    member(SpeciesId.BIDOOF, [MoveId.DEFENSE_CURL, MoveId.GROWL, MoveId.HYPER_FANG, MoveId.MUD_SPORT]),
  ],
};

describe.skipIf(!RUN)("ghost PostSummon deployment freeze", () => {
  let phaserGame: Phaser.Game;
  let game: GameManager;

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });

  beforeEach(() => {
    game = new GameManager(phaserGame);
    setErDifficulty("youngster");
    game.override.battleStyle("double").startingWave(2).startingLevel(5).enemyLevel(2);
  });

  it("the captured xChaotik roster reaches actionable command input", async () => {
    setPendingDevGhostTeam(XCHAOTIK_GHOST);

    await game.classicMode.startBattle(SpeciesId.GIBLE, SpeciesId.KYOGRE);

    expect(game.scene.phaseManager.getCurrentPhase().phaseName).toBe("CommandPhase");
    expect(game.scene.getEnemyParty()).toHaveLength(6);
  }, 120_000);
});
