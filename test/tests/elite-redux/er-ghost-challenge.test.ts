/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// #422 - Ghost Trainers challenge (7 Favour): every trainer battle fields a
// ghost team from the cross-player pool. The challenge only carries the
// toggle; the behavior lives in isErGhostChallengeActive (er-ghost-waves) +
// takeGhostForWave's trainerWave bypass + the immediate wave-1 prefetch.
// Falls back to a normal trainer when no pool team fits. ER_SCENARIO=1 gated.
// =============================================================================

import { allChallenges, GhostTrainersChallenge } from "#data/challenge";
import {
  applyErGhostOverride,
  type GhostTeamSnapshot,
  hasErGhostOverride,
  markTrainerAsGhost,
  setPrefetchedGhostTeamsForTests,
  takeGhostForWave,
} from "#data/elite-redux/er-ghost-teams";
import { isErGhostChallengeActive } from "#data/elite-redux/er-ghost-waves";
import { getChallengeFavour } from "#data/elite-redux/er-shiny-favour";
import { AbilityId } from "#enums/ability-id";
import { Challenges } from "#enums/challenges";
import { MoveId } from "#enums/move-id";
import { SpeciesId } from "#enums/species-id";
import { GameManager } from "#test/framework/game-manager";
import Phaser from "phaser";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

const RUN = process.env.ER_SCENARIO === "1";

const SNAPSHOT: GhostTeamSnapshot = {
  id: "ghost-test-1",
  trainerName: "Tester",
  difficulty: "elite",
  waveReached: 30,
  isVictory: false,
  timestamp: 1,
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

describe.skipIf(!RUN)("ER Ghost Trainers challenge (#422)", () => {
  let phaserGame: Phaser.Game;
  let game: GameManager;

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });

  beforeEach(() => {
    game = new GameManager(phaserGame);
    game.override
      .battleStyle("single")
      .enemySpecies(SpeciesId.MAGIKARP)
      .enemyAbility(AbilityId.BALL_FETCH)
      .enemyMoveset(MoveId.SPLASH)
      .enemyLevel(10)
      .startingLevel(10)
      .ability(AbilityId.BALL_FETCH);
  });

  afterEach(() => {
    setPrefetchedGhostTeamsForTests([]);
    for (const c of game.scene.gameMode?.challenges ?? []) {
      c.value = 0;
    }
  });

  const activate = (on: boolean) => {
    const challenges = game.scene.gameMode.challenges;
    let c = challenges.find(ch => ch.id === Challenges.GHOST_TRAINERS);
    if (!c) {
      c = new GhostTrainersChallenge();
      challenges.push(c);
    }
    c.value = on ? 1 : 0;
  };

  it("is registered and grants 7 Favour while active", () => {
    expect(allChallenges.some(c => c.id === Challenges.GHOST_TRAINERS)).toBe(true);
    const c = new GhostTrainersChallenge();
    c.value = 1;
    expect(getChallengeFavour(c)).toBe(7);
    c.value = 0;
    expect(getChallengeFavour(c)).toBe(0);
  });

  it("with the challenge ON, any trainer wave fields a ghost when the pool has a fitting team", async () => {
    await game.classicMode.startBattle(SpeciesId.SNORLAX);
    setPrefetchedGhostTeamsForTests([SNAPSHOT]);

    // OFF: wave 15 is not a scheduled ghost wave - nothing, even for trainers.
    activate(false);
    expect(isErGhostChallengeActive()).toBe(false);
    expect(takeGhostForWave(15, true)).toBeNull();

    // ON: the same trainer wave now takes the ghost (within the primary
    // 20-wave window: reached 30 <= 15+20). Non-trainer waves untouched.
    activate(true);
    expect(isErGhostChallengeActive()).toBe(true);
    expect(takeGhostForWave(16, false)).toBeNull();
    const ghost = takeGhostForWave(15, true);
    expect(ghost?.id).toBe(SNAPSHOT.id);
    // Wave 4: outside the 20-wave window (30 > 24) but inside the widened
    // 30-window - fielded (and devolved on build). Recycles when exhausted.
    const early = takeGhostForWave(4, true);
    expect(early?.id).toBe(SNAPSHOT.id);
    // A wave where the pool has NO team that got at least that far (30 < 90) -
    // normal trainer fallback, NEVER a team past where its run actually ended.
    expect(takeGhostForWave(90, true)).toBeNull();
  });

  it("with the challenge ON, a wave misses every window but a DEEPER team exists - last resort takes the closest one", async () => {
    await game.classicMode.startBattle(SpeciesId.SNORLAX);
    // Pool holds only deep runs (the real pool is dominated by them): wave 5
    // misses even the widest 60-window (120 > 65), but the challenge promises
    // a ghost on every trainer wave - the closest deeper team is fielded (and
    // applyErGhostOverride devolves + re-levels it on build).
    const deep = { ...SNAPSHOT, id: "er-test-deep", waveReached: 120 };
    const deeper = { ...SNAPSHOT, id: "er-test-deeper", waveReached: 200 };
    setPrefetchedGhostTeamsForTests([deeper, deep]);
    activate(true);
    // The pick is seeded-random among the closest deeper teams (#422 variety
    // pass - the old always-shallowest sort fielded the same uploader every
    // wave), so either of the two qualifies.
    expect(["er-test-deep", "er-test-deeper"]).toContain(takeGhostForWave(5, true)?.id);
    // Scheduled ghost waves on NORMAL runs keep the strict 20-wave window -
    // no last resort there (covered by the challenge-off case above).
  });

  it("wave 5 (the FIXED Youngster/Lass battle) fields a ghost too (#436)", async () => {
    // Wave 5 is ClassicFixedBossWaves.TOWN_YOUNGSTER - a fixed battle that
    // bypasses handleNonFixedBattle's ghost hook entirely, which is why the
    // 5th trainer was ALWAYS a plain Youngster/Lass in the challenge. The
    // challenge must be armed BEFORE newBattle builds the wave.
    game.override.startingWave(5);
    setPrefetchedGhostTeamsForTests([SNAPSHOT]);
    game.challengeMode.addChallenge(Challenges.GHOST_TRAINERS, 1, 1);
    await game.challengeMode.startBattle(SpeciesId.SNORLAX);

    const trainer = game.scene.currentBattle.trainer;
    expect(trainer).not.toBeNull();
    expect(hasErGhostOverride(trainer!)).toBe(true);
    // Story fixed battles stay scripted - only the generic wave-5 filler is
    // ghosted (rival/evil-team/E4/champion checks live in handleFixedBattle).
  });

  it("consecutive waves prefer DIFFERENT uploaders (no more 'always Arctic Flame')", async () => {
    await game.classicMode.startBattle(SpeciesId.SNORLAX);
    const a = { ...SNAPSHOT, id: "er-test-a", trainerName: "PlayerA", waveReached: 25 };
    const b = { ...SNAPSHOT, id: "er-test-b", trainerName: "PlayerB", waveReached: 26 };
    setPrefetchedGhostTeamsForTests([a, b]);
    activate(true);
    const first = takeGhostForWave(14, true);
    const second = takeGhostForWave(15, true);
    expect(first).not.toBeNull();
    expect(second).not.toBeNull();
    expect(first?.trainerName).not.toBe(second?.trainerName);
  });
});

