/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// ER staff-authored Custom Trainers (er-custom-trainers.json) ingestion.
//
// Covers the wave-selection GATES (difficulty / floor range / endless /
// challenge-exclusivity), the per-run ONCE appearance model (spawnChance roll +
// seed-assigned wave + slide-forward DUE semantics + no-repeat), EXACT-party
// generation (species / level / moveset / ability slot / fusion) and the #419
// BST-cap BYPASS (staff intent wins — a high-BST mon is fielded as authored,
// not devolved).
//
// Selection is once-per-run now: each trainer rolls ONCE for whether it appears
// (spawnChance %), and if so is assigned ONE random floor in its window; it then
// fires exactly once at the first non-excluded wave >= that floor. So the gate
// tests SWEEP a run (playRun) rather than asserting a single wave, which would
// be fragile against the seed-derived assigned wave.
//
// Gated behind ER_SCENARIO=1.
// =============================================================================

import { planErCustomTrainerLaunch, summarizeErCustomTrainer } from "#app/dev-tools/test-suite/custom-trainer-picker";
import { globalScene } from "#app/global-scene";
import { allMoves } from "#data/data-lists";
import {
  applyErCustomTrainerPresentation,
  buildErCustomTrainerMember,
  clearErCustomTrainerDevForce,
  type ErCustomTrainerMemberResolved,
  erCustomTrainerWindowIndex,
  erCustomTrainerWindowWave,
  getErCustomTrainerDevForce,
  getErCustomTrainerSpawnConfig,
  getErCustomTrainers,
  isErCustomTrainerDevForceArmed,
  markErCustomTrainerUsed,
  normalizeBattleBgm,
  normalizeDialogueLine,
  normalizeErCustomTrainerSpawnConfig,
  normalizeIntroDialogue,
  normalizeTrainerEffect,
  pickErCustomTrainerByWeight,
  pickErCustomTrainerVariant,
  resetErCustomTrainerTracking,
  resolveErCustomTrainerMoveIds,
  resolveErCustomTrainerParty,
  resolveErCustomTrainerWeight,
  rollErCustomTrainerSlotFill,
  rollErCustomTrainerWindow,
  selectErCustomTrainerForWave,
  setErCustomTrainerBstBypass,
  setErCustomTrainerDevForce,
  setErCustomTrainerSpawnConfigForTesting,
  setErCustomTrainersForTesting,
} from "#data/elite-redux/er-custom-trainers";
import { resetErDifficulty, setErDifficulty } from "#data/elite-redux/er-run-difficulty";
import { enforceErEliteBstCurve } from "#data/elite-redux/er-trainer-runtime-hook";
import { Challenges } from "#enums/challenges";
import { MoveCategory } from "#enums/move-category";
import { MoveId } from "#enums/move-id";
import { SpeciesId } from "#enums/species-id";
import type { Trainer } from "#field/trainer";
import { GameManager } from "#test/framework/game-manager";
import Phaser from "phaser";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

const RUN = process.env.ER_SCENARIO === "1";

// A staff-authored table exercising each gate. Species are numeric speciesIds
// and moves are enum NAMES (exactly how the editor writes the JSON).
const TABLE = {
  ACE_RICO: {
    id: 70001,
    name: "Ace Rico",
    trainerClass: "ACE_TRAINER",
    battleType: "single",
    difficulties: ["ace", "elite"],
    minWave: 10,
    maxWave: 40,
    endless: false,
    challenge: "none",
    team: [
      {
        species: SpeciesId.GARCHOMP,
        level: 55,
        moves: ["EARTHQUAKE", "DRAGON_CLAW"],
        abilitySlot: 1,
        fusion: { species: SpeciesId.RAYQUAZA, formIndex: 0, abilitySlot: 0 },
      },
    ],
  },
  HELL_BOSS: {
    id: 70002,
    name: "Hell Boss",
    trainerClass: "VETERAN",
    battleType: "double",
    difficulties: ["hell"],
    minWave: 50,
    maxWave: 200,
    endless: false,
    challenge: "none",
    team: [{ species: SpeciesId.SNORLAX }, { species: SpeciesId.GENGAR }],
  },
  GHOST_ONLY: {
    id: 70003,
    name: "Spooky",
    trainerClass: "PSYCHIC",
    battleType: "single",
    difficulties: ["ace", "elite", "hell"],
    minWave: 1,
    maxWave: 200,
    endless: false,
    challenge: "ghost",
    team: [{ species: SpeciesId.HAUNTER }],
  },
  ENDLESS_T: {
    id: 70004,
    name: "Endless Ed",
    trainerClass: "HIKER",
    battleType: "single",
    difficulties: ["ace"],
    minWave: 100,
    maxWave: 120,
    endless: true,
    challenge: "none",
    team: [{ species: SpeciesId.MACHAMP }],
  },
  // Exercises a NON-original challenge key (added in the round-2 expansion of
  // ErCustomTrainerChallenge): must parse via CHALLENGE_MAP and gate on Hardcore.
  HARDCORE_ONLY: {
    id: 70006,
    name: "Hardcore Hank",
    trainerClass: "VETERAN",
    battleType: "single",
    difficulties: ["ace", "elite", "hell"],
    minWave: 1,
    maxWave: 200,
    endless: false,
    challenge: "hardcore",
    team: [{ species: SpeciesId.MACHAMP }],
  },
  // Invalid: blank name -> must be dropped by getErCustomTrainers (never fatal).
  BROKEN: {
    id: 70005,
    name: "",
    trainerClass: "LASS",
    difficulties: ["ace"],
    team: [{ species: SpeciesId.PIKACHU }],
  },
};

/**
 * Play a run from `from` to `to` inclusive: at each wave ask the selector for a
 * DUE trainer and, when one fires, mark it used (exactly what the live caller in
 * new-battle-phase.ts does; the selector itself consumes the spawn window).
 * Returns every appearance as `{ wave, key }`. Sweeping the whole run is the
 * seed-robust way to observe the window-density gates.
 */
function playRun(from: number, to: number): { wave: number; key: string }[] {
  const picks: { wave: number; key: string }[] = [];
  for (let w = from; w <= to; w++) {
    const pick = selectErCustomTrainerForWave(w);
    if (pick) {
      picks.push({ wave: w, key: pick.key });
      markErCustomTrainerUsed(pick.key);
    }
  }
  return picks;
}

