/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Regression (#345 / #difficulty-pools) - a run must never field a ghost of a
// HARDER difficulty than its own tier.
//   1. PURITY GATE (#345): Youngster and Ace are pure vanilla - NO scheduled ghost
//      waves at all, so outside the explicit Ghost Trainers CHALLENGE they never meet
//      a ghost even with a stacked pool.
//   2. CHALLENGE POOL ORDER: the challenge top-up (added to fight Ace-pool starvation)
//      draws the run's tier first, then EASIER tiers only - never Hell/Elite onto a
//      Youngster/Ace run (the "Youngster sees Hell-scaled evolved teams" report).
//
// Gated ER_SCENARIO=1 (needs globalScene for the scheduled-gate probe).
// =============================================================================

import {
  type GhostTeamSnapshot,
  ghostChallengePoolOrder,
  resetErGhostRunState,
  setPrefetchedGhostTeamsForTests,
  takeGhostForWave,
} from "#data/elite-redux/er-ghost-teams";
import { ghostWavesForCurrentRun, isErGhostWave } from "#data/elite-redux/er-ghost-waves";
import { type ErDifficulty, setErDifficulty } from "#data/elite-redux/er-run-difficulty";
import { SpeciesId } from "#enums/species-id";
import { GameManager } from "#test/framework/game-manager";
import Phaser from "phaser";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

const RUN = process.env.ER_SCENARIO === "1";

const RANK: Record<string, number> = { youngster: 0, ace: 1, elite: 2, hell: 3, mystery: 3 };

const member = (speciesId: number) => ({
  speciesId,
  formIndex: 0,
  abilityIndex: 0,
  ivs: [31, 31, 31, 31, 31, 31],
  nature: 0,
  level: 80,
  gender: 0,
  shiny: false,
  variant: 0,
  passive: false,
  moves: [],
});

const snapshot = (id: string, difficulty: ErDifficulty, waveReached: number): GhostTeamSnapshot => ({
  id,
  trainerName: `up-${id}`,
  difficulty,
  waveReached,
  isVictory: true,
  timestamp: 1,
  party: [member(SpeciesId.GARCHOMP)],
});

describe.skipIf(!RUN)("ER ghost teams - difficulty-constrained pools (#345 / #difficulty-pools)", () => {
  let phaserGame: Phaser.Game;
  // biome-ignore lint/correctness/noUnusedVariables: side-effectful full init for globalScene
  let game: GameManager;

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });
  beforeEach(() => {
    game = new GameManager(phaserGame);
    resetErGhostRunState();
  });
  afterEach(() => {
    resetErGhostRunState();
    setErDifficulty("ace");
  });

  it("the challenge pool order never includes a HARDER difficulty than the run", () => {
    const cases: [ErDifficulty, ErDifficulty[]][] = [
      ["youngster", ["youngster"]],
      ["ace", ["ace", "youngster"]],
      ["elite", ["elite", "ace", "youngster"]],
      ["hell", ["hell", "elite", "ace", "youngster"]],
    ];
    for (const [run, expected] of cases) {
      const order = ghostChallengePoolOrder(run);
      expect(order, `${run} order`).toStrictEqual(expected);
      // Every drawn tier is the run's tier or easier - never harder.
      for (const d of order) {
        expect(RANK[d], `${run} draws harder tier ${d}`).toBeLessThanOrEqual(RANK[run]);
      }
    }
  });

  it("#345: Youngster and Ace have no scheduled ghost waves and field no ghost even with a stacked pool", () => {
    for (const d of ["youngster", "ace"] as const) {
      setErDifficulty(d);
      resetErGhostRunState();
      expect(ghostWavesForCurrentRun(), `${d} schedule`).toHaveLength(0);
      // A pool full of deep Hell teams must NOT leak onto a vanilla run's trainer waves
      // (trainerWave=false = the scheduled path; the challenge is off here).
      setPrefetchedGhostTeamsForTests([snapshot("hell-a", "hell", 40), snapshot("hell-b", "hell", 60)]);
      for (const w of [20, 30, 40, 50, 63, 87]) {
        expect(isErGhostWave(w), `${d} wave ${w} scheduled`).toBe(false);
        expect(takeGhostForWave(w), `${d} wave ${w} ghost`).toBeNull();
      }
    }
  });
});
