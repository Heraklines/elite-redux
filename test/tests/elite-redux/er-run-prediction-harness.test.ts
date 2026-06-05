/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// 1:1 RUN PREDICTION HARNESS — predicts the EXACT enemy of every wave (1..200)
// of a Hell-mode run for a given seed, using the SAME functions the game uses:
//   - globalScene.newBattle()  (advances the wave, resets the per-wave seed,
//     decides wild vs trainer, builds the trainer + enemy levels)
//   - the encounter phase's own generation loop, replicated 1:1:
//       trainer wave → battle.trainer.genPartyMember(e)
//       wild wave    → globalScene.randomSpecies(wave, level, true) + addEnemyPokemon
// Because it calls the same functions in the same order against the same seed,
// the predicted spawns match the real run exactly (no separate model to drift).

import { globalScene } from "#app/global-scene";
import { getErFinalBossSpecies } from "#data/elite-redux/er-final-boss";
import type { ErDifficulty } from "#data/elite-redux/er-run-difficulty";
import { setErDifficulty } from "#data/elite-redux/er-run-difficulty";
import { applyErTrainerHeldItems, resetErRunTrainerTracking } from "#data/elite-redux/er-trainer-runtime-hook";
import { BattleType } from "#enums/battle-type";
import { TrainerSlot } from "#enums/trainer-slot";
import { GameManager } from "#test/framework/game-manager";
import Phaser from "phaser";
import { beforeAll, describe, expect, it } from "vitest";

interface WavePrediction {
  wave: number;
  kind: "WILD" | "TRAINER";
  trainerKey: string | null;
  enemies: string[];
}