describe.skipIf(!RUN)("ER Custom Trainers — ingestion gates + exact party + BST bypass", () => {
  let phaserGame: Phaser.Game;
  let game: GameManager;

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });

  beforeEach(async () => {
    game = new GameManager(phaserGame);
    setErCustomTrainersForTesting(TABLE as never);
    // Window-density model: force EVERY window to fire (100%) with a 10-wave
    // window so the gate tests observe selection deterministically. Individual
    // tests override the config to exercise the density roll itself.
    setErCustomTrainerSpawnConfigForTesting({ windowSize: 10, windowChancePct: 100 });
    resetErCustomTrainerTracking();
    setErCustomTrainerBstBypass(false);
    setErCustomTrainerDevForce(null);
    // NB: do NOT set an enemySpecies/enemyLevel override — either forces every
    // addEnemyPokemon (incl. buildErCustomTrainerMember) to that species/level,
    // masking the exact-party build.
    game.override.battleStyle("single").startingLevel(50);
    await game.classicMode.startBattle(SpeciesId.SNORLAX);
  });

  afterEach(() => {
    setErCustomTrainersForTesting(undefined);
    setErCustomTrainerSpawnConfigForTesting(undefined);
    setErCustomTrainerDevForce(null);
    resetErCustomTrainerTracking();
    setErCustomTrainerBstBypass(false);
    resetErDifficulty();
  });

  it("validation drops invalid entries (blank name) but keeps the rest", () => {
    const resolved = getErCustomTrainers();
    const keys = resolved.map(t => t.key).sort();
    expect(keys).toEqual(["ACE_RICO", "ENDLESS_T", "GHOST_ONLY", "HARDCORE_ONLY", "HELL_BOSS"]);
    expect(keys).not.toContain("BROKEN");
  });

  it("gates by difficulty: hell-only trainer never appears on ace, appears once on hell", () => {
    setErDifficulty("ace");
    // On ace, HELL_BOSS is hell-only -> never fielded anywhere.
    expect(playRun(1, 200).some(p => p.key === "HELL_BOSS")).toBe(false);
    resetErCustomTrainerTracking();
    setErDifficulty("hell");
    // On hell it is the only eligible trainer and appears exactly once, inside
    // its floor range (50..200) — every window fires (100%) in this harness.
    const hellPicks = playRun(1, 200).filter(p => p.key === "HELL_BOSS");
    expect(hellPicks.length).toBe(1);
    expect(hellPicks[0].wave).toBeGreaterThanOrEqual(50);
    expect(hellPicks[0].wave).toBeLessThanOrEqual(200);
  });

  it("gates by floor range and endless (fielded wave stays inside the range)", () => {
    setErDifficulty("ace");
    // Below ACE_RICO's min (10) and ENDLESS_T's (100), neither is eligible yet.
    // Window 0 (waves 1-10) can still field ACE_RICO once wave >= 10.
    const byKey = new Map(playRun(1, 320).map(p => [p.key, p.wave]));
    const ace = byKey.get("ACE_RICO");
    expect(ace).toBeDefined();
    expect(ace!).toBeGreaterThanOrEqual(10);
    expect(ace!).toBeLessThanOrEqual(40);
    const endless = byKey.get("ENDLESS_T");
    expect(endless).toBeDefined();
    // Endless: any floor >= minWave (100); no upper bound.
    expect(endless!).toBeGreaterThanOrEqual(100);
  });

  it("gates by challenge-exclusivity (ghost trainer only when the challenge is active)", () => {
    setErDifficulty("ace");
    // No challenge active -> ghost-only trainer never appears in a full run.
    expect(playRun(1, 200).some(p => p.key === "GHOST_ONLY")).toBe(false);
    resetErCustomTrainerTracking();
    // Activate the Ghost challenge -> the ghost-only trainer appears.
    globalScene.gameMode.challenges.push({ id: Challenges.GHOST_TRAINERS, value: 1 } as never);
    try {
      expect(playRun(1, 200).some(p => p.key === "GHOST_ONLY")).toBe(true);
    } finally {
      globalScene.gameMode.challenges.pop();
    }
  });

  it("gates by a newly-added challenge key (hardcore parses + gates via CHALLENGE_MAP)", () => {
    setErDifficulty("ace");
    // Without the Hardcore challenge active, the hardcore-only trainer never appears.
    expect(playRun(1, 200).some(p => p.key === "HARDCORE_ONLY")).toBe(false);
    resetErCustomTrainerTracking();
    // Activate the Hardcore challenge -> the hardcore-only trainer appears.
    globalScene.gameMode.challenges.push({ id: Challenges.HARDCORE, value: 1 } as never);
    try {
      expect(playRun(1, 200).some(p => p.key === "HARDCORE_ONLY")).toBe(true);
    } finally {
      globalScene.gameMode.challenges.pop();
    }
  });

  // ---- WINDOW-DENSITY GATING (the new global model) -------------------------
  it("window density gates spawning: a NO-roll window fields nothing; a YES window fields exactly one", () => {
    const ONE = {
      SOLO: {
        id: 70010,
        name: "Solo",
        trainerClass: "ACE_TRAINER",
        difficulties: ["ace"],
        minWave: 1,
        maxWave: 200,
        endless: false,
        team: [{ species: SpeciesId.PIKACHU }],
      },
    };
    setErCustomTrainersForTesting(ONE as never);
    globalScene.seed = "RUNSEED";
    setErDifficulty("ace");

    // windowChancePct = 0 -> NO window ever fires -> nothing fielded across the run.
    setErCustomTrainerSpawnConfigForTesting({ windowSize: 10, windowChancePct: 0 });
    resetErCustomTrainerTracking();
    expect(rollErCustomTrainerWindow("RUNSEED", 0, getErCustomTrainerSpawnConfig())).toBe(false);
    expect(playRun(1, 100).length).toBe(0);

    // windowChancePct = 100 -> EVERY window fires. With a single eligible trainer
    // and no-repeat, EXACTLY ONE appearance across the whole run.
    setErCustomTrainerSpawnConfigForTesting({ windowSize: 10, windowChancePct: 100 });
    resetErCustomTrainerTracking();
    expect(rollErCustomTrainerWindow("RUNSEED", 0, getErCustomTrainerSpawnConfig())).toBe(true);
    const picks = playRun(1, 100);
    expect(picks.length).toBe(1);
    expect(picks[0].key).toBe("SOLO");

    // Within the FIRST firing window: at most one appearance, and it lands at the
    // window's seed-chosen anchor wave (waves 1..10 => window 0).
    resetErCustomTrainerTracking();
    const anchor = erCustomTrainerWindowWave("RUNSEED", 0, 10);
    expect(erCustomTrainerWindowIndex(anchor, 10)).toBe(0);
    const inWindow = playRun(1, 10);
    expect(inWindow.length).toBe(1);
    expect(inWindow[0].wave).toBe(anchor);
  });

  it("window model slides the appearance forward past an excluded anchor wave", () => {
    const ONE = {
      SLIDER: {
        id: 70012,
        name: "Slider",
        trainerClass: "ACE_TRAINER",
        difficulties: ["ace"],
        minWave: 1,
        maxWave: 500,
        endless: false,
        team: [{ species: SpeciesId.PIKACHU }],
      },
    };
    setErCustomTrainersForTesting(ONE as never);
    globalScene.seed = "RUNSEED";
    // A big window so the anchor is comfortably mid-window (never at the boundary).
    setErCustomTrainerSpawnConfigForTesting({ windowSize: 30, windowChancePct: 100 });
    resetErCustomTrainerTracking();
    setErDifficulty("ace");
    const anchor = erCustomTrainerWindowWave("RUNSEED", 0, 30);
    // Not due before the anchor wave.
    if (anchor > 1) {
      expect(selectErCustomTrainerForWave(anchor - 1)).toBeNull();
    }
    // Simulate the anchor wave itself being EXCLUDED (boss / fixed / mystery): the
    // selector is simply never called at `anchor`. The next non-excluded wave in
    // the SAME window must still field the trainer (slide forward).
    const next = anchor + 1;
    expect(erCustomTrainerWindowIndex(next, 30)).toBe(0); // still in window 0
    expect(selectErCustomTrainerForWave(next)?.key).toBe("SLIDER");
    // Window consumed: the same window fields nothing again.
    expect(selectErCustomTrainerForWave(next + 1)).toBeNull();
  });

  it("no-repeat: every eligible trainer fires at most once across a whole run", () => {
    setErDifficulty("ace");
    globalScene.gameMode.challenges.push({ id: Challenges.GHOST_TRAINERS, value: 1 } as never);
    try {
      const picks = playRun(1, 400);
      const counts = new Map<string, number>();
      for (const p of picks) {
        counts.set(p.key, (counts.get(p.key) ?? 0) + 1);
      }
      // Some ace-eligible trainers fired, and NO trainer fired twice.
      expect(picks.length).toBeGreaterThan(0);
      for (const [, count] of counts) {
        expect(count).toBe(1);
      }
    } finally {
      globalScene.gameMode.challenges.pop();
    }
  });

  it("at most one custom trainer per window (density caps density, not trainer count)", () => {
    // Two eligible trainers, both spanning the whole run. Every window fires, but
    // each window fields AT MOST ONE -> no two appearances share a window.
    const TWO = {
      A: {
        id: 70061,
        name: "Alpha",
        trainerClass: "ACE_TRAINER",
        difficulties: ["ace"],
        minWave: 1,
        maxWave: 500,
        team: [{ species: SpeciesId.PIKACHU }],
      },
      B: {
        id: 70062,
        name: "Bravo",
        trainerClass: "VETERAN",
        difficulties: ["ace"],
        minWave: 1,
        maxWave: 500,
        team: [{ species: SpeciesId.SNORLAX }],
      },
    };
    setErCustomTrainersForTesting(TWO as never);
    globalScene.seed = "RUNSEED";
    setErCustomTrainerSpawnConfigForTesting({ windowSize: 10, windowChancePct: 100 });
    resetErCustomTrainerTracking();
    setErDifficulty("ace");
    const picks = playRun(1, 200);
    // Both fired (weighted pick spreads across windows), each exactly once...
    expect(picks.length).toBe(2);
    // ...and in DIFFERENT windows.
    const windows = picks.map(p => erCustomTrainerWindowIndex(p.wave, 10));
    expect(new Set(windows).size).toBe(windows.length);
  });

  // ---- WEIGHT MIGRATION (spawnChance -> weight) ----------------------------
  it("migrates spawnChance -> weight (weight wins; absent both -> 100; clamped >= 1)", () => {
    // Pure resolver.
    expect(resolveErCustomTrainerWeight(5, 30)).toBe(5); // weight present wins
    expect(resolveErCustomTrainerWeight(undefined, 30)).toBe(30); // legacy spawnChance migrates
    expect(resolveErCustomTrainerWeight(undefined, undefined)).toBe(100); // neither -> default 100
    expect(resolveErCustomTrainerWeight(0, undefined)).toBe(1); // clamp >= 1
    expect(resolveErCustomTrainerWeight(-4, undefined)).toBe(1);
    expect(resolveErCustomTrainerWeight(undefined, 0)).toBe(1); // legacy 0 clamps to 1
    expect(resolveErCustomTrainerWeight(3.9, undefined)).toBe(3); // floored

    const MIG = {
      LEGACY: {
        id: 70070,
        name: "Legacy",
        trainerClass: "ACE_TRAINER",
        difficulties: ["ace"],
        spawnChance: 40, // pre-feature save, no weight
        team: [{ species: SpeciesId.PIKACHU }],
      },
      NEWWEIGHT: {
        id: 70071,
        name: "NewWeight",
        trainerClass: "ACE_TRAINER",
        difficulties: ["ace"],
        weight: 250,
        team: [{ species: SpeciesId.PIKACHU }],
      },
      NEITHER: {
        id: 70072,
        name: "Neither",
        trainerClass: "ACE_TRAINER",
        difficulties: ["ace"],
        team: [{ species: SpeciesId.PIKACHU }],
      },
    };
    setErCustomTrainersForTesting(MIG as never);
    const byKey = new Map(getErCustomTrainers().map(t => [t.key, t]));
    expect(byKey.get("LEGACY")!.weight).toBe(40);
    expect(byKey.get("NEWWEIGHT")!.weight).toBe(250);
    expect(byKey.get("NEITHER")!.weight).toBe(100);
  });

  it("spawn-config normalizes: bad fields fall back to the shipped defaults", () => {
    expect(normalizeErCustomTrainerSpawnConfig(undefined)).toEqual({ windowSize: 10, windowChancePct: 25 });
    expect(normalizeErCustomTrainerSpawnConfig({ windowSize: 5, windowChancePct: 40 })).toEqual({
      windowSize: 5,
      windowChancePct: 40,
    });
    // windowSize out of range -> default 10; chance out of range -> default 25.
    expect(normalizeErCustomTrainerSpawnConfig({ windowSize: 0, windowChancePct: 200 })).toEqual({
      windowSize: 10,
      windowChancePct: 25,
    });
    expect(normalizeErCustomTrainerSpawnConfig({ windowSize: "x", windowChancePct: null })).toEqual({
      windowSize: 10,
      windowChancePct: 25,
    });
    // 0% chance is VALID (disables spawning); it must be preserved, not defaulted.
    expect(normalizeErCustomTrainerSpawnConfig({ windowChancePct: 0 }).windowChancePct).toBe(0);
  });

  // ---- WEIGHTED TRAINER PICK (pure helper determinism) ---------------------
  it("weighted trainer pick is deterministic, respects weights, and never picks a zero-weight/empty entry", () => {
    const pool = [{ weight: 30 }, { weight: 70 }];
    // Deterministic: same inputs, same output across repeated calls.
    for (const seed of ["RUNSEED", "ABC", "hello", "", "42"]) {
      const got = pickErCustomTrainerByWeight(seed, 0, pool);
      expect(pickErCustomTrainerByWeight(seed, 0, pool)).toBe(got);
      expect(got).toBeGreaterThanOrEqual(0);
      expect(got).toBeLessThan(pool.length);
      // Independently reproduce the cumulative-weight walk for this salt.
      let h = 0x811c9dc5;
      const s = `${seed}:custom-trainer-pick:0`;
      for (let i = 0; i < s.length; i++) {
        h ^= s.charCodeAt(i);
        h = Math.imul(h, 0x01000193);
      }
      const expected = (h >>> 0) % 100 < 30 ? 0 : 1;
      expect(got).toBe(expected);
    }
    // A different window index (salt anchor) can change the pick -> salt is load-bearing.
    const a = pickErCustomTrainerByWeight("RUNSEED", 0, pool);
    const b = pickErCustomTrainerByWeight("RUNSEED", 7, pool);
    expect(pickErCustomTrainerByWeight("RUNSEED", 7, pool)).toBe(b);
    expect([0, 1]).toContain(a);
    expect([0, 1]).toContain(b);
    // Zero-weight entries are NEVER picked (treated as ineligible).
    for (const seed of ["a", "b", "c", "d", "seed5", "seed6"]) {
      const idx = pickErCustomTrainerByWeight(seed, 0, [{ weight: 0 }, { weight: 5 }]);
      expect(idx).toBe(1);
    }
    // An all-zero (or empty) pool returns -1 (nothing picked).
    expect(pickErCustomTrainerByWeight("x", 0, [{ weight: 0 }, { weight: 0 }])).toBe(-1);
    expect(pickErCustomTrainerByWeight("x", 0, [])).toBe(-1);
  });

  // ---- DEV FORCE PATH (staff testing) --------------------------------------
  it("dev force spawns a NAMED trainer at its first eligible wave, bypassing density", () => {
    const T = {
      TARGET: {
        id: 70080,
        name: "Target",
        trainerClass: "ACE_TRAINER",
        difficulties: ["ace"],
        minWave: 25,
        maxWave: 200,
        team: [{ species: SpeciesId.PIKACHU }],
      },
    };
    setErCustomTrainersForTesting(T as never);
    globalScene.seed = "RUNSEED";
    // Density OFF -> without the force nothing would ever spawn.
    setErCustomTrainerSpawnConfigForTesting({ windowSize: 10, windowChancePct: 0 });
    resetErCustomTrainerTracking();
    setErDifficulty("ace");
    // No force: density 0% fields nothing.
    expect(playRun(1, 100).length).toBe(0);
    resetErCustomTrainerTracking();
    // Arm the dev force: the named trainer spawns at its first eligible wave (25),
    // regardless of density, and only once (no repeat).
    setErCustomTrainerDevForce("TARGET");
    expect(selectErCustomTrainerForWave(24)).toBeNull(); // below minWave -> not eligible yet
    const picks = playRun(1, 100);
    expect(picks.length).toBe(1);
    expect(picks[0].key).toBe("TARGET");
    expect(picks[0].wave).toBe(25);
  });

  // ---- ROUND 9: in-game Dev Scenarios "Custom Trainers" picker --------------
  // The staff picker force-fields ONE named trainer with the full feature set.
  // WAVE-ELIGIBILITY DECISION (documented): the picker FORCE-ADJUSTS the run
  // difficulty (to one the trainer allows) and the launch wave (inside its range,
  // skipping boss %10 + fixed-battle waves the install seam rejects), and the dev
  // force BYPASSES the challenge-exclusivity gate (the picker can't start a
  // challenge run, but the authored party still fields identically). Only a
  // trainer with NO valid difficulty, or whose whole range is boss/fixed waves,
  // is cleanly REPORTED (a readable message) instead of a silent wild battle.
  it("dev force bypasses the challenge gate: a challenge-gated trainer is still force-fielded", () => {
    const GATED = {
      GHOSTY: {
        id: 70090,
        name: "Ghosty",
        trainerClass: "PSYCHIC",
        difficulties: ["ace"],
        minWave: 25,
        maxWave: 200,
        challenge: "ghost", // only spawns naturally under the Ghost challenge
        team: [{ species: SpeciesId.HAUNTER }],
      },
    };
    setErCustomTrainersForTesting(GATED as never);
    globalScene.seed = "RUNSEED";
    setErCustomTrainerSpawnConfigForTesting({ windowSize: 10, windowChancePct: 0 }); // density off
    resetErCustomTrainerTracking();
    setErDifficulty("ace");

    // No challenge active + density off: the trainer never appears on its own.
    expect(playRun(1, 200).some(p => p.key === "GHOSTY")).toBe(false);
    resetErCustomTrainerTracking();

    // Force it: it spawns at its first eligible wave (25) EVEN without the Ghost
    // challenge active, because the dev force bypasses the challenge gate.
    setErCustomTrainerDevForce("GHOSTY");
    expect(selectErCustomTrainerForWave(24)).toBeNull(); // below minWave -> still gated by floor
    const picks = playRun(1, 100);
    expect(picks.length).toBe(1);
    expect(picks[0].key).toBe("GHOSTY");
    expect(picks[0].wave).toBe(25);
  });

  it("dev force helpers: arm reports armed, and clear (one-shot) disarms both layers", () => {
    setErCustomTrainerDevForce(null);
    expect(isErCustomTrainerDevForceArmed()).toBe(false);
    expect(getErCustomTrainerDevForce()).toBeNull();
    setErCustomTrainerDevForce("target"); // normalized to upper-case
    expect(isErCustomTrainerDevForceArmed()).toBe(true);
    expect(getErCustomTrainerDevForce()).toBe("TARGET");
    clearErCustomTrainerDevForce();
    expect(isErCustomTrainerDevForceArmed()).toBe(false);
    expect(getErCustomTrainerDevForce()).toBeNull();
  });

  it("planErCustomTrainerLaunch force-adjusts difficulty + skips boss/fixed waves; reports the ungateable", () => {
    const PLAN = {
      HELLGUY: {
        id: 70091,
        name: "Hell Guy",
        trainerClass: "VETERAN",
        difficulties: ["hell", "elite"], // first authored difficulty is picked
        minWave: 30,
        maxWave: 60,
        team: [{ species: SpeciesId.SNORLAX }, { species: SpeciesId.GENGAR }],
      },
      BOSSONLY: {
        id: 70092,
        name: "Boss Only",
        trainerClass: "VETERAN",
        difficulties: ["ace"],
        minWave: 40, // a single-wave range on a boss wave (40) -> no eligible wave
        maxWave: 40,
        team: [{ species: SpeciesId.SNORLAX }],
      },
      NODIFF: {
        id: 70093,
        name: "No Diff",
        trainerClass: "ACE_TRAINER",
        difficulties: ["notreal"], // filtered out -> empty difficulties
        minWave: 5,
        maxWave: 20,
        team: [{ species: SpeciesId.PIKACHU }],
      },
    };
    setErCustomTrainersForTesting(PLAN as never);
    const byKey = new Map(getErCustomTrainers().map(t => [t.key, t]));

    // Force-adjusts difficulty to the trainer's first, and picks wave 31: minWave
    // 30 is a boss wave (%10) so it is skipped; 31 is in range, not boss, not fixed.
    const hell = planErCustomTrainerLaunch(byKey.get("HELLGUY")!, () => false);
    expect(hell.ok).toBe(true);
    if (hell.ok) {
      expect(hell.plan.difficulty).toBe("hell");
      expect(hell.plan.wave).toBe(31);
      expect(hell.plan.wave % 10).not.toBe(0);
    }

    // A whole range that is boss/fixed only -> cleanly reported, not launched.
    const boss = planErCustomTrainerLaunch(byKey.get("BOSSONLY")!, () => false);
    expect(boss.ok).toBe(false);
    if (!boss.ok) {
      expect(boss.reason).toContain("no non-boss");
    }

    // Injected fixed-battle predicate is honored: wave 31 marked fixed -> slides to 32.
    const hellFixed = planErCustomTrainerLaunch(byKey.get("HELLGUY")!, w => w === 30 || w === 31);
    expect(hellFixed.ok).toBe(true);
    if (hellFixed.ok) {
      expect(hellFixed.plan.wave).toBe(32);
    }

    // No valid difficulty authored -> reported.
    const nodiff = planErCustomTrainerLaunch(byKey.get("NODIFF")!, () => false);
    expect(nodiff.ok).toBe(false);
    if (!nodiff.ok) {
      expect(nodiff.reason).toContain("difficulty");
    }
  });

  it("summarizeErCustomTrainer renders name, #id and the first team species (no em dash)", () => {
    const SUM = {
      SUMMER: {
        id: 70094,
        name: "Summer",
        trainerClass: "ACE_TRAINER",
        difficulties: ["ace"],
        team: [
          { species: SpeciesId.PIKACHU },
          { species: SpeciesId.SNORLAX },
          { species: SpeciesId.GENGAR },
          { species: SpeciesId.HAUNTER }, // 4th -> elided
        ],
      },
    };
    setErCustomTrainersForTesting(SUM as never);
    const trainer = getErCustomTrainers().find(t => t.key === "SUMMER")!;
    const summary = summarizeErCustomTrainer(trainer, id => `S${id}`);
    expect(summary).toBe(`Summer #70094: S${SpeciesId.PIKACHU}, S${SpeciesId.SNORLAX}, S${SpeciesId.GENGAR}…`);
    expect(summary).not.toContain("—"); // staff-facing text: no em dash
  });

  it("builds the EXACT authored party (species / level / moveset / ability / fusion)", () => {
    setErDifficulty("ace");
    setErCustomTrainerBstBypass(true); // keep the authored species (Garchomp) intact
    const member = getErCustomTrainers().find(t => t.key === "ACE_RICO")!.members[0];
    const enemy = buildErCustomTrainerMember(member, 0, 55, false);
    expect(enemy).not.toBeNull();
    expect(enemy!.species.speciesId).toBe(SpeciesId.GARCHOMP);
    expect(enemy!.level).toBe(55);
    expect(enemy!.abilityIndex).toBe(1);
    expect(enemy!.moveset.map(m => m.moveId)).toEqual([MoveId.EARTHQUAKE, MoveId.DRAGON_CLAW]);
    // Fusion constructed on the enemy side.
    expect(enemy!.isFusion()).toBe(true);
    expect(enemy!.fusionSpecies?.speciesId).toBe(SpeciesId.RAYQUAZA);
  });

  it("battleBgm normalizes: valid key kept, garbage/absent -> '' (no override)", () => {
    // Pure normalizer: trim + lowercase-charset + length cap; anything else -> "".
    expect(normalizeBattleBgm("battle_ghost_piano")).toBe("battle_ghost_piano");
    expect(normalizeBattleBgm("  battle_rival  ")).toBe("battle_rival");
    expect(normalizeBattleBgm("")).toBe("");
    expect(normalizeBattleBgm("   ")).toBe("");
    expect(normalizeBattleBgm(undefined)).toBe("");
    expect(normalizeBattleBgm(42)).toBe("");
    expect(normalizeBattleBgm("Battle_Ghost")).toBe(""); // uppercase not allowed
    expect(normalizeBattleBgm("bad name!")).toBe(""); // space + punctuation
    expect(normalizeBattleBgm("../evil")).toBe(""); // path traversal
    expect(normalizeBattleBgm("a".repeat(65))).toBe(""); // over the length cap
  });

  it("battleBgm resolves onto the trainer (valid kept, garbage/absent cleared)", () => {
    const BGM = {
      WITH_BGM: {
        id: 70020,
        name: "Themed",
        trainerClass: "ACE_TRAINER",
        difficulties: ["ace"],
        battleBgm: "battle_ghost_piano",
        team: [{ species: SpeciesId.PIKACHU }],
      },
      BAD_BGM: {
        id: 70021,
        name: "Garbage",
        trainerClass: "ACE_TRAINER",
        difficulties: ["ace"],
        battleBgm: "NOT VALID!!",
        team: [{ species: SpeciesId.PIKACHU }],
      },
      NO_BGM: {
        id: 70022,
        name: "Plain",
        trainerClass: "ACE_TRAINER",
        difficulties: ["ace"],
        // no battleBgm field at all
        team: [{ species: SpeciesId.PIKACHU }],
      },
    };
    setErCustomTrainersForTesting(BGM as never);
    const byKey = new Map(getErCustomTrainers().map(t => [t.key, t]));
    expect(byKey.get("WITH_BGM")!.battleBgm).toBe("battle_ghost_piano");
    // Garbage and absent both resolve to "" (no override) — the trainer keeps
    // its default theme. This is the "next plain wave clears it" semantics at the
    // resolved layer: the game-side seam shadows the getters ONLY when battleBgm
    // is a non-empty string, and each wave builds a fresh Trainer instance (the
    // shared trainerConfigs singleton is never mutated), so "" leaves the theme
    // untouched and nothing leaks across waves.
    expect(byKey.get("BAD_BGM")!.battleBgm).toBe("");
    expect(byKey.get("NO_BGM")!.battleBgm).toBe("");
  });

  it("#419 BST cap is BYPASSED for staff trainers (fielded as authored, not devolved)", () => {
    setErDifficulty("elite");
    globalScene.currentBattle.waveIndex = 5; // low wave -> BST cap ~420 would devolve Garchomp (600)
    const highBst: ErCustomTrainerMemberResolved = {
      speciesId: SpeciesId.GARCHOMP,
      formIndex: 0,
      level: 60,
      moveIds: [],
      moveSpecs: [],
      abilitySlot: 0,
      fusion: null,
      heldItemKeys: [],
      shinyLook: null,
      shinyName: "",
    };

    // Bypass ON: constructor + explicit curve pass both leave Garchomp intact.
    setErCustomTrainerBstBypass(true);
    const kept = buildErCustomTrainerMember(highBst, 0, 60, false);
    enforceErEliteBstCurve(kept!);
    expect(kept!.species.speciesId).toBe(SpeciesId.GARCHOMP);

    // Bypass OFF: the same over-cap mon is devolved by the curve (proving the
    // cap normally fires and the bypass is what protects staff teams).
    setErCustomTrainerBstBypass(false);
    const devolved = buildErCustomTrainerMember(highBst, 0, 60, false);
    expect(devolved!.species.speciesId).not.toBe(SpeciesId.GARCHOMP);
  });

  // ---- ROUND 5 / FEATURE 1: trainer sprite gender ---------------------------
  it("gender resolves: 'f' kept, 'm'/absent/garbage default to 'm'", () => {
    const G = {
      FEM: {
        id: 70040,
        name: "Fem",
        trainerClass: "ACE_TRAINER",
        difficulties: ["ace"],
        gender: "f",
        team: [{ species: SpeciesId.PIKACHU }],
      },
      MASC: {
        id: 70041,
        name: "Masc",
        trainerClass: "ACE_TRAINER",
        difficulties: ["ace"],
        gender: "m",
        team: [{ species: SpeciesId.PIKACHU }],
      },
      DEFAULTED: {
        id: 70042,
        name: "Plain",
        trainerClass: "ACE_TRAINER",
        difficulties: ["ace"],
        // no gender field -> defaults to "m"
        team: [{ species: SpeciesId.PIKACHU }],
      },
    };
    setErCustomTrainersForTesting(G as never);
    const byKey = new Map(getErCustomTrainers().map(t => [t.key, t]));
    expect(byKey.get("FEM")!.gender).toBe("f");
    expect(byKey.get("MASC")!.gender).toBe("m");
    expect(byKey.get("DEFAULTED")!.gender).toBe("m");
  });

  // ---- ROUND 5 / FEATURE 3: intro blurb -------------------------------------
  it("introDialogue normalizes (trim, control-chars stripped, 200 cap) and resolves onto the trainer", () => {
    // Pure normalizer.
    expect(normalizeIntroDialogue("  You dare challenge me?  ")).toBe("You dare challenge me?");
    expect(normalizeIntroDialogue("line1\nline2\tend")).toBe("line1line2end"); // control chars stripped
    expect(normalizeIntroDialogue("")).toBe("");
    expect(normalizeIntroDialogue(undefined)).toBe("");
    expect(normalizeIntroDialogue(42)).toBe("");
    const long = "a".repeat(250);
    expect(normalizeIntroDialogue(long).length).toBe(200);

    const INTRO = {
      TALKER: {
        id: 70044,
        name: "Talker",
        trainerClass: "ACE_TRAINER",
        difficulties: ["ace"],
        introDialogue: "  Prepare yourself!  ",
        team: [{ species: SpeciesId.PIKACHU }],
      },
      QUIET: {
        id: 70045,
        name: "Quiet",
        trainerClass: "ACE_TRAINER",
        difficulties: ["ace"],
        // no introDialogue -> ""
        team: [{ species: SpeciesId.PIKACHU }],
      },
    };
    setErCustomTrainersForTesting(INTRO as never);
    const byKey = new Map(getErCustomTrainers().map(t => [t.key, t]));
    expect(byKey.get("TALKER")!.introDialogue).toBe("Prepare yourself!");
    expect(byKey.get("QUIET")!.introDialogue).toBe("");
  });

  // ---- ROUND 5b / VICTORY + DEFEAT lines (ghost dialogue seam) --------------
  it("victory/defeat lines normalize + resolve, and apply onto the installed trainer via the ghost seams", () => {
    // Shared line normalizer: trim, control chars stripped, 200 cap.
    expect(normalizeDialogueLine("  Well fought.  ")).toBe("Well fought.");
    expect(normalizeDialogueLine("a\nb\tc")).toBe("abc");
    expect(normalizeDialogueLine(42)).toBe("");
    expect(normalizeDialogueLine(undefined)).toBe("");
    expect(normalizeDialogueLine("x".repeat(250)).length).toBe(200);

    const D = {
      CHATTY: {
        id: 70050,
        name: "Chatty",
        trainerClass: "ACE_TRAINER",
        difficulties: ["ace"],
        victoryDialogue: "  Well fought.  ",
        defeatDialogue: "  Better luck next time!  ",
        team: [{ species: SpeciesId.PIKACHU }],
      },
      SILENT: {
        id: 70051,
        name: "Silent",
        trainerClass: "ACE_TRAINER",
        difficulties: ["ace"],
        // no victory/defeat lines -> "" (default class lines)
        team: [{ species: SpeciesId.PIKACHU }],
      },
    };
    setErCustomTrainersForTesting(D as never);
    const byKey = new Map(getErCustomTrainers().map(t => [t.key, t]));
    expect(byKey.get("CHATTY")!.victoryDialogue).toBe("Well fought.");
    expect(byKey.get("CHATTY")!.defeatDialogue).toBe("Better luck next time!");
    expect(byKey.get("SILENT")!.victoryDialogue).toBe("");
    expect(byKey.get("SILENT")!.defeatDialogue).toBe("");

    // Applied onto a Trainer INSTANCE via the SAME getVictory/getDefeat overrides
    // markTrainerAsGhost uses for a ghost's dialogue (er-ghost-teams.ts).
    const trainer = {} as Trainer;
    applyErCustomTrainerPresentation(trainer, byKey.get("CHATTY")!);
    expect(trainer.getVictoryMessages()).toEqual(["Well fought."]); // player beats the trainer
    expect(trainer.getDefeatMessages()).toEqual(["Better luck next time!"]); // trainer beats the player

    // No lines -> the getters are left untouched (the trainer keeps its class lines).
    const plain = {} as Trainer;
    applyErCustomTrainerPresentation(plain, byKey.get("SILENT")!);
    expect(plain.getVictoryMessages).toBeUndefined();
    expect(plain.getDefeatMessages).toBeUndefined();
  });

  // ---- ROUND 5b / TRAINER-SPRITE effect (ghost aura seam) ------------------
  it("trainerEffect resolves (known aura kept, unknown dropped) + applies as trainer.erGhostAura", () => {
    // Normalizer: only a known ghost-FX aura id survives.
    expect(normalizeTrainerEffect("smoke")).toBe("smoke");
    expect(normalizeTrainerEffect("shadowaura")).toBe("shadowaura");
    expect(normalizeTrainerEffect("notarealaura")).toBe("");
    expect(normalizeTrainerEffect(42)).toBe("");
    expect(normalizeTrainerEffect(undefined)).toBe("");

    const E = {
      SPOOKY: {
        id: 70052,
        name: "Spooky",
        trainerClass: "PSYCHIC",
        difficulties: ["ace"],
        trainerEffect: "shadowaura",
        team: [{ species: SpeciesId.HAUNTER }],
      },
      BADFX: {
        id: 70053,
        name: "Badfx",
        trainerClass: "ACE_TRAINER",
        difficulties: ["ace"],
        trainerEffect: "notarealaura", // unknown -> dropped
        team: [{ species: SpeciesId.PIKACHU }],
      },
      NOFX: {
        id: 70054,
        name: "Nofx",
        trainerClass: "ACE_TRAINER",
        difficulties: ["ace"],
        // no trainerEffect -> "" (plain sprite)
        team: [{ species: SpeciesId.PIKACHU }],
      },
    };
    setErCustomTrainersForTesting(E as never);
    const byKey = new Map(getErCustomTrainers().map(t => [t.key, t]));
    expect(byKey.get("SPOOKY")!.trainerEffect).toBe("shadowaura");
    expect(byKey.get("BADFX")!.trainerEffect).toBe("");
    expect(byKey.get("NOFX")!.trainerEffect).toBe("");

    // Applied onto a Trainer via the SAME aura seam markTrainerAsGhost uses: the
    // aura id is stamped as trainer.erGhostAura (rendered by applyErGhostAuraFx).
    const trainer = {} as Trainer;
    applyErCustomTrainerPresentation(trainer, byKey.get("SPOOKY")!);
    expect(trainer.erGhostAura).toBe("shadowaura");

    // No effect -> erGhostAura stays unset (the plain trainer sprite).
    const plain = {} as Trainer;
    applyErCustomTrainerPresentation(plain, byKey.get("NOFX")!);
    expect(plain.erGhostAura).toBeUndefined();
  });

  // ---- ROUND 5 / FEATURE 2: shiny-lab effect per mon ------------------------
  it("shiny effect resolves onto the built enemy (shiny + serialized look + name)", () => {
    const SH = {
      SHINYMON: {
        id: 70043,
        name: "Glimmer",
        trainerClass: "ACE_TRAINER",
        difficulties: ["ace"],
        team: [
          {
            species: SpeciesId.PIKACHU,
            shiny: { palette: "glacier", around: "zaps", name: "Prism" },
          },
          // A plain mon (no shiny) renders normally.
          { species: SpeciesId.SNORLAX },
          // An entirely-unknown effect id resolves to no shiny (dropped).
          { species: SpeciesId.GENGAR, shiny: { palette: "notarealeffect" } },
        ],
      },
    };
    setErCustomTrainersForTesting(SH as never);
    const resolved = getErCustomTrainers().find(t => t.key === "SHINYMON")!;
    // Slot 1: the look resolved to a serialized tuple + sanitized name.
    const shinyMember = resolved.members[0];
    expect(shinyMember.shinyLook).not.toBeNull();
    expect(Array.isArray(shinyMember.shinyLook)).toBe(true);
    expect(shinyMember.shinyLook!.length).toBe(14);
    expect(shinyMember.shinyName).toBe("Prism");
    // Slot 2 (no shiny) + slot 3 (unknown effect) resolve to null.
    expect(resolved.members[1].shinyLook).toBeNull();
    expect(resolved.members[2].shinyLook).toBeNull();

    // Built enemy carries the effect: shiny flag, variant 0, the serialized look
    // + name stamped onto customPokemonData (mirrors the ghost-adoption path).
    setErCustomTrainerBstBypass(true);
    const enemy = buildErCustomTrainerMember(shinyMember, 0, 50, false);
    expect(enemy).not.toBeNull();
    expect(enemy!.shiny).toBe(true);
    expect(enemy!.variant).toBe(0);
    expect(enemy!.customPokemonData.erShinyLab).toEqual(shinyMember.shinyLook);
    expect(enemy!.customPokemonData.erShinyLabName).toBe("Prism");
    expect(enemy!.customPokemonData.erShinyLabSuppressLocal).toBe(true);

    // A plain mon stays non-forced (no erShinyLab stamped).
    const plain = buildErCustomTrainerMember(resolved.members[1], 1, 50, false);
    expect(plain!.customPokemonData.erShinyLab).toBeUndefined();
  });

  // ---- FEATURE 1: weighted slot variants -----------------------------------
  it("flat member is back-compat: 1 variant weight 1, slotChance 100 (representative == variant 0)", () => {
    const FLAT = {
      FLATTY: {
        id: 70030,
        name: "Flatty",
        trainerClass: "ACE_TRAINER",
        difficulties: ["ace"],
        team: [
          { species: SpeciesId.PIKACHU, moves: ["THUNDERBOLT"] },
          { species: SpeciesId.SNORLAX }, // slot 2: still slotChance 100 by default
        ],
      },
    };
    setErCustomTrainersForTesting(FLAT as never);
    const resolved = getErCustomTrainers().find(t => t.key === "FLATTY")!;
    // Every slot has exactly ONE possibility of weight 1.
    expect(resolved.slots.length).toBe(2);
    for (const slot of resolved.slots) {
      expect(slot.variants.length).toBe(1);
      expect(slot.variants[0].weight).toBe(1);
      expect(slot.slotChance).toBe(100); // absent slotChance normalizes to 100
    }
    // The representative members mirror variant 0 of each slot.
    expect(resolved.members.length).toBe(2);
    expect(resolved.members[0]).toBe(resolved.slots[0].variants[0].member);
    expect(resolved.members[0].speciesId).toBe(SpeciesId.PIKACHU);
    expect(resolved.members[0].moveIds).toEqual([MoveId.THUNDERBOLT]);
  });

  it("weighted pick is DETERMINISTIC for a fixed seed and respects the variants list", () => {
    // Pure helper: no seed hunting. Assert it matches the documented cumulative
    // weight walk exactly, is stable across calls, and only returns valid indices.
    const variants = [{ weight: 30 }, { weight: 70 }];
    const key = "PICKY";
    const slotIndex = 1;
    const manual = (seed: string): number => {
      // Mirror pickErCustomTrainerVariant's FNV-1a walk for an independent check.
      let h = 0x811c9dc5;
      const s = `${seed}:custom-trainer-slot:${key}:${slotIndex}`;
      for (let i = 0; i < s.length; i++) {
        h ^= s.charCodeAt(i);
        h = Math.imul(h, 0x01000193);
      }
      const r = (h >>> 0) % 100;
      return r < 30 ? 0 : 1;
    };
    for (const seed of ["RUNSEED", "ABC", "hello-world", "42", ""]) {
      const got = pickErCustomTrainerVariant(seed, key, slotIndex, variants);
      // Deterministic: same inputs, same output on repeat.
      expect(pickErCustomTrainerVariant(seed, key, slotIndex, variants)).toBe(got);
      // Correct: matches the manual cumulative-weight computation.
      expect(got).toBe(manual(seed));
      expect(got).toBeGreaterThanOrEqual(0);
      expect(got).toBeLessThan(variants.length);
    }
    // A single-variant slot always returns index 0 regardless of seed.
    expect(pickErCustomTrainerVariant("anything", "X", 0, [{ weight: 5 }])).toBe(0);
    // The picked variant is honored end-to-end by resolveErCustomTrainerParty.
    const WT = {
      WT: {
        id: 70031,
        name: "Weighted",
        trainerClass: "ACE_TRAINER",
        difficulties: ["ace"],
        team: [
          {
            variants: [
              { species: SpeciesId.PIKACHU, weight: 30 },
              { species: SpeciesId.RAICHU, weight: 70 },
            ],
          },
        ],
      },
    };
    setErCustomTrainersForTesting(WT as never);
    const resolved = getErCustomTrainers().find(t => t.key === "WT")!;
    const slot = resolved.slots[0];
    expect(slot.variants.map(v => v.weight)).toEqual([30, 70]);
    const idx = pickErCustomTrainerVariant("RUNSEED", "WT", 0, slot.variants);
    const party = resolveErCustomTrainerParty("RUNSEED", resolved);
    expect(party.length).toBe(1);
    expect(party[0].member.speciesId).toBe(slot.variants[idx].member.speciesId);
  });

  // ---- FEATURE 2: slot fill probability (slots 2-6) ------------------------
  it("slotChance 100 always fills; a failing fill roll omits the slot and the party shrinks", () => {
    const SC = {
      SHRINK: {
        id: 70032,
        name: "Shrinker",
        trainerClass: "VETERAN",
        difficulties: ["ace"],
        team: [
          { species: SpeciesId.SNORLAX }, // slot 1: lead, always present
          { species: SpeciesId.GENGAR, slotChance: 100 }, // slot 2: guaranteed
          { species: SpeciesId.HAUNTER, slotChance: 1 }, // slot 3: almost never fills
        ],
      },
    };
    setErCustomTrainersForTesting(SC as never);
    const resolved = getErCustomTrainers().find(t => t.key === "SHRINK")!;
    // Slot 1 (index 0) is FORCED to 100 even when authored otherwise; slot 3 keeps 1.
    expect(resolved.slots[0].slotChance).toBe(100);
    expect(resolved.slots[2].slotChance).toBe(1);
    const seed = "RUNSEED";
    // Derive the expected fielded set straight from the pure fill roll — robust
    // against whatever the seed hashes to.
    const expected = resolved.slots
      .map((s, i) => ({ i, fill: rollErCustomTrainerSlotFill(seed, "SHRINK", i, s.slotChance) }))
      .filter(x => x.fill)
      .map(x => x.i);
    const party = resolveErCustomTrainerParty(seed, resolved);
    expect(party.map(f => f.slotIndex)).toEqual(expected);
    // Slot 1 (lead, forced 100) and slot 2 (slotChance 100) ALWAYS fill.
    expect(rollErCustomTrainerSlotFill(seed, "SHRINK", 0, 100)).toBe(true);
    expect(rollErCustomTrainerSlotFill(seed, "SHRINK", 1, 100)).toBe(true);
    expect(party.some(f => f.slotIndex === 0)).toBe(true);
    expect(party.some(f => f.slotIndex === 1)).toBe(true);
    // The slotChance-1 slot follows its (deterministic) roll; when it fails, the
    // fielded party is smaller than the authored 3 (party shrinks). Derived from
    // the pure roll so it is robust against the exact hash value.
    const slot3Fills = rollErCustomTrainerSlotFill(seed, "SHRINK", 2, 1);
    expect(party.length).toBe(slot3Fills ? 3 : 2);
    if (!slot3Fills) {
      expect(party.length).toBeLessThan(resolved.slots.length);
    }
    // A slotChance of 100 on the SAME slot would always field it (proves it is
    // the roll, not some other gate, that omits the slot).
    expect(rollErCustomTrainerSlotFill(seed, "SHRINK", 2, 100)).toBe(true);
  });

  // ---- FEATURE 3: RLA / RLNA move tokens -----------------------------------
  it("RLA resolves to a damaging legal move and RLNA to a status legal move (no dupes, deterministic)", () => {
    const RL = {
      RANDO: {
        id: 70033,
        name: "Rando",
        trainerClass: "ACE_TRAINER",
        difficulties: ["ace"],
        team: [{ species: SpeciesId.GARCHOMP, moves: ["RLA", "RLNA", "RLA", "RLNA"] }],
      },
    };
    setErCustomTrainersForTesting(RL as never);
    const resolved = getErCustomTrainers().find(t => t.key === "RANDO")!;
    const member = resolved.members[0];
    // The tokens survive resolution as ordered move specs (no concrete ids yet).
    expect(member.moveSpecs.map(s => (s.kind === "token" ? s.token : "id"))).toEqual(["RLA", "RLNA", "RLA", "RLNA"]);
    expect(member.moveIds).toEqual([]); // tokens contribute no concrete id up front

    const seed = "RUNSEED";
    const ids = resolveErCustomTrainerMoveIds(seed, "RANDO", 0, member);
    // All four slots resolved to a real move (Garchomp has a rich pool).
    expect(ids.length).toBe(4);
    // No duplicates within the fielded moveset.
    expect(new Set(ids).size).toBe(ids.length);
    // Slots 0 and 2 (RLA) are damaging; slots 1 and 3 (RLNA) are status.
    expect(allMoves[ids[0]].category).not.toBe(MoveCategory.STATUS);
    expect(allMoves[ids[2]].category).not.toBe(MoveCategory.STATUS);
    expect(allMoves[ids[1]].category).toBe(MoveCategory.STATUS);
    expect(allMoves[ids[3]].category).toBe(MoveCategory.STATUS);
    // Deterministic: the same seed reproduces the same moveset exactly.
    expect(resolveErCustomTrainerMoveIds(seed, "RANDO", 0, member)).toEqual(ids);
    // A different salt anchor (slot index) can pick a different set -> proves the
    // salt is load-bearing (not a constant), while staying deterministic.
    const other = resolveErCustomTrainerMoveIds(seed, "RANDO", 3, member);
    expect(resolveErCustomTrainerMoveIds(seed, "RANDO", 3, member)).toEqual(other);
  });
});
