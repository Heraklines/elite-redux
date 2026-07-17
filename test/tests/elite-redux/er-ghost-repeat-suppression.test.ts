/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Regression (#ghost-repeat) - the ghost sampler must not field the SAME player's
// ghost several waves in a row (report: "the same ghost 4x in a row"). The picker
// suppresses recently-fielded uploaders so consecutive ghost waves spread across
// the pool, and never repeats the exact same TEAM on back-to-back waves while any
// alternative is available.
//
// Deterministic: the pick is a seeded hash of (run seed, wave), so this sampler is
// reproducible. ER_SCENARIO=1 gated (needs globalScene + the GHOST_TRAINERS challenge).
// =============================================================================

import {
  type GhostTeamSnapshot,
  resetErGhostRunState,
  setPrefetchedGhostTeamsForTests,
  takeGhostForWave,
} from "#data/elite-redux/er-ghost-teams";
import { setErDifficulty } from "#data/elite-redux/er-run-difficulty";
import { Challenges } from "#enums/challenges";
import { SpeciesId } from "#enums/species-id";
import { GameManager } from "#test/framework/game-manager";
import Phaser from "phaser";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

const RUN = process.env.ER_SCENARIO === "1";

const member = (speciesId: number) => ({
  speciesId,
  formIndex: 0,
  abilityIndex: 0,
  ivs: [31, 31, 31, 31, 31, 31],
  nature: 0,
  level: 45,
  gender: 0,
  shiny: false,
  variant: 0,
  passive: false,
  moves: [],
});

/** A pool of several uploaders, some with multiple teams (mirrors the live per-uploader cap of 3). */
const makePool = (): GhostTeamSnapshot[] => {
  const uploaders: [string, number][] = [
    ["Arctic Flame", 3],
    ["Veteran Lance", 2],
    ["Dusk Walker", 2],
    ["Iron Sage", 1],
  ];
  const pool: GhostTeamSnapshot[] = [];
  for (const [name, count] of uploaders) {
    for (let i = 0; i < count; i++) {
      pool.push({
        id: `${name}-${i}`,
        trainerName: name,
        difficulty: "hell",
        waveReached: 45, // eligible across waves 10..30 in the primary +40 window
        isVictory: true,
        timestamp: 1,
        party: [member(SpeciesId.GARCHOMP)],
      });
    }
  }
  return pool;
};

describe.skipIf(!RUN)("ER ghost teams - recent-pick suppression (no same ghost several waves in a row)", () => {
  let phaserGame: Phaser.Game;
  let game: GameManager;

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });

  beforeEach(() => {
    game = new GameManager(phaserGame);
    resetErGhostRunState();
    setErDifficulty("hell");
  });

  afterEach(() => {
    resetErGhostRunState();
    for (const c of game.scene.gameMode?.challenges ?? []) {
      c.value = 0;
    }
    setErDifficulty("ace");
  });

  it("never fields the same uploader 3x in a row, nor the same team on consecutive waves", async () => {
    // Start a real battle so the GHOST_TRAINERS challenge is live in gameMode (every
    // trainer wave then fields a ghost); then reset the per-run cache and force our pool.
    game.challengeMode.addChallenge(Challenges.GHOST_TRAINERS, 1, 1);
    await game.challengeMode.startBattle(SpeciesId.MAGIKARP);
    resetErGhostRunState();
    setPrefetchedGhostTeamsForTests(makePool());

    const uploaders: string[] = [];
    const ids: string[] = [];
    for (let wave = 10; wave <= 30; wave++) {
      const ghost = takeGhostForWave(wave, true);
      expect(ghost, `wave ${wave} should field a ghost`).not.toBeNull();
      uploaders.push(ghost!.trainerName);
      ids.push(ghost!.id);
    }

    // No exact-team repeat on back-to-back waves.
    for (let i = 1; i < ids.length; i++) {
      expect(ids[i], `same team ${ids[i]} fielded on consecutive waves ${9 + i}/${10 + i}`).not.toBe(ids[i - 1]);
    }

    // No uploader appears 3+ times in an unbroken streak (the "same ghost N in a row" report).
    let streak = 1;
    let maxStreak = 1;
    for (let i = 1; i < uploaders.length; i++) {
      streak = uploaders[i] === uploaders[i - 1] ? streak + 1 : 1;
      maxStreak = Math.max(maxStreak, streak);
    }
    expect(maxStreak, `longest same-uploader streak was ${maxStreak}: ${uploaders.join(", ")}`).toBeLessThan(3);
  });
});
