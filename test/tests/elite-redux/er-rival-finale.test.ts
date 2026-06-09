/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Regression (#340) — the Hell/Elite FINAL rival battle fielded a leftover
// early/mid team (unevolved mons) and no Mega Rayquaza:
//  (a) the v2.65beta export ships stale gimmick parties for Route 119 /
//      Lilycove / Meteor Falls (contest Pikachus, Smeargle, ids missing from
//      the id-map) — corrected from the ER decomp ground truth;
//  (b) the encounter now maps onto the stage LADDER by sequence position, so
//      the final battle always fields the strongest (Lilycove) team;
//  (c) the final battle's last slot is ALWAYS Mega Rayquaza (vanilla parity).
//
// Gated behind ER_SCENARIO=1.
// =============================================================================

import { globalScene } from "#app/global-scene";
import { setErDifficulty } from "#data/elite-redux/er-run-difficulty";
import { applyErRivalOverride, getErRivalEntry } from "#data/elite-redux/er-trainer-runtime-hook";
import { ER_TRAINER_BY_KEY } from "#data/elite-redux/init-elite-redux-trainers";
import { SpeciesFormKey } from "#enums/species-form-key";
import { SpeciesId } from "#enums/species-id";
import { TrainerType } from "#enums/trainer-type";
import { TrainerVariant } from "#enums/trainer-variant";
import type { Trainer } from "#field/trainer";
import { GameManager } from "#test/framework/game-manager";
import Phaser from "phaser";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

const RUN = process.env.ER_SCENARIO === "1";

describe.skipIf(!RUN)("ER rival finale (#340)", () => {
  let phaserGame: Phaser.Game;
  let game: GameManager;

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });
  beforeEach(async () => {
    game = new GameManager(phaserGame);
    await game.classicMode.startBattle(SpeciesId.MAGIKARP);
  });
  afterEach(() => {
    setErDifficulty("ace");
  });

  function stubRival(type: TrainerType): Trainer {
    return {
      config: { trainerType: type, isBoss: true },
      variant: TrainerVariant.FEMALE,
      isDouble: () => false,
      getPartyTemplate: () => ({ size: 6 }),
    } as unknown as Trainer;
  }

  it("corrected rosters: Lilycove/Route 119/Meteor Falls are the decomp teams (no Smeargle/contest Pikachu, full size)", () => {
    const lilycove = ER_TRAINER_BY_KEY.get("May Lilycove Treecko");
    expect(lilycove?.party.map(m => m.speciesId)).toEqual([
      SpeciesId.VIKAVOLT,
      SpeciesId.SWELLOW,
      SpeciesId.STARMIE,
      SpeciesId.TSAREENA,
      SpeciesId.MIMIKYU,
      SpeciesId.BLAZIKEN,
    ]);
    const r119 = ER_TRAINER_BY_KEY.get("Brendan Route 119 Mudkip");
    expect(r119?.party).toHaveLength(6);
    expect(r119?.party.some(m => m.speciesId === SpeciesId.SMEARGLE)).toBe(false);
    const meteor = ER_TRAINER_BY_KEY.get("May Treecko Meteor Falls");
    expect(meteor?.party.map(m => m.speciesId)).toEqual([SpeciesId.BLAZIKEN, SpeciesId.STARMIE, SpeciesId.MIMIKYU]);
  });

  it("Hell final rival battle (wave 195): strongest-stage 6-mon team selected", () => {
    setErDifficulty("hell");
    globalScene.currentBattle.waveIndex = 195;
    const entry = getErRivalEntry(stubRival(TrainerType.RIVAL_6));
    expect(entry).not.toBeNull();
    // The final battle must field a LATE-stage team (Route 119 / Lilycove),
    // never an early/mid leftover like Route 103 or Rustboro.
    expect(entry?.stableKey).toMatch(/Lilycove|Route 119/);
    expect(entry?.party.length).toBe(6);
  });

  it("Hell final rival's last slot is MEGA Rayquaza", () => {
    setErDifficulty("hell");
    globalScene.currentBattle.waveIndex = 195;
    const ace = applyErRivalOverride(stubRival(TrainerType.RIVAL_6), 5);
    expect(ace).not.toBeNull();
    expect(ace?.species.speciesId).toBe(SpeciesId.RAYQUAZA);
    const formKey = ace?.species.forms?.[ace.formIndex]?.formKey;
    expect(formKey).toBe(SpeciesFormKey.MEGA);
  });

  it("Hell early rival battles still field early-stage teams (wave 8 → Route 103)", () => {
    setErDifficulty("hell");
    globalScene.currentBattle.waveIndex = 8;
    const entry = getErRivalEntry(stubRival(TrainerType.RIVAL));
    expect(entry).not.toBeNull();
    expect(entry?.stableKey).toContain("Route 103");
  });
});
