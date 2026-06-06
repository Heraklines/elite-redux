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
import { resetErRunTrainerTracking } from "#data/elite-redux/er-trainer-runtime-hook";
import { BattleType } from "#enums/battle-type";
import { ModifierPoolType } from "#enums/modifier-pool-type";
import { TrainerSlot } from "#enums/trainer-slot";
import { regenerateModifierPoolThresholds } from "#modifiers/modifier-type";
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
  const generateWave = async (): Promise<WavePrediction> => {
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
    // Run the EXACT modifier pipeline the encounter phase runs (encounter-phase.ts
    // ~291-295): regenerate the pool thresholds, then generateEnemyModifiers().
    // This is what actually attaches held items — including a Mega Stone, whose
    // PokemonFormChangeItemModifier mega-evolves the holder ON ADD (battle-scene
    // addEnemyModifier → modifier.apply), and the gated forceErMega for ER mons.
    // So after this, a mega is reflected in the live form + rendered name.
    // We read the ACTUAL generated name each Pokémon carries (getNameToRender →
    // this.name, set by generateName()) — the only faithful way to see a mega:
    // a form-key regex misses (a) ER custom mega *species* (id >= 10000) whose
    // formKey isn't "mega", and (b) "Eternamax" (no "mega" substring).
    regenerateModifierPoolThresholds(
      globalScene.getEnemyField(),
      battle.battleType === BattleType.TRAINER ? ModifierPoolType.TRAINER : ModifierPoolType.WILD,
    );
    await globalScene.generateEnemyModifiers();
    const enemies = (battle.enemyParty ?? []).map(mon => mon.getNameToRender({ useIllusion: false }));
    return {
      wave: battle.waveIndex,
      kind: battle.battleType === BattleType.TRAINER ? "TRAINER" : "WILD",
      trainerKey: battle.trainer ? `${battle.trainer.config.trainerType}` : null,
      enemies,
    };
  };

  const predictRun = async (
    seed: string,
    maxWave: number,
    difficulty: ErDifficulty = "hell",
  ): Promise<WavePrediction[]> => {
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
    // generateEnemyModifiers() accumulates into globalScene.enemyModifiers; clear
    // it so each predicted run starts clean (otherwise prior runs' modifiers leak
    // and break run-to-run reproducibility).
    // biome-ignore lint/suspicious/noExplicitAny: test reset
    (globalScene as any).enemyModifiers.length = 0;

    const out: WavePrediction[] = [];
    while ((globalScene.currentBattle?.waveIndex ?? 0) < maxWave) {
      globalScene.newBattle();
      if ((globalScene.currentBattle?.waveIndex ?? 0) > maxWave) {
        break;
      }
      out.push(await generateWave());
    }
    return out;
  };

  it("predicts every wave's exact enemy for a Hell run, and runs differ by seed", async () => {
    const runA = await predictRun("seed-alpha-1", 200);

    console.log(`\n=== HELL RUN (seed-alpha) — ${runA.length} waves ===`);
    for (const w of runA) {
      const tag = w.kind === "TRAINER" ? `TRAINER#${w.trainerKey}` : "WILD";
      console.log(`  w${w.wave} ${w.kind === "TRAINER" ? "[T]" : "   "} ${tag}: ${w.enemies.join(", ")}`);
    }

    expect(runA.length).toBeGreaterThan(0);
    expect(runA.some(w => w.kind === "TRAINER")).toBe(true);
    expect(runA.some(w => w.kind === "WILD")).toBe(true);

    // Same seed → identical prediction (proves determinism / 1:1 reproducibility).
    const runA2 = await predictRun("seed-alpha-1", 60);
    for (let i = 0; i < runA2.length; i++) {
      expect(runA2[i].enemies).toEqual(runA[i].enemies);
    }

    // Different seed → a meaningfully different run.
    const runB = await predictRun("seed-bravo-2", 60);
    const diffs = runB.filter((w, i) => JSON.stringify(w.enemies) !== JSON.stringify(runA[i]?.enemies)).length;
    console.log(`[variety] ${diffs}/${runB.length} early waves differ between two seeds`);
    expect(diffs).toBeGreaterThan(0);

    // Diagnostic (run last so it can't perturb the assertions above): how many
    // megas actually appear across a full 200-wave Hell run, for several seeds.
    const megaRe = /\bMega\b|\bPrimal\b|\bOrigin\b|Eternamax|Gigantamax/i;
    for (const seed of ["seed-alpha-1", "seed-beta-7", "seed-gamma-9", "seed-delta-3"]) {
      const r = await predictRun(seed, 200);
      const names: string[] = [];
      for (const w of r) {
        for (const n of w.enemies) {
          if (megaRe.test(n)) {
            names.push(`w${w.wave}:${n}`);
          }
        }
      }
      console.log(`[hell-mega-density] seed ${seed}: ${names.length} megas across ${r.length} waves`);
      console.log(`   ${names.join(", ")}`);
    }
  });

  // Read the rendered NAME (not a form key) and decide if it's a mega/primal/
  // gigantamax/eternamax by what the player would actually SEE on screen.
  const isMegaName = (name: string): boolean =>
    /\bmega\b|\bprimal\b|gigantamax|g-?max|eternamax|\bredux mega\b/i.test(name);

  it("ACE + ELITE: no early mega before wave 50 (gate must hold after form injection)", async () => {
    const MEGA_GATE = 50;
    // Probe both Ace and Elite — both gate megas to wave >= 50 (only Hell is
    // exempt). With ~106 newly-injected mega forms, far more enemies are now
    // mega-capable, so this gate is the thing that must still hold.
    for (const difficulty of ["ace", "elite"] as const) {
      const earlyMegas: string[] = [];
      for (const seed of [
        `${difficulty}-1`,
        `${difficulty}-2`,
        `${difficulty}-3`,
        `${difficulty}-4`,
        `${difficulty}-5`,
      ]) {
        const run = await predictRun(seed, 60, difficulty);
        for (const w of run) {
          if (w.wave >= MEGA_GATE) {
            continue;
          }
          for (const name of w.enemies) {
            if (isMegaName(name)) {
              earlyMegas.push(
                `${difficulty} seed ${seed} w${w.wave} [${w.kind}#${w.trainerKey}]: ${name}  (full: ${w.enemies.join(", ")})`,
              );
            }
          }
        }
      }
      console.log(`[mega-gate] early (<w${MEGA_GATE}) ${difficulty.toUpperCase()} megas: ${earlyMegas.length}`);
      for (const m of earlyMegas.slice(0, 20)) {
        console.log(`   ${m}`);
      }
      expect(earlyMegas.length).toBe(0);
    }
  });

  it("predicts each difficulty (Ace / Elite / Hell) for the same seed", async () => {
    for (const diff of ["ace", "elite", "hell"] as const) {
      const run = await predictRun("seed-modecheck", 30, diff);
      console.log(`\n=== ${diff.toUpperCase()} (first 30 waves, seed-modecheck) ===`);
      for (const w of run) {
        const tag = w.kind === "TRAINER" ? `T#${w.trainerKey}` : "WILD";
        console.log(`  w${w.wave} ${tag}: ${w.enemies.join(", ")}`);
      }
      expect(run.length).toBeGreaterThan(0);
    }
  });
});
