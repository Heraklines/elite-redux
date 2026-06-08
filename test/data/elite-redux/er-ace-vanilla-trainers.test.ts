/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 *
 * Regression guard: ACE difficulty must be PURE VANILLA PokeRogue — no ER
 * trainer roster overlay and no ER rival overlay. Elite/Hell DO overlay ER
 * teams. This locks the "Ace = vanilla, no overtuned mons early" guarantee so
 * the ER trainer pool can never silently leak back into Ace.
 */

import { resetErDifficulty, setErDifficulty } from "#data/elite-redux/er-run-difficulty";
import {
  getErRivalEntry,
  getErTrainerForTrainer,
  resetErRunTrainerTracking,
  resetErTrainerCacheFor,
} from "#data/elite-redux/er-trainer-runtime-hook";
import { SpeciesId } from "#enums/species-id";
import { TrainerType } from "#enums/trainer-type";
import { TrainerVariant } from "#enums/trainer-variant";
import { Trainer } from "#field/trainer";
import { GameManager } from "#test/framework/game-manager";
import Phaser from "phaser";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

describe("ER difficulty gating — Ace is pure vanilla (no ER trainer/rival overlay)", () => {
  let phaserGame: Phaser.Game;
  let game: GameManager;

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });

  beforeEach(async () => {
    game = new GameManager(phaserGame);
    // A live battle gives us globalScene + currentBattle (waveIndex/waveSeed)
    // that the trainer hook reads.
    await game.classicMode.startBattle(SpeciesId.PIKACHU);
  });

  afterEach(() => {
    resetErDifficulty();
  });

  function freshTrainer(type: TrainerType): Trainer {
    const t = new Trainer(type, TrainerVariant.DEFAULT);
    resetErRunTrainerTracking();
    resetErTrainerCacheFor(t);
    return t;
  }

  it("Ace: a regular trainer gets NO ER roster override (vanilla)", () => {
    setErDifficulty("ace");
    expect(getErTrainerForTrainer(freshTrainer(TrainerType.YOUNGSTER))).toBeNull();
  });

  it("Hell: the same trainer DOES get an ER roster override (gate is difficulty-driven)", () => {
    setErDifficulty("hell");
    expect(getErTrainerForTrainer(freshTrainer(TrainerType.YOUNGSTER))).not.toBeNull();
  });

  it("Ace: rival trainers get NO ER rival override (vanilla rival)", () => {
    setErDifficulty("ace");
    expect(getErRivalEntry(freshTrainer(TrainerType.RIVAL))).toBeNull();
  });
});
