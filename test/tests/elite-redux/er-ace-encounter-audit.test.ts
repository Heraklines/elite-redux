/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// MANUAL AUDIT: dump EVERY wave (1..100) of several Ace + Elite runs — full
// encounter species and trainer teams — using the same 1:1 generation the game
// uses (newBattle -> genPartyMember / randomSpecies + the real modifier pipeline
// incl. the gated forceErMega / revertEarlyMega). Meant to be READ by hand to
// flag anything wrong (early megas, nonsense encounters, wrong teams).

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

interface WaveRow {
  wave: number;
  kind: "WILD" | "TRAINER";
  trainerKey: string | null;
  enemies: string[];
}

describe("ER Ace/Elite encounter audit (read by hand)", () => {
  let phaserGame: Phaser.Game;

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
    void new GameManager(phaserGame);
  });

  const generateWave = async (): Promise<WaveRow> => {
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

  const predictRun = async (seed: string, maxWave: number, difficulty: ErDifficulty): Promise<WaveRow[]> => {
    setErDifficulty(difficulty);
    resetErRunTrainerTracking();
    // biome-ignore lint/suspicious/noExplicitAny: harness seeding
    (globalScene as any).setSeed(seed);
    // biome-ignore lint/suspicious/noExplicitAny: fresh battle
    (globalScene as any).currentBattle = null;
    globalScene.newArena(globalScene.gameMode.getStartingBiome());
    // biome-ignore lint/suspicious/noExplicitAny: clear enemy modifier carryover
    (globalScene as any).enemyModifiers.length = 0;
    const out: WaveRow[] = [];
    while ((globalScene.currentBattle?.waveIndex ?? 0) < maxWave) {
      globalScene.newBattle();
      if ((globalScene.currentBattle?.waveIndex ?? 0) > maxWave) {
        break;
      }
      out.push(await generateWave());
    }
    return out;
  };

  const MEGA_RE = /\bMega\b|\bPrimal\b|\bOrigin\b|Eternamax|Gigantamax/i;

  const dump = async (difficulty: ErDifficulty, seeds: string[], maxWave: number) => {
    for (const seed of seeds) {
      const run = await predictRun(seed, maxWave, difficulty);
      console.log(`\n############ ${difficulty.toUpperCase()} RUN  seed=${seed}  (waves 1..${maxWave}) ############`);
      for (const w of run) {
        const tag = w.kind === "TRAINER" ? `T#${w.trainerKey}` : "wild";
        const flag = w.enemies.some(n => MEGA_RE.test(n)) ? (w.wave < 50 ? "  <<<<< EARLY MEGA" : "  (mega)") : "";
        console.log(`  w${String(w.wave).padStart(3)} ${tag.padEnd(7)} | ${w.enemies.join(", ")}${flag}`);
      }
    }
  };

  it("dumps full ACE runs for manual reading", async () => {
    await dump("ace", ["ace-A", "ace-B", "ace-C", "ace-D"], 100);
    expect(true).toBe(true);
  });

  it("dumps full ELITE runs for manual reading", async () => {
    await dump("elite", ["elite-A", "elite-B"], 100);
    expect(true).toBe(true);
  });
});
