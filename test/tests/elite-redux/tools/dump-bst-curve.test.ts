/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */
// TOOL (#418): dump the REAL enemy BST curve over 200 waves per difficulty,
// using the same 1:1 generation the game uses (newBattle -> genPartyMember /
// randomSpecies + the live modifier pipeline). Read the [bst] lines and the
// [hot] offender lines; docs/er-bst-curve-report.md is built from this output.
// Rerun: ER_SCENARIO=1 npx vitest run test/tests/elite-redux/tools/dump-bst-curve.test.ts

import { globalScene } from "#app/global-scene";
import { pokemonEvolutions } from "#balance/pokemon-evolutions";
import { getErFinalBossSpecies } from "#data/elite-redux/er-final-boss";
import type { ErDifficulty } from "#data/elite-redux/er-run-difficulty";
import { setErDifficulty } from "#data/elite-redux/er-run-difficulty";
import { resetErRunTrainerTracking } from "#data/elite-redux/er-trainer-runtime-hook";
import { BattleType } from "#enums/battle-type";
import { ModifierPoolType } from "#enums/modifier-pool-type";
import type { SpeciesId } from "#enums/species-id";
import { TrainerSlot } from "#enums/trainer-slot";
import { regenerateModifierPoolThresholds } from "#modifiers/modifier-type";
import { GameManager } from "#test/framework/game-manager";
import Phaser from "phaser";
import { beforeAll, describe, expect, it } from "vitest";

const RUN = process.env.ER_SCENARIO === "1";

interface EnemyRow {
  wave: number;
  kind: "WILD" | "TRAINER";
  name: string;
  bst: number;
  level: number;
  legendLike: boolean;
  finalStage: boolean;
}

describe.skipIf(!RUN)("TOOL: BST curve dump (#418)", () => {
  let phaserGame: Phaser.Game;

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
    void new GameManager(phaserGame);
  });

  const generateWave = async (): Promise<EnemyRow[]> => {
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
    return (battle.enemyParty ?? []).map(mon => {
      const sp = mon.species;
      return {
        wave: battle.waveIndex,
        kind: battle.battleType === BattleType.TRAINER ? ("TRAINER" as const) : ("WILD" as const),
        name: mon.getNameToRender({ useIllusion: false }),
        bst: mon.getSpeciesForm().getBaseStatTotal(),
        level: mon.level,
        legendLike: sp.legendary || sp.subLegendary || sp.mythical,
        finalStage: pokemonEvolutions[sp.speciesId as SpeciesId] === undefined,
      };
    });
  };

  const predictRun = async (seed: string, maxWave: number, difficulty: ErDifficulty): Promise<EnemyRow[]> => {
    setErDifficulty(difficulty);
    resetErRunTrainerTracking();
    // biome-ignore lint/suspicious/noExplicitAny: harness seeding
    (globalScene as any).setSeed(seed);
    // biome-ignore lint/suspicious/noExplicitAny: fresh battle
    (globalScene as any).currentBattle = null;
    globalScene.newArena(globalScene.gameMode.getStartingBiome());
    // biome-ignore lint/suspicious/noExplicitAny: clear enemy modifier carryover
    (globalScene as any).enemyModifiers.length = 0;
    const out: EnemyRow[] = [];
    while ((globalScene.currentBattle?.waveIndex ?? 0) < maxWave) {
      globalScene.newBattle();
      if ((globalScene.currentBattle?.waveIndex ?? 0) > maxWave) {
        break;
      }
      out.push(...(await generateWave()));
    }
    return out;
  };

  const BUCKET = 20;
  const fmt = (n: number) => String(Math.round(n)).padStart(4);

  const report = (difficulty: ErDifficulty, rows: EnemyRow[]) => {
    console.log(`\n[bst] ======== ${difficulty.toUpperCase()} (waves 1..200, 2 seeds merged) ========`);
    console.log(
      "[bst] waves    | kind    |    n | meanBST | p90BST | maxBST | meanLvl | final% | legend-like | 600+BST",
    );
    for (let lo = 1; lo <= 200; lo += BUCKET) {
      const hi = lo + BUCKET - 1;
      for (const kind of ["WILD", "TRAINER"] as const) {
        const slice = rows.filter(r => r.wave >= lo && r.wave <= hi && r.kind === kind);
        if (slice.length === 0) {
          continue;
        }
        const bsts = slice.map(r => r.bst).sort((a, b) => a - b);
        const mean = bsts.reduce((s, b) => s + b, 0) / bsts.length;
        const p90 = bsts[Math.min(bsts.length - 1, Math.floor(bsts.length * 0.9))];
        const max = bsts.at(-1) ?? 0;
        const meanLvl = slice.reduce((s, r) => s + r.level, 0) / slice.length;
        const finalPct = (100 * slice.filter(r => r.finalStage).length) / slice.length;
        const legends = slice.filter(r => r.legendLike).length;
        const heavy = slice.filter(r => r.bst >= 600).length;
        console.log(
          `[bst] w${String(lo).padStart(3)}-${String(hi).padEnd(3)} | ${kind.padEnd(7)} | ${String(slice.length).padStart(4)} |    ${fmt(mean)} |   ${fmt(p90)} |   ${fmt(max)} |    ${fmt(meanLvl)} |   ${String(Math.round(finalPct)).padStart(3)}% | ${String(legends).padStart(11)} | ${String(heavy).padStart(7)}`,
        );
      }
    }
    // Worst early offenders: the concrete mons the report is about.
    const hot = rows
      .filter(r => r.wave <= 60 && (r.bst >= 580 || r.legendLike))
      .sort((a, b) => a.wave - b.wave)
      .slice(0, 25);
    for (const h of hot) {
      console.log(
        `[hot] ${difficulty} w${String(h.wave).padStart(3)} ${h.kind.padEnd(7)} ${h.name} (BST ${h.bst}, lvl ${h.level}${h.legendLike ? ", LEGEND-LIKE" : ""}${h.finalStage ? ", final stage" : ""})`,
      );
    }
  };

  const dump = async (difficulty: ErDifficulty) => {
    const rows: EnemyRow[] = [];
    for (const seed of [`bst-${difficulty}-A`, `bst-${difficulty}-B`]) {
      rows.push(...(await predictRun(seed, 200, difficulty)));
    }
    report(difficulty, rows);
    expect(rows.length).toBeGreaterThan(200);
  };

  it("dumps the ACE curve", async () => {
    await dump("ace");
  });

  it("dumps the ELITE curve", async () => {
    await dump("elite");
  });

  it("dumps the HELL curve", async () => {
    await dump("hell");
  });
});