describe("ER 1:1 full-run prediction harness (Hell, 200 waves)", () => {
  let phaserGame: Phaser.Game;

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
    void new GameManager(phaserGame);
  });

  /**
   * Generate one wave's enemy party using the EXACT same calls as
   * EncounterPhase (kept in sync with encounter-phase.ts). Returns the species
   * names. Mutates battle.enemyParty so RNG stays in lock-step with the real
   * generation (each addEnemyPokemon / genPartyMember consumes RNG in order).
   */
  const generateWave = (): WavePrediction => {
    const battle = globalScene.currentBattle;
    battle.enemyLevels?.forEach((level, e) => {
      if (battle.enemyParty[e]) {
        return;
      }
      if (battle.battleType === BattleType.TRAINER) {
        // biome-ignore lint/style/noNonNullAssertion: trainer present on trainer waves
        battle.enemyParty[e] = battle.trainer!.genPartyMember(e);
      } else {
        let enemySpecies = globalScene.randomSpecies(battle.waveIndex, level, true);
        if (battle.isClassicFinalBoss) {
          const erFinalBoss = getErFinalBossSpecies();
          if (erFinalBoss) {
            enemySpecies = erFinalBoss;
          }
        }
        battle.enemyParty[e] = globalScene.addEnemyPokemon(
          enemySpecies,
          level,
          TrainerSlot.NONE,
          !!globalScene.getEncounterBossSegments(battle.waveIndex, level, enemySpecies),
        );
      }
    });
    // Apply the ER held-item / mega conversion exactly as the game does (it runs
    // applyErTrainerHeldItems on the whole party in modifier generation), which
    // includes the gated forceErMega. THEN read forms so megas are reflected.
    if (battle.battleType === BattleType.TRAINER) {
      applyErTrainerHeldItems(battle.enemyParty);
    }
    const enemies = (battle.enemyParty ?? []).map(mon => {
      const formKey = mon.species.forms?.[mon.formIndex]?.formKey ?? "";
      const isMega = /mega|primal/i.test(formKey);
      return isMega ? `${mon.species.name} [MEGA]` : mon.species.name;
    });
    return {
      wave: battle.waveIndex,
      kind: battle.battleType === BattleType.TRAINER ? "TRAINER" : "WILD",
      trainerKey: battle.trainer ? `${battle.trainer.config.trainerType}` : null,
      enemies,
    };
  };

  const predictRun = (seed: string, maxWave: number, difficulty: ErDifficulty = "hell"): WavePrediction[] => {
    setErDifficulty(difficulty);
    // Fresh run: clear the per-run no-repeat tracking so each prediction starts
    // from the same state (otherwise run 2 inherits run 1's used trainers).
    resetErRunTrainerTracking();
    // biome-ignore lint/suspicious/noExplicitAny: harness seeding
    (globalScene as any).setSeed(seed);
    // biome-ignore lint/suspicious/noExplicitAny: clear prior battle so newBattle starts fresh
    (globalScene as any).currentBattle = null;
    // Reset the arena to the mode's starting biome — exactly what a fresh run
    // does (title-phase) — so biome progression starts over (otherwise run 2's
    // wild encounters inherit run 1's ending biome).
    globalScene.newArena(globalScene.gameMode.getStartingBiome());

    const out: WavePrediction[] = [];
    while ((globalScene.currentBattle?.waveIndex ?? 0) < maxWave) {
      globalScene.newBattle();
      if ((globalScene.currentBattle?.waveIndex ?? 0) > maxWave) {
        break;
      }
      out.push(generateWave());
    }
    return out;
  };

  it("predicts every wave's exact enemy for a Hell run, and runs differ by seed", () => {
    const runA = predictRun("seed-alpha-1", 200);

    console.log(`\n=== HELL RUN (seed-alpha) — ${runA.length} waves ===`);
    for (const w of runA) {
      const tag = w.kind === "TRAINER" ? `TRAINER#${w.trainerKey}` : "WILD";
      console.log(`  w${w.wave} ${w.kind === "TRAINER" ? "[T]" : "   "} ${tag}: ${w.enemies.join(", ")}`);
    }

    expect(runA.length).toBeGreaterThan(0);
    expect(runA.some(w => w.kind === "TRAINER")).toBe(true);
    expect(runA.some(w => w.kind === "WILD")).toBe(true);

    // Same seed → identical prediction (proves determinism / 1:1 reproducibility).
    const runA2 = predictRun("seed-alpha-1", 60);
    for (let i = 0; i < runA2.length; i++) {
      expect(runA2[i].enemies).toEqual(runA[i].enemies);
    }

    // Different seed → a meaningfully different run.
    const runB = predictRun("seed-bravo-2", 60);
    const diffs = runB.filter((w, i) => JSON.stringify(w.enemies) !== JSON.stringify(runA[i]?.enemies)).length;
    console.log(`[variety] ${diffs}/${runB.length} early waves differ between two seeds`);
    expect(diffs).toBeGreaterThan(0);
  });

  it("ACE mode: no trainer mega before wave 50 (probes several runs)", () => {
    const MEGA_GATE = 50;
    const earlyMegas: string[] = [];
    for (const seed of ["ace-1", "ace-2", "ace-3", "ace-4", "ace-5"]) {
      const run = predictRun(seed, 60, "ace");
      for (const w of run) {
        if (w.wave >= MEGA_GATE) {
          continue;
        }
        for (const name of w.enemies) {
          if (name.includes("[MEGA]")) {
            earlyMegas.push(`seed ${seed} w${w.wave}: ${name}`);
          }
        }
      }
    }
    console.log(`[mega-gate] early (<w${MEGA_GATE}) Ace megas found: ${earlyMegas.length}`);
    for (const m of earlyMegas.slice(0, 20)) {
      console.log(`   ${m}`);
    }
    // If the gate works, this is 0. (Reported as a bug — this assertion documents it.)
    expect(earlyMegas.length).toBe(0);
  });

  it("predicts each difficulty (Ace / Elite / Hell) for the same seed", () => {
    for (const diff of ["ace", "elite", "hell"] as const) {
      const run = predictRun("seed-modecheck", 30, diff);
      console.log(`\n=== ${diff.toUpperCase()} (first 30 waves, seed-modecheck) ===`);
      for (const w of run) {
        const tag = w.kind === "TRAINER" ? `T#${w.trainerKey}` : "WILD";
        console.log(`  w${w.wave} ${tag}: ${w.enemies.join(", ")}`);
      }
      expect(run.length).toBeGreaterThan(0);
    }
  });
});
