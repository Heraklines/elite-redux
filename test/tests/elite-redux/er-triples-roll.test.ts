/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// ER TRIPLES ROLL - a natural wild/trainer battle has a ~5% chance to become a
// 3-wide triple, and a GHOST battle a ~20% chance. Maintainer directive:
//   "abt 20% of ghost battles should be made triples and 5% of all battles wild
//    or trainer should be triples."
//
// Two proofs:
//   1. STATISTICAL - drive the seeded roll (BattleScene.rollTripleBattle) N=2000
//      times per path across distinct per-wave seeds and assert the observed rate
//      (~5% wild, ~5% trainer, ~20% ghost). The roll is deterministic per wave
//      seed, so the counts are stable (no flake).
//   2. CONSTRUCTION - when the roll fires (spied to true) a normal classic battle
//      with NO dev override resolves to TRIPLE_FORMAT and fields a real 3v3 that
//      plays a turn - proving the ROLLED path constructs identically to the proven
//      forced (BATTLE_STYLE_OVERRIDE="triple" / Triples Only) path.
//
// ER_SCENARIO=1 gated (drives a real GameManager scene).
// =============================================================================

import type { BattleScene } from "#app/battle-scene";
import { globalScene } from "#app/global-scene";
import { TRIPLE_BATTLE_GHOST_RARITY, TRIPLE_BATTLE_RARITY, TRIPLE_FORMAT } from "#data/battle-format";
import {
  type GhostMember,
  type GhostTeamSnapshot,
  ghostWavesForCurrentRun,
  hasErGhostOverride,
  resetErGhostRunState,
  setPrefetchedGhostTeamsForTests,
} from "#data/elite-redux/er-ghost-teams";
import { resetErDifficulty, setErDifficulty } from "#data/elite-redux/er-run-difficulty";
import { AbilityId } from "#enums/ability-id";
import { BattleType } from "#enums/battle-type";
import type { BattlerIndex } from "#enums/battler-index";
import { Challenges } from "#enums/challenges";
import { MoveId } from "#enums/move-id";
import { SpeciesId } from "#enums/species-id";
import type { Trainer } from "#field/trainer";
import { GameManager } from "#test/framework/game-manager";
import type { NewBattleConstructedProps } from "#types/new-battle-props";
import Phaser from "phaser";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const RUN = process.env.ER_SCENARIO === "1";

/** N seeded samples per rate measurement (maintainer-specified). */
const N = 2000;

/** Typed view onto the private roll so the test can drive it directly without `as any`. */
type RollFn = (props: NewBattleConstructedProps) => boolean;
const rollTriple = (scene: BattleScene, props: NewBattleConstructedProps): boolean =>
  (scene as unknown as { rollTripleBattle: RollFn }).rollTripleBattle(props);

/**
 * Observed win-rate of the triple roll over N distinct per-wave seeds. `resetSeed(w)`
 * gives each iteration a fresh, deterministic wave seed - the exact per-wave seeding the
 * live roll consumes.
 */
function measureRate(scene: BattleScene, makeProps: (wave: number) => NewBattleConstructedProps): number {
  let wins = 0;
  const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
  try {
    for (let i = 0; i < N; i++) {
      const wave = 100 + i; // mid-game band: avoids the wave-200 finale edge and stays a normal wave
      scene.resetSeed(wave);
      if (rollTriple(scene, makeProps(wave))) {
        wins++;
      }
    }
  } finally {
    logSpy.mockRestore();
  }
  return wins / N;
}

const member = (speciesId: number): GhostMember => ({
  speciesId,
  formIndex: 0,
  abilityIndex: 0,
  ivs: [31, 31, 31, 31, 31, 31],
  nature: 0,
  level: 20,
  gender: 0,
  shiny: false,
  variant: 0,
  passive: false,
  moves: [MoveId.TACKLE, MoveId.GROWL, MoveId.SPLASH, MoveId.REST],
});

/** A full (>=3-mon) ghost roster, so the ghost triple roll is not gated out by roster size. */
const GHOST_SNAPSHOT: GhostTeamSnapshot = {
  id: "ghost-triples-roll-1",
  trainerName: "Uploader",
  difficulty: "hell",
  waveReached: 140,
  isVictory: true,
  timestamp: 1,
  party: [member(SpeciesId.SNORLAX), member(SpeciesId.DRAGONITE), member(SpeciesId.SALAMENCE)],
};

