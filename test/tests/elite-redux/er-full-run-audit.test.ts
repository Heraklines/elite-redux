/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// COMPLETE PER-MODE RUN AUDIT — the canonical "see everything that happens"
// harness. For Ace / Elite / Hell it walks waves 1..N using the SAME functions
// the game uses (newBattle → genPartyMember / randomSpecies + the real modifier
// pipeline incl. the gated forceErMega / revertEarlyMega), and prints, per wave:
//   - battle type (WILD / TRAINER, + BOSS flag)
//   - the trainer's NAME (human-readable, with title) and, for Elite/Hell, the
//     exact ER roster it resolved to (stableKey + tier) so trainer VARIETY is
//     directly visible and auditable
//   - every enemy: rendered name (form/mega), level, and active ability
// Plus a per-run variety summary (distinct trainers, distinct ER rosters,
// repeats) so "are the trainers actually varied?" is answerable from the dump.
//
// Meant to be read by hand. It asserts only basic sanity so it never blocks.

import { globalScene } from "#app/global-scene";
import { getErFinalBossSpecies } from "#data/elite-redux/er-final-boss";
import type { ErDifficulty } from "#data/elite-redux/er-run-difficulty";
import { setErDifficulty } from "#data/elite-redux/er-run-difficulty";
import {
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

interface EnemyRow {
  name: string;
  level: number;
  ability: string;
}
interface WaveRow {
  wave: number;
  kind: "WILD" | "TRAINER";
  boss: boolean;
  trainerName: string | null;
  erKey: string | null;
  erTier: string | null;
  enemies: EnemyRow[];
}

describe("ER complete per-mode run audit (read by hand)", () => {
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

    const isTrainer = battle.battleType === BattleType.TRAINER;
    let trainerName: string | null = null;
    let erKey: string | null = null;
    let erTier: string | null = null;
    let boss = false;
    if (isTrainer && battle.trainer) {
      try {
        trainerName = battle.trainer.getName(TrainerSlot.TRAINER, true);
      } catch {
        trainerName = `type#${battle.trainer.config.trainerType}`;
      }
      boss = !!battle.trainer.config.isBoss;
      const erEntry = getErTrainerForTrainer(battle.trainer);
      if (erEntry) {
        const cls = (erEntry as { trainerClassName?: string }).trainerClassName;
        erKey = `${erEntry.stableKey ?? erEntry.name ?? "?"}${cls ? ` <${cls}>` : ""}`;
        erTier = pickTierForWave(battle.trainer);
      }
    }
    const enemies: EnemyRow[] = (battle.enemyParty ?? []).map(mon => {
      if (mon.isBoss()) {
        boss = true;
      }
      let ability = "?";
      try {
        ability = mon.getAbility().name;
      } catch {
        /* ability lookup can throw for partially-built mons in headless */
      }
      return { name: mon.getNameToRender({ useIllusion: false }), level: mon.level, ability };
    });
    return {
      wave: battle.waveIndex,
      kind: isTrainer ? "TRAINER" : "WILD",
      boss,
      trainerName,
      erKey,
      erTier,
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

  const dumpMode = async (difficulty: ErDifficulty, seed: string, maxWave: number) => {
    const run = await predictRun(seed, maxWave, difficulty);
    console.log(`\n################ ${difficulty.toUpperCase()} | seed=${seed} | waves 1..${maxWave} ################`);
    for (const w of run) {
      if (w.kind === "TRAINER") {
        const er = w.erKey ? ` {ER: ${w.erKey} / ${w.erTier}}` : " {vanilla}";
        const bossTag = w.boss ? " *BOSS*" : "";
        console.log(`w${String(w.wave).padStart(3)} [TRAINER]${bossTag} "${w.trainerName}"${er}`);
      } else {
        const bossTag = w.boss ? " *BOSS*" : "";
        console.log(`w${String(w.wave).padStart(3)} [WILD]${bossTag}`);
      }
      for (const e of w.enemies) {
        console.log(`        - ${e.name}  Lv${e.level}  (${e.ability})`);
      }
    }
    // Variety summary
    const trainerWaves = run.filter(w => w.kind === "TRAINER");
    const distinctTrainerNames = new Set(trainerWaves.map(w => w.trainerName));
    const erKeys = trainerWaves.map(w => w.erKey).filter((k): k is string => k != null);
    const distinctErKeys = new Set(erKeys);
    console.log(
      `\n--- ${difficulty.toUpperCase()} variety: ${trainerWaves.length} trainer battles, ${distinctTrainerNames.size} distinct trainer names; ER rosters: ${erKeys.length} picks, ${distinctErKeys.size} distinct ---`,
    );
    // Repeat report: ER rosters used more than once
    const counts = new Map<string, number>();
    for (const k of erKeys) {
      counts.set(k, (counts.get(k) ?? 0) + 1);
    }
    const repeats = [...counts.entries()].filter(([, n]) => n > 1).sort((a, b) => b[1] - a[1]);
    if (repeats.length > 0) {
      console.log(`    ER rosters reused: ${repeats.map(([k, n]) => `${k}×${n}`).join(", ")}`);
    }
    return run;
  };

  it("ACE — full 1..200 run", async () => {
    const run = await dumpMode("ace", "audit-ace", 200);
    expect(run.length).toBeGreaterThan(0);
  });

  it("ELITE — full 1..200 run", async () => {
    const run = await dumpMode("elite", "audit-elite", 200);
    expect(run.length).toBeGreaterThan(0);
  });

  it("HELL — full 1..200 run", async () => {
    const run = await dumpMode("hell", "audit-hell", 200);
    expect(run.length).toBeGreaterThan(0);
  });
});
