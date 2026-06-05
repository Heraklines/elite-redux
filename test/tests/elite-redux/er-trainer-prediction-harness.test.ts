/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// PREDICTION HARNESS: without running real battles, predict which ER trainer
// (and which Pokémon) would appear at each trainer wave of a Hell-mode run, for
// a given seed. Uses the REAL wave→trainer-type schedule (arena.randomTrainerType)
// and the REAL selection pipeline (getErTrainerForTrainer + selectErRoster).
//
// It runs two different seeds and reports how much the trainer sequence differs,
// so we can SEE whether each run is actually "brand new".

import { globalScene } from "#app/global-scene";
import { setErDifficulty } from "#data/elite-redux/er-run-difficulty";
import { selectErRoster } from "#data/elite-redux/er-trainer-overlay";
import {
  getErTrainerForTrainer,
  pickTierForWave,
  resetErRunTrainerTracking,
} from "#data/elite-redux/er-trainer-runtime-hook";
import type { Trainer } from "#field/trainer";
import { GameManager } from "#test/framework/game-manager";
import { getPokemonSpecies } from "#utils/pokemon-utils";
import Phaser from "phaser";
import { beforeAll, describe, expect, it } from "vitest";

interface Predicted {
  wave: number;
  trainerType: number;
  stableKey: string | null;
  team: string[];
}

describe("ER trainer prediction harness (Hell)", () => {
  let phaserGame: Phaser.Game;

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
    void new GameManager(phaserGame);
  });

  /** Predict the Hell trainer at every trainer wave 1..maxWave for a seed. */
  const predictRun = (seed: string, maxWave: number): Predicted[] => {
    setErDifficulty("hell");
    resetErRunTrainerTracking();
    // biome-ignore lint/suspicious/noExplicitAny: test seeding
    (globalScene as any).setSeed(seed);
    globalScene.resetSeed();

    const out: Predicted[] = [];
    for (let wave = 1; wave <= maxWave; wave++) {
      // PokeRogue puts trainer battles on specific waves; emulate "every 5th wave
      // is a trainer" so we sample a realistic spread without a full run.
      if (wave % 5 !== 0) {
        continue;
      }
      const isBoss = wave % 10 === 0;
      const trainerType = globalScene.arena.randomTrainerType(wave, isBoss);
      // biome-ignore lint/suspicious/noExplicitAny: minimal Trainer stand-in for selection
      (globalScene as any).currentBattle = { waveIndex: wave };
      const mock = {
        config: { trainerType, isBoss },
        getPartyTemplate: () => ({ size: isBoss ? 6 : Math.min(4, 1 + Math.floor(wave / 10)) }),
      } as unknown as Trainer;

      const chosen = getErTrainerForTrainer(mock);
      const team = chosen
        ? selectErRoster(chosen, pickTierForWave(mock))
            .map(m => getPokemonSpecies(m.speciesId)?.name ?? `#${m.speciesId}`)
            .slice(0, 6)
        : [];
      out.push({ wave, trainerType, stableKey: chosen?.stableKey ?? null, team });
    }
    return out;
  };

  it("predicts the Hell trainer sequence and shows run-to-run variety", () => {
    const runA = predictRun("seed-alpha-0001", 60);
    const runB = predictRun("seed-bravo-9999", 60);

    const fmt = (r: Predicted[], label: string) => {
      console.log(`\n=== ${label} ===`);
      for (const p of r) {
        console.log(`  w${p.wave} [type ${p.trainerType}] ${p.stableKey ?? "(vanilla)"} → ${p.team.join(", ")}`);
      }
    };
    fmt(runA, "RUN A (seed-alpha)");
    fmt(runB, "RUN B (seed-bravo)");

    // How many waves picked a DIFFERENT trainer between the two seeds?
    const diffs = runA.filter((a, i) => a.stableKey !== runB[i]?.stableKey).length;
    console.log(`\n[variety] ${diffs}/${runA.length} waves differ between the two seeds`);

    // Within a single run, the no-repeat guarantee should hold (distinct trainers).
    const keysA = runA.map(p => p.stableKey).filter(Boolean);
    const uniqueA = new Set(keysA);
    console.log(`[no-repeat] RUN A picked ${keysA.length} trainers, ${uniqueA.size} distinct`);

    expect(runA.length).toBeGreaterThan(0);
  });
});
