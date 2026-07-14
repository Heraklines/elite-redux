/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// ER staff-authored Custom Trainers (er-custom-trainers.json) ingestion.
//
// Covers the wave-selection GATES (difficulty / floor range / endless /
// challenge-exclusivity / rotation-non-repeat), EXACT-party generation
// (species / level / moveset / ability slot / fusion) and the #419 BST-cap
// BYPASS (staff intent wins — a high-BST mon is fielded as authored, not
// devolved).
//
// Gated behind ER_SCENARIO=1.
// =============================================================================

import { globalScene } from "#app/global-scene";
import {
  buildErCustomTrainerMember,
  type ErCustomTrainerMemberResolved,
  getErCustomTrainers,
  markErCustomTrainerUsed,
  resetErCustomTrainerTracking,
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
  // Invalid: blank name -> must be dropped by getErCustomTrainers (never fatal).
  BROKEN: {
    id: 70005,
    name: "",
    trainerClass: "LASS",
    difficulties: ["ace"],
    team: [{ species: SpeciesId.PIKACHU }],
  },
};

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
    expect(keys).toEqual(["ACE_RICO", "ENDLESS_T", "GHOST_ONLY", "HELL_BOSS"]);
    expect(keys).not.toContain("BROKEN");
  });

  it("gates by difficulty: hell-only trainer never appears on ace", () => {
    setErDifficulty("ace");
    // Wave 60: ACE_RICO is out of range (max 40); HELL_BOSS is hell-only.
    expect(selectErCustomTrainerForWave(60)).toBeNull();
    setErDifficulty("hell");
    expect(selectErCustomTrainerForWave(60)?.key).toBe("HELL_BOSS");
  });

  it("gates by floor range and endless (any floor >= minWave)", () => {
    setErDifficulty("ace");
    // Below ACE_RICO's min (10) and nothing else eligible -> null.
    expect(selectErCustomTrainerForWave(5)).toBeNull();
    // In ACE_RICO's window.
    expect(selectErCustomTrainerForWave(20)?.key).toBe("ACE_RICO");
    // Past ACE_RICO's max (40) but the endless trainer covers wave >= 100.
    expect(selectErCustomTrainerForWave(45)).toBeNull();
    expect(selectErCustomTrainerForWave(150)?.key).toBe("ENDLESS_T");
  });

  it("gates by challenge-exclusivity (ghost trainer only when the challenge is active)", () => {
    setErDifficulty("ace");
    // No challenge active -> ghost-only trainer is excluded; ACE_RICO is picked.
    expect(selectErCustomTrainerForWave(20)?.key).toBe("ACE_RICO");
    // Activate the Ghost challenge -> the ghost-only trainer becomes eligible.
    globalScene.gameMode.challenges.push({ id: Challenges.GHOST_TRAINERS, value: 1 } as never);
    try {
      const eligibleKeys = new Set<string>();
      // Sweep a few waves; the ghost trainer must be selectable now.
      for (let w = 15; w <= 40; w++) {
        const pick = selectErCustomTrainerForWave(w);
        if (pick) {
          eligibleKeys.add(pick.key);
        }
      }
      expect(eligibleKeys.has("GHOST_ONLY")).toBe(true);
    } finally {
      globalScene.gameMode.challenges.pop();
    }
  });

  it("rotation/non-repeat: prefers a trainer not yet fielded this run", () => {
    setErDifficulty("ace");
    globalScene.gameMode.challenges.push({ id: Challenges.GHOST_TRAINERS, value: 1 } as never);
    try {
      // Two eligible at wave 20 (ACE_RICO + GHOST_ONLY). Mark one used; the
      // selector must then return the OTHER (unused preferred).
      const first = selectErCustomTrainerForWave(20);
      expect(first).not.toBeNull();
      markErCustomTrainerUsed(first!.key);
      const second = selectErCustomTrainerForWave(20);
      expect(second).not.toBeNull();
      expect(second!.key).not.toBe(first!.key);
    } finally {
      globalScene.gameMode.challenges.pop();
    }
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
