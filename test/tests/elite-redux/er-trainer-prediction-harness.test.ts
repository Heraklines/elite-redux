/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { globalScene } from "#app/global-scene";
import { getErFinalBossSpecies } from "#data/elite-redux/er-final-boss";
import { setErDifficulty } from "#data/elite-redux/er-run-difficulty";
import {
  getErRivalEntry,
  getErTrainerForTrainer,
  pickTierForWave,
  resetErRunTrainerTracking,
} from "#data/elite-redux/er-trainer-runtime-hook";
import { BattleType } from "#enums/battle-type";
import { ModifierPoolType } from "#enums/modifier-pool-type";
import { TrainerSlot } from "#enums/trainer-slot";
import { regenerateModifierPoolThresholds } from "#modifiers/modifier-type";
import { GameManager } from "#test/framework/game-manager";
import Phaser from "phaser";
import { beforeAll, describe, expect, it } from "vitest";

interface Predicted {
  wave: number;
  trainerType: number;
  trainerName: string;
  stableKey: string | null;
  source: "er" | "rival" | "vanilla";
  tier: string | null;
  team: string[];
}

describe("ER trainer prediction harness (Hell)", () => {
  let phaserGame: Phaser.Game;

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
    void new GameManager(phaserGame);
  });

  const generateWave = async (): Promise<Predicted | null> => {
    const battle = globalScene.currentBattle;
    battle.enemyLevels?.forEach((level, e) => {
      if (battle.enemyParty[e]) {
        return;
      }
      if (battle.battleType === BattleType.TRAINER) {
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
    if (battle.battleType !== BattleType.TRAINER || !battle.trainer) {
      return null;
    }
    const rivalEntry = getErRivalEntry(battle.trainer);
    const erEntry = rivalEntry ?? getErTrainerForTrainer(battle.trainer);
    const tier = erEntry ? pickTierForWave(battle.trainer) : null;
    let trainerName = `type#${battle.trainer.config.trainerType}`;
    try {
      trainerName = battle.trainer.getName(TrainerSlot.TRAINER, true);
    } catch {
      trainerName = `type#${battle.trainer.config.trainerType}`;
    }
    return {
      wave: battle.waveIndex,
      trainerType: battle.trainer.config.trainerType,
      trainerName,
      stableKey: erEntry?.stableKey ?? null,
      source: rivalEntry ? "rival" : erEntry ? "er" : "vanilla",
      tier,
      team: battle.enemyParty.map(mon => mon.getNameToRender({ useIllusion: false })),
    };
  };

  const predictRun = async (seed: string, maxWave: number): Promise<Predicted[]> => {
    setErDifficulty("hell");
    resetErRunTrainerTracking();
    globalScene.setSeed(seed);
    Reflect.set(globalScene, "currentBattle", null);
    globalScene.newArena(globalScene.gameMode.getStartingBiome());
    Reflect.set(globalScene, "enemyModifiers", []);

    const out: Predicted[] = [];
    while ((globalScene.currentBattle?.waveIndex ?? 0) < maxWave) {
      globalScene.newBattle();
      if ((globalScene.currentBattle?.waveIndex ?? 0) > maxWave) {
        break;
      }
      const row = await generateWave();
      if (row) {
        out.push(row);
      }
    }
    return out;
  };

  it("predicts the Hell trainer sequence and shows run-to-run variety", async () => {
    const runA = await predictRun("seed-alpha-0001", 60);
    const runB = await predictRun("seed-bravo-9999", 60);

    const fmt = (r: Predicted[], label: string) => {
      console.log(`\n=== ${label} ===`);
      for (const p of r) {
        console.log(
          `  w${p.wave} [type ${p.trainerType}] ${p.trainerName} :: ${p.source}:${p.stableKey ?? "(vanilla)"} / ${p.tier ?? "-"} -> ${p.team.join(", ")}`,
        );
      }
    };
    fmt(runA, "RUN A (seed-alpha)");
    fmt(runB, "RUN B (seed-bravo)");

    const diffs = runA.filter((a, i) => a.stableKey !== runB[i]?.stableKey).length;
    console.log(`\n[variety] ${diffs}/${runA.length} waves differ between the two seeds`);

    const keysA = runA
      .filter(p => p.source === "er")
      .map(p => p.stableKey)
      .filter(Boolean);
    const uniqueA = new Set(keysA);
    console.log(`[no-repeat] RUN A picked ${keysA.length} trainers, ${uniqueA.size} distinct`);
    const rivalTeamsA = runA.filter(p => p.source === "rival").map(p => p.team.join("|"));
    const uniqueRivalTeamsA = new Set(rivalTeamsA);
    console.log(`[no-repeat] RUN A rival teams ${rivalTeamsA.length} fights, ${uniqueRivalTeamsA.size} distinct teams`);

    expect(runA.length).toBeGreaterThan(0);
    expect(uniqueA.size).toBe(keysA.length);
    expect(uniqueRivalTeamsA.size).toBe(rivalTeamsA.length);
  });

  it("shows the real first two Hell trainer picks across seeds", async () => {
    const first = new Set<string>();
    const second = new Set<string>();
    for (let i = 0; i < 30; i++) {
      const run = await predictRun(`early-window-${i}`, 6);
      if (run[0]?.stableKey) {
        first.add(run[0].stableKey);
      }
      if (run[1]?.stableKey) {
        second.add(run[1].stableKey);
      }
    }
    console.log(`[early-window] first trainer wave: ${first.size} distinct across 30 seeds`);
    console.log(
      [...first]
        .sort()
        .map(k => `   ${k}`)
        .join("\n"),
    );
    console.log(`[early-window] second trainer wave: ${second.size} distinct across 30 seeds`);
    console.log(
      [...second]
        .sort()
        .map(k => `   ${k}`)
        .join("\n"),
    );
    expect(first.size).toBeGreaterThan(1);
    expect(second.size).toBeGreaterThan(1);
  });
});