describe.skipIf(!RUN)("ER triples roll - observed rates + rolled-path construction", () => {
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
      .enemyMoveset(MoveId.SPLASH)
      .moveset(MoveId.SPLASH)
      .ability(AbilityId.BALL_FETCH)
      .startingLevel(20)
      .enemyLevel(20);
  });

  afterEach(() => {
    setPrefetchedGhostTeamsForTests([]);
    resetErGhostRunState(); // clear the per-run ghost cache so wave 5 doesn't reuse a prior test's ghost
    resetErDifficulty();
    for (const c of game.scene.gameMode?.challenges ?? []) {
      c.value = 0;
    }
    vi.restoreAllMocks();
  });

  it("wild battles roll a triple ~5% of the time (1-in-20)", async () => {
    // A 3-mon party clears the party-size gate; classic mode = no challenges / co-op.
    await game.classicMode.startBattle(SpeciesId.SNORLAX, SpeciesId.PIKACHU, SpeciesId.EEVEE);

    const rate = measureRate(globalScene, wave => ({ battleType: BattleType.WILD, waveIndex: wave }));
    const expected = 1 / TRIPLE_BATTLE_RARITY; // 0.05
    // Deterministic per fixed test seed; a generous ±1.5% band still validates the mechanism.
    expect(rate).toBeGreaterThan(expected - 0.015);
    expect(rate).toBeLessThan(expected + 0.015);
  });

  it("trainer battles roll a triple ~5% of the time (1-in-20)", async () => {
    await game.classicMode.startBattle(SpeciesId.SNORLAX, SpeciesId.PIKACHU, SpeciesId.EEVEE);

    // No trainer object => not a ghost => the 5% wild/trainer rate.
    const rate = measureRate(globalScene, wave => ({ battleType: BattleType.TRAINER, waveIndex: wave }));
    const expected = 1 / TRIPLE_BATTLE_RARITY; // 0.05
    expect(rate).toBeGreaterThan(expected - 0.015);
    expect(rate).toBeLessThan(expected + 0.015);
  });

  it("bounds ordinary triple candidates to one per 20-wave cadence", async () => {
    await game.classicMode.startBattle(SpeciesId.SNORLAX, SpeciesId.PIKACHU, SpeciesId.EEVEE);

    const wins: number[] = [];
    for (let wave = 1; wave <= 200; wave++) {
      globalScene.resetSeed(wave);
      if (rollTriple(globalScene, { battleType: BattleType.WILD, waveIndex: wave })) {
        wins.push(wave);
      }
    }

    expect(wins.length).toBeGreaterThanOrEqual(9); // a finale can consume one cadence slot
    expect(wins.length).toBeLessThanOrEqual(10);
    for (let i = 1; i < wins.length; i++) {
      expect(wins[i] - wins[i - 1]).toBeGreaterThanOrEqual(TRIPLE_BATTLE_RARITY);
    }
  });

  it("ghost battles roll a triple ~20% of the time (1-in-5)", async () => {
    // Field a REAL ghost trainer through the live GHOST_TRAINERS pipeline, then measure the
    // roll against that trainer instance (it carries the ghost override + a >=3-mon roster).
    setPrefetchedGhostTeamsForTests([GHOST_SNAPSHOT]);
    game.override.startingWave(5); // wave 5 is a trainer wave => the GHOST_TRAINERS ghost is fielded
    game.challengeMode.addChallenge(Challenges.GHOST_TRAINERS, 1, 1);
    await game.challengeMode.startBattle(SpeciesId.SNORLAX, SpeciesId.PIKACHU, SpeciesId.EEVEE);

    const ghostTrainer = globalScene.currentBattle.trainer;
    expect(ghostTrainer, "GHOST_TRAINERS wave should field a ghost trainer").not.toBeNull();
    expect(hasErGhostOverride(ghostTrainer as Trainer)).toBe(true);

    const rate = measureRate(globalScene, wave => ({
      battleType: BattleType.TRAINER,
      waveIndex: wave,
      trainer: ghostTrainer as Trainer,
    }));
    const expected = 1 / TRIPLE_BATTLE_GHOST_RARITY; // 0.20
    expect(rate).toBeGreaterThan(expected - 0.025);
    expect(rate).toBeLessThan(expected + 0.025);
  });

  it("a ghost with a < 3-mon roster never rolls a triple (graceful fallback)", async () => {
    setPrefetchedGhostTeamsForTests([{ ...GHOST_SNAPSHOT, id: "ghost-short", party: [member(SpeciesId.SNORLAX)] }]);
    game.override.startingWave(5); // wave 5 is a trainer wave => the GHOST_TRAINERS ghost is fielded
    game.challengeMode.addChallenge(Challenges.GHOST_TRAINERS, 1, 1);
    await game.challengeMode.startBattle(SpeciesId.SNORLAX, SpeciesId.PIKACHU, SpeciesId.EEVEE);

    const ghostTrainer = globalScene.currentBattle.trainer;
    expect(hasErGhostOverride(ghostTrainer as Trainer)).toBe(true);

    const rate = measureRate(globalScene, wave => ({
      battleType: BattleType.TRAINER,
      waveIndex: wave,
      trainer: ghostTrainer as Trainer,
    }));
    expect(rate).toBe(0);
  });

  it("schedules roughly one in five gauntlet ghosts without adjacent ghost candidates", async () => {
    setErDifficulty("hell");
    setPrefetchedGhostTeamsForTests([GHOST_SNAPSHOT]);
    game.override.startingWave(5);
    game.challengeMode.addChallenge(Challenges.GHOST_TRAINERS, 1, 1);
    await game.challengeMode.startBattle(SpeciesId.SNORLAX, SpeciesId.PIKACHU, SpeciesId.EEVEE);

    const ghostTrainer = globalScene.currentBattle.trainer as Trainer;
    const schedule = ghostWavesForCurrentRun();
    const winningIndexes = schedule
      .map((wave, index) => {
        globalScene.resetSeed(wave);
        return rollTriple(globalScene, { battleType: BattleType.TRAINER, waveIndex: wave, trainer: ghostTrainer })
          ? index
          : -1;
      })
      .filter(index => index >= 0);

    expect(winningIndexes.length).toBeGreaterThanOrEqual(Math.floor(schedule.length / TRIPLE_BATTLE_GHOST_RARITY));
    expect(winningIndexes.length).toBeLessThanOrEqual(Math.ceil(schedule.length / TRIPLE_BATTLE_GHOST_RARITY));
    for (let i = 1; i < winningIndexes.length; i++) {
      expect(winningIndexes[i] - winningIndexes[i - 1]).toBeGreaterThanOrEqual(TRIPLE_BATTLE_GHOST_RARITY);
    }
  });

  it("a party of < 3 able mons never rolls a triple (party-size gate)", async () => {
    await game.classicMode.startBattle(SpeciesId.SNORLAX, SpeciesId.PIKACHU); // only 2 mons

    const rate = measureRate(globalScene, wave => ({ battleType: BattleType.WILD, waveIndex: wave }));
    expect(rate).toBe(0);
  });

  it("the ROLLED path constructs an identical 3v3 to the forced path and plays a turn", async () => {
    // Force the seeded roll to fire WITHOUT any dev style override, then start a normal classic
    // battle: it must resolve to TRIPLE_FORMAT exactly like BATTLE_STYLE_OVERRIDE="triple" does.
    vi.spyOn(game.scene as unknown as { rollTripleBattle: RollFn }, "rollTripleBattle").mockReturnValue(true);

    await game.classicMode.startBattle(SpeciesId.SNORLAX, SpeciesId.PIKACHU, SpeciesId.EEVEE);

    const battle = globalScene.currentBattle;
    // Same format + battler geometry the forced-triple slice (er-triple-wild-spawn) asserts.
    expect(battle.format).toBe(TRIPLE_FORMAT);
    expect(battle.getBattlerCount()).toBe(3);
    expect(battle.double).toBe(false); // derived from the 3-wide arrangement, exactly like the forced path
    expect(globalScene.getPlayerField(true).length).toBe(3);
    expect(globalScene.getEnemyField(true).length).toBe(3);
    expect(globalScene.getPlayerField()[0].getBattlerIndex()).toBe(0);
    expect(globalScene.getEnemyField()[2].getBattlerIndex()).toBe(5);

    // A full 3v3 turn resolves with no soft-lock (the rolled path is a real, playable triple).
    game.move.select(MoveId.SPLASH, 0, 3);
    game.move.select(MoveId.SPLASH, 1, 4 as BattlerIndex);
    game.move.select(MoveId.SPLASH, 2, 5 as BattlerIndex);
    await game.phaseInterceptor.to("TurnInitPhase");
    expect(globalScene.currentBattle.turn).toBe(2);
  });
});
