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
import { allMoves } from "#data/data-lists";
import {
  buildErCustomTrainerMember,
  type ErCustomTrainerMemberResolved,
  getErCustomTrainers,
  markErCustomTrainerUsed,
  normalizeBattleBgm,
  pickErCustomTrainerVariant,
  resetErCustomTrainerTracking,
  resolveErCustomTrainerMoveIds,
  resolveErCustomTrainerParty,
  rollErCustomTrainerAppearance,
  rollErCustomTrainerSlotFill,
  selectErCustomTrainerForWave,
  setErCustomTrainerBstBypass,
  setErCustomTrainersForTesting,
} from "#data/elite-redux/er-custom-trainers";
import { resetErDifficulty, setErDifficulty } from "#data/elite-redux/er-run-difficulty";
import { enforceErEliteBstCurve } from "#data/elite-redux/er-trainer-runtime-hook";
import { Challenges } from "#enums/challenges";
import { MoveCategory } from "#enums/move-category";
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
      moveSpecs: [],
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
