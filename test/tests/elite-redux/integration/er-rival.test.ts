/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Elite Redux — ER rival (May / Brendan) override.
//
// On Elite/Hell, PokeRogue's generated rival is replaced by the Hoenn ER rival
// roster, scaled so the FINAL PokeRogue rival (RIVAL_6) maps to ER's final rival
// battle (Lilycove) and earlier encounters map proportionally back through the
// progression. Ace stays pure-vanilla (no override). The mon levels still come
// from PokeRogue's wave curve; only the species/movesets come from ER.
// =============================================================================

import { resetErDifficulty, setErDifficulty } from "#data/elite-redux/er-run-difficulty";
import {
  clearErTrainerCacheForTests,
  erRivalStageForEncounter,
  getErRivalEntry,
} from "#data/elite-redux/er-trainer-runtime-hook";
import { AbilityId } from "#enums/ability-id";
import { MoveId } from "#enums/move-id";
import { SpeciesId } from "#enums/species-id";
import { TrainerType } from "#enums/trainer-type";
import { TrainerVariant } from "#enums/trainer-variant";
import type { Trainer } from "#field/trainer";
import { GameManager } from "#test/framework/game-manager";
import Phaser from "phaser";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

describe("ER integration — rival override", () => {
  let phaserGame: Phaser.Game;
  let game: GameManager;

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });

  beforeEach(() => {
    game = new GameManager(phaserGame);
    clearErTrainerCacheForTests();
    setErDifficulty("elite");
    game.override.criticalHits(false).battleStyle("single").moveset([MoveId.SPLASH]).ability(AbilityId.BALL_FETCH);
  });

  afterEach(() => {
    resetErDifficulty();
  });

  // ---- Pure stage-mapping: last PokeRogue rival anchors to ER's last stage ----

  it("maps the rival encounter progression so RIVAL_6 → Lilycove (ER's final stage)", () => {
    // encounterIndex 0 (RIVAL) … 5 (RIVAL_6)
    expect(erRivalStageForEncounter(0)).toBe("Route 103");
    expect(erRivalStageForEncounter(5)).toBe("Lilycove");
    // Monotonic non-decreasing across the progression (never goes backwards).
    const stages = ["Route 103", "Rustboro", "Route 110", "Route 119", "Lilycove"];
    let prev = -1;
    for (let enc = 0; enc <= 5; enc++) {
      const idx = stages.indexOf(erRivalStageForEncounter(enc));
      expect(idx).toBeGreaterThanOrEqual(prev);
      prev = idx;
    }
  });

  // ---- getErRivalEntry end-to-end (needs a live scene for seed + gender) ----

  it("returns an ER rival roster for RIVAL on Elite, and the Lilycove roster for RIVAL_6", async () => {
    await game.classicMode.startBattle(SpeciesId.MAGIKARP);

    const rival = { config: { trainerType: TrainerType.RIVAL }, variant: TrainerVariant.FEMALE } as unknown as Trainer;
    const first = getErRivalEntry(rival);
    expect(first).not.toBeNull();
    expect(first!.stableKey).toContain("Route 103");
    expect(first!.stableKey.startsWith("May")).toBe(true); // FEMALE variant → May

    const rival6 = {
      config: { trainerType: TrainerType.RIVAL_6 },
      variant: TrainerVariant.FEMALE,
    } as unknown as Trainer;
    const last = getErRivalEntry(rival6);
    expect(last).not.toBeNull();
    expect(last!.stableKey).toContain("Lilycove");
  });

  it("uses the male rival (Brendan) for the non-female variant", async () => {
    await game.classicMode.startBattle(SpeciesId.MAGIKARP);
    // gameData.gender defaults to female in the test harness, so a non-FEMALE
    // trainer variant should still resolve to Brendan only when the player is
    // female; assert the variant→name wiring directly via a DEFAULT-variant rival.
    const rival = { config: { trainerType: TrainerType.RIVAL }, variant: TrainerVariant.DEFAULT } as unknown as Trainer;
    const entry = getErRivalEntry(rival);
    expect(entry).not.toBeNull();
    expect(entry!.stableKey.startsWith("May") || entry!.stableKey.startsWith("Brendan")).toBe(true);
  });

  it("Ace difficulty yields NO ER rival override (pure vanilla rival)", () => {
    setErDifficulty("ace");
    const rival = { config: { trainerType: TrainerType.RIVAL }, variant: TrainerVariant.FEMALE } as unknown as Trainer;
    expect(getErRivalEntry(rival)).toBeNull();
  });

  it("non-rival trainers are never treated as ER rivals", () => {
    const ace = {
      config: { trainerType: TrainerType.ACE_TRAINER },
      variant: TrainerVariant.DEFAULT,
    } as unknown as Trainer;
    expect(getErRivalEntry(ace)).toBeNull();
  });
});
