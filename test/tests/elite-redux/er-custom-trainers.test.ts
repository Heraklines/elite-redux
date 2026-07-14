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

import { globalScene } from "#app/global-scene";
import {
  buildErCustomTrainerMember,
  type ErCustomTrainerMemberResolved,
  getErCustomTrainers,
  markErCustomTrainerUsed,
  normalizeBattleBgm,
  resetErCustomTrainerTracking,
  rollErCustomTrainerAppearance,
  selectErCustomTrainerForWave,
  setErCustomTrainerBstBypass,
  setErCustomTrainersForTesting,
} from "#data/elite-redux/er-custom-trainers";
import { resetErDifficulty, setErDifficulty } from "#data/elite-redux/er-run-difficulty";
import { enforceErEliteBstCurve } from "#data/elite-redux/er-trainer-runtime-hook";
import { Challenges } from "#enums/challenges";
import { MoveId } from "#enums/move-id";
import { SpeciesId } from "#enums/species-id";
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
 * new-battle-phase.ts does). Returns every appearance as `{ wave, key }`. Because
 * a trainer's appearance is once-per-run at a seed-assigned wave, sweeping the
 * whole window is the seed-robust way to observe the gates.
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
    resetErCustomTrainerTracking();
    setErCustomTrainerBstBypass(false);
    // NB: do NOT set an enemySpecies/enemyLevel override — either forces every
    // addEnemyPokemon (incl. buildErCustomTrainerMember) to that species/level,
    // masking the exact-party build.
    game.override.battleStyle("single").startingLevel(50);
    await game.classicMode.startBattle(SpeciesId.SNORLAX);
  });

  afterEach(() => {
    setErCustomTrainersForTesting(undefined);
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
    // On ace, HELL_BOSS is hell-only -> never appears anywhere in its window.
    expect(playRun(1, 200).some(p => p.key === "HELL_BOSS")).toBe(false);
    resetErCustomTrainerTracking();
    setErDifficulty("hell");
    // On hell it is the only eligible trainer and appears exactly once, inside
    // its window (50..200).
    const hellPicks = playRun(1, 200).filter(p => p.key === "HELL_BOSS");
    expect(hellPicks.length).toBe(1);
    expect(hellPicks[0].wave).toBeGreaterThanOrEqual(50);
    expect(hellPicks[0].wave).toBeLessThanOrEqual(200);
  });

  it("gates by floor range and endless (assigned wave stays inside the window)", () => {
    setErDifficulty("ace");
    // Below ACE_RICO's min (10) and ENDLESS_T's (100), nothing is due yet.
    expect(selectErCustomTrainerForWave(5)).toBeNull();
    // Sweep the whole run: ACE_RICO fires once in 10..40, ENDLESS_T once at
    // some floor >= 100 (endless window). Neither ever appears out of range.
    const byKey = new Map(playRun(1, 320).map(p => [p.key, p.wave]));
    const ace = byKey.get("ACE_RICO");
    expect(ace).toBeDefined();
    expect(ace!).toBeGreaterThanOrEqual(10);
    expect(ace!).toBeLessThanOrEqual(40);
    const endless = byKey.get("ENDLESS_T");
    expect(endless).toBeDefined();
    expect(endless!).toBeGreaterThanOrEqual(100);
  });

  it("gates by challenge-exclusivity (ghost trainer only when the challenge is active)", () => {
    setErDifficulty("ace");
    // No challenge active -> ghost-only trainer never appears in a full run.
    expect(playRun(1, 200).some(p => p.key === "GHOST_ONLY")).toBe(false);
    resetErCustomTrainerTracking();
    // Activate the Ghost challenge -> the ghost-only trainer appears once.
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
    // Activate the Hardcore challenge -> the hardcore-only trainer appears once.
    globalScene.gameMode.challenges.push({ id: Challenges.HARDCORE, value: 1 } as never);
    try {
      expect(playRun(1, 200).some(p => p.key === "HARDCORE_ONLY")).toBe(true);
    } finally {
      globalScene.gameMode.challenges.pop();
    }
  });

  it("no-repeat: every eligible trainer fires at most once across a whole run", () => {
    setErDifficulty("ace");
    globalScene.gameMode.challenges.push({ id: Challenges.GHOST_TRAINERS, value: 1 } as never);
    try {
      const picks = playRun(1, 320);
      const counts = new Map<string, number>();
      for (const p of picks) {
        counts.set(p.key, (counts.get(p.key) ?? 0) + 1);
      }
      // At least the ace-eligible pool fired, and NO trainer fired twice.
      expect(picks.length).toBeGreaterThan(0);
      for (const [, count] of counts) {
        expect(count).toBe(1);
      }
    } finally {
      globalScene.gameMode.challenges.pop();
    }
  });

  it("spawnChance absent is treated as 100: assigned a wave and fires exactly once (back-compat)", () => {
    const ONE = {
      SOLO: {
        id: 70010,
        name: "Solo",
        trainerClass: "ACE_TRAINER",
        battleType: "single",
        difficulties: ["ace"],
        minWave: 10,
        maxWave: 30,
        endless: false,
        // NB: no spawnChance field — a saved entry from before this feature.
        team: [{ species: SpeciesId.PIKACHU }],
      },
    };
    setErCustomTrainersForTesting(ONE as never);
    resetErCustomTrainerTracking();
    setErDifficulty("ace");
    const resolved = getErCustomTrainers().find(t => t.key === "SOLO")!;
    expect(resolved.spawnChance).toBe(100);
    const roll = rollErCustomTrainerAppearance(globalScene.seed ?? "", resolved);
    expect(roll.appears).toBe(true);
    expect(roll.assignedWave).toBeGreaterThanOrEqual(10);
    expect(roll.assignedWave).toBeLessThanOrEqual(30);
    const picks = playRun(1, 60).filter(p => p.key === "SOLO");
    expect(picks.length).toBe(1);
    expect(picks[0].wave).toBe(roll.assignedWave);
  });

  it("a failing spawnChance roll is never selected on any wave", () => {
    const ONE = {
      FLAKY: {
        id: 70011,
        name: "Flaky",
        trainerClass: "ACE_TRAINER",
        battleType: "single",
        difficulties: ["ace"],
        minWave: 10,
        maxWave: 200,
        endless: false,
        spawnChance: 30,
        team: [{ species: SpeciesId.PIKACHU }],
      },
    };
    setErCustomTrainersForTesting(ONE as never);
    globalScene.seed = "RUNSEED";
    resetErCustomTrainerTracking();
    setErDifficulty("ace");
    const resolved = getErCustomTrainers().find(t => t.key === "FLAKY")!;
    // For seed "RUNSEED" the roll hashes to 47; 47 >= 30 -> does NOT appear.
    const roll = rollErCustomTrainerAppearance("RUNSEED", resolved);
    expect(roll.appears).toBe(false);
    // Control: the SAME trainer/seed at 100% would appear (proves it's the roll,
    // not some other gate, that suppresses it).
    expect(rollErCustomTrainerAppearance("RUNSEED", { ...resolved, spawnChance: 100 }).appears).toBe(true);
    // End-to-end: never returned by the selector across its whole window.
    expect(playRun(1, 200).some(p => p.key === "FLAKY")).toBe(false);
  });

  it("DUE / slide-forward: a rolled-in trainer fires at the first wave >= its assigned wave", () => {
    const ONE = {
      SLIDER: {
        id: 70012,
        name: "Slider",
        trainerClass: "ACE_TRAINER",
        battleType: "single",
        difficulties: ["ace"],
        minWave: 10,
        maxWave: 200,
        endless: false,
        spawnChance: 100,
        team: [{ species: SpeciesId.PIKACHU }],
      },
    };
    setErCustomTrainersForTesting(ONE as never);
    globalScene.seed = "RUNSEED";
    resetErCustomTrainerTracking();
    setErDifficulty("ace");
    const resolved = getErCustomTrainers().find(t => t.key === "SLIDER")!;
    const roll = rollErCustomTrainerAppearance("RUNSEED", resolved);
    expect(roll.appears).toBe(true);
    const w = roll.assignedWave; // 70 for this seed
    // Not due before its assigned wave.
    expect(selectErCustomTrainerForWave(w - 1)).toBeNull();
    // Simulate the assigned wave itself being EXCLUDED (boss / fixed / mystery):
    // the selector is simply never called at `w`. The next non-excluded wave
    // must still return the trainer (slide forward).
    expect(selectErCustomTrainerForWave(w + 1)?.key).toBe("SLIDER");
  });

  it("once fielded, a trainer is never returned again that run", () => {
    const ONE = {
      SLIDER: {
        id: 70013,
        name: "Slider",
        trainerClass: "ACE_TRAINER",
        battleType: "single",
        difficulties: ["ace"],
        minWave: 10,
        maxWave: 200,
        endless: false,
        spawnChance: 100,
        team: [{ species: SpeciesId.PIKACHU }],
      },
    };
    setErCustomTrainersForTesting(ONE as never);
    globalScene.seed = "RUNSEED";
    resetErCustomTrainerTracking();
    setErDifficulty("ace");
    const roll = rollErCustomTrainerAppearance("RUNSEED", getErCustomTrainers().find(t => t.key === "SLIDER")!);
    const w = roll.assignedWave;
    const pick = selectErCustomTrainerForWave(w);
    expect(pick?.key).toBe("SLIDER");
    markErCustomTrainerUsed(pick!.key);
    // Never again, on the same wave or any later wave in the window.
    expect(selectErCustomTrainerForWave(w)).toBeNull();
    expect(selectErCustomTrainerForWave(w + 10)).toBeNull();
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
      abilitySlot: 0,
      fusion: null,
      heldItemKeys: [],
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
});