// Separate block: NO enemySpecies override (it would force every addEnemyPokemon to
// Magikarp), so we can assert the ACTUAL species applyErGhostOverride builds.
describe.skipIf(!RUN)("ER ghost devolve gate past wave 50 (#422 follow-up)", () => {
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

  it("a deep team is fielded FULLY EVOLVED past wave 50, but still devolved very early", async () => {
    // The "not-fully-evolved / baby ghosts" bug: a deep (wave-200) team drawn for a high
    // challenge wave was devolved to base forms. From ~wave 50 the player is already
    // strong, so applyErGhostOverride must only re-level it, not devolve. Below wave 50
    // (only the challenge reaches such early trainer waves) the fairness devolve applies.
    const deepEvolved: GhostTeamSnapshot = {
      ...SNAPSHOT,
      id: "er-test-evolved",
      waveReached: 200,
      party: [
        {
          speciesId: SpeciesId.GARCHOMP, // 3-stage line: Garchomp -> Gabite -> Gible
          formIndex: 0,
          abilityIndex: 0,
          ivs: [31, 31, 31, 31, 31, 31],
          nature: 0,
          level: 100,
          gender: 0,
          shiny: false,
          variant: 0,
          passive: false,
          moves: [MoveId.TACKLE],
        },
      ],
    };
    setPrefetchedGhostTeamsForTests([deepEvolved]);
    game.challengeMode.addChallenge(Challenges.GHOST_TRAINERS, 1, 1);
    await game.challengeMode.startBattle(SpeciesId.SNORLAX);
    const host = game.scene.currentBattle.trainer;
    expect(host).not.toBeNull();
    markTrainerAsGhost(host!, deepEvolved);

    // Wave 137 (>= 50): fully evolved, only re-levelled to the wave.
    game.scene.currentBattle.waveIndex = 137;
    game.scene.currentBattle.enemyLevels = [137];
    expect(applyErGhostOverride(host!, 0)?.species.speciesId).toBe(SpeciesId.GARCHOMP);

    // Wave 80 (>= 50): now ALSO fully evolved - the cutoff dropped 100 -> 50, so a deep
    // ghost at a mid-game wave is no longer a baby team (it was Gible before this change).
    game.scene.currentBattle.waveIndex = 80;
    game.scene.currentBattle.enemyLevels = [80];
    expect(applyErGhostOverride(host!, 0)?.species.speciesId).toBe(SpeciesId.GARCHOMP);

    // Wave 30 (< 50): overshoot 200 - (30 + 40) = 130 -> 3 stages -> base form (Gible).
    // The fairness devolve still applies on the early Ghost Trainers challenge waves.
    game.scene.currentBattle.waveIndex = 30;
    game.scene.currentBattle.enemyLevels = [30];
    expect(applyErGhostOverride(host!, 0)?.species.speciesId).toBe(SpeciesId.GIBLE);
  });
});
