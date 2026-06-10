/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// COMPLETE PER-MODE RUN AUDIT — the canonical "see everything that happens"
// harness. For Ace / Elite / Hell it walks waves 1..200 using the SAME
// functions the game uses (newBattle → genPartyMember / randomSpecies + the
// real modifier pipeline incl. applyErTrainerHeldItems' forced megas and the
// early-mega gate), and prints, per wave: battle type, trainer name, resolved
// ER roster/tier, ghost/factory flags, and every enemy with form + level +
// ability.
//
// ER (#350): it used to "assert only basic sanity so it never blocks" — i.e.
// it could never CATCH anything ("the harness sometimes misses bugs"). It now
// enforces the per-mode INVARIANTS the testers keep re-finding by hand:
//   ACE   — pure vanilla: no ER rosters, no ghosts, no factory teams, no
//           mega-form enemies before wave 50, vanilla Eternatus finale.
//   ELITE — ER rosters never repeat in a run; ≥1 factory team appears; no
//           mega-form enemies before wave 50; the wave-195 rival fields a
//           6-mon team whose ace is MEGA RAYQUAZA (#340 class); late-game
//           trainer teams outclass early-game ones (no unevolved-late bug);
//           ER Cascoon finale.
//   HELL  — every scheduled ghost wave actually spawns a ghost trainer (pool
//           stubbed via the test hook) carrying the source player's name
//           (#363/#364); Mega Rayquaza rival finale; ER Cascoon finale.
// Fixed seeds keep every assertion deterministic for a given code version.

import { globalScene } from "#app/global-scene";
import { allBiomes } from "#data/data-lists";
import { getErFinalBossSpecies } from "#data/elite-redux/er-final-boss";
import {
  ghostWavesForCurrentRun,
  hasErGhostOverride,
  resetErGhostRunState,
  setPrefetchedGhostTeamsForTests,
} from "#data/elite-redux/er-ghost-teams";
import type { ErDifficulty } from "#data/elite-redux/er-run-difficulty";
import { setErDifficulty } from "#data/elite-redux/er-run-difficulty";
import {
  clearErFactoryCacheForTests,
  getErRivalEntry,
  getErTrainerForTrainer,
  hasErFactoryOverride,
  pickTierForWave,
  resetErRunTrainerTracking,
} from "#data/elite-redux/er-trainer-runtime-hook";
import { BattleType } from "#enums/battle-type";
import { BiomeId } from "#enums/biome-id";
import { ModifierPoolType } from "#enums/modifier-pool-type";
import { SpeciesId } from "#enums/species-id";
import { TrainerSlot } from "#enums/trainer-slot";
import { regenerateModifierPoolThresholds } from "#modifiers/modifier-type";
import { GameManager } from "#test/framework/game-manager";
import { randSeedInt, randSeedItem } from "#utils/common";
import Phaser from "phaser";
import { beforeAll, describe, expect, it } from "vitest";

interface EnemyRow {
  name: string;
  speciesId: number;
  formKey: string;
  bst: number;
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
  ghost: boolean;
  factory: boolean;
  enemies: EnemyRow[];
}

/** Sturdy 3-mon stub teams for the ghost pool — one per ghost wave, each ending
 * a few waves past its target wave so it sits inside the eligibility window
 * (waveReached >= W and <= W + ER_GHOST_WAVE_WINDOW; an endgame waveReached:200
 * team is deliberately NOT eligible at early ghost waves like 63/87). */
const GHOST_STUB_MEMBER = (speciesId: number) => ({
  speciesId,
  formIndex: 0,
  abilityIndex: 0,
  ivs: [31, 31, 31, 31, 31, 31],
  nature: 0,
  level: 80,
  gender: 0,
  shiny: false,
  variant: 0,
  passive: false,
  moves: [],
});
const makeGhostStubPool = (waves: readonly number[]) =>
  waves.map((wave, i) => ({
    id: `audit-ghost-${i}`,
    trainerName: "AuditGhost",
    difficulty: "hell" as const,
    waveReached: wave + 10,
    isVictory: false,
    timestamp: i,
    party: [
      GHOST_STUB_MEMBER(SpeciesId.GARCHOMP),
      GHOST_STUB_MEMBER(SpeciesId.METAGROSS),
      GHOST_STUB_MEMBER(SpeciesId.MILOTIC),
    ],
  }));

const MEGA_FORM_RE = /mega|primal|origin/i;

describe("ER complete per-mode run audit (invariant-checked)", () => {
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
    let ghost = false;
    let factory = false;
    let boss = false;
    if (isTrainer && battle.trainer) {
      try {
        trainerName = battle.trainer.getName(TrainerSlot.TRAINER, true);
      } catch {
        trainerName = `type#${battle.trainer.config.trainerType}`;
      }
      boss = !!battle.trainer.config.isBoss;
      ghost = hasErGhostOverride(battle.trainer);
      factory = !ghost && hasErFactoryOverride(battle.trainer);
      const erEntry = ghost ? null : (getErRivalEntry(battle.trainer) ?? getErTrainerForTrainer(battle.trainer));
      if (erEntry) {
        const cls = (erEntry as { trainerClassName?: string }).trainerClassName;
        erKey = `${erEntry.stableKey ?? "?"}${cls ? ` <${cls}>` : ""}`;
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
      return {
        name: mon.getNameToRender({ useIllusion: false }),
        speciesId: mon.species.speciesId as number,
        formKey: mon.species.forms?.[mon.formIndex]?.formKey ?? "",
        bst: mon.species.getBaseStatTotal(),
        level: mon.level,
        ability,
      };
    });
    return {
      wave: battle.waveIndex,
      kind: isTrainer ? "TRAINER" : "WILD",
      boss,
      trainerName,
      erKey,
      erTier,
      ghost,
      factory,
      enemies,
    };
  };

  const predictRun = async (seed: string, maxWave: number, difficulty: ErDifficulty): Promise<WaveRow[]> => {
    setErDifficulty(difficulty);
    resetErRunTrainerTracking();
    resetErGhostRunState();
    clearErFactoryCacheForTests();
    if (difficulty === "hell") {
      // Stub the cross-player pool so the ghost spawn path is exercised
      // deterministically (one team per scheduled ghost wave).
      setErDifficulty(difficulty);
      setPrefetchedGhostTeamsForTests(makeGhostStubPool(ghostWavesForCurrentRun()));
    }
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
      advanceBiomeLikeTheRealGame(globalScene.currentBattle.waveIndex);
    }
    return out;
  };

  /**
   * ER (#350): the harness used to sit in the STARTING biome for all 200
   * waves, so every wild species rolled from the town pool — the wave-200
   * finale generated a Vileplume instead of Eternatus, and biome-specific
   * spawn bugs were invisible. Mirror SelectBiomePhase's classic rules: a new
   * biome every 10 waves via the seeded biome-link walk, switching to END for
   * the final stretch (next wave + 9 ≥ the final wave).
   */
  const advanceBiomeLikeTheRealGame = (justFinishedWave: number): void => {
    if (justFinishedWave % 10 !== 0 || justFinishedWave >= 200) {
      return;
    }
    const nextWaveIndex = justFinishedWave + 1;
    if (globalScene.gameMode.isWaveFinal(nextWaveIndex + 9)) {
      globalScene.newArena(BiomeId.END);
      return;
    }
    const currentBiome = globalScene.arena.biomeId;
    const { biomeLinks } = allBiomes.get(currentBiome);
    if (biomeLinks.length > 0) {
      const candidates: BiomeId[] = biomeLinks
        .filter(b => !Array.isArray(b) || !randSeedInt(b[1]))
        .map(b => (Array.isArray(b) ? b[0] : b));
      globalScene.newArena(
        candidates.length > 0 ? randSeedItem(candidates) : globalScene.generateRandomBiome(nextWaveIndex),
      );
      return;
    }
    globalScene.newArena(globalScene.generateRandomBiome(nextWaveIndex));
  };

  const dumpMode = async (difficulty: ErDifficulty, seed: string, maxWave: number) => {
    const run = await predictRun(seed, maxWave, difficulty);
    console.log(`\n################ ${difficulty.toUpperCase()} | seed=${seed} | waves 1..${maxWave} ################`);
    for (const w of run) {
      if (w.kind === "TRAINER") {
        const er = w.ghost
          ? " {GHOST}"
          : w.factory
            ? " {FACTORY}"
            : w.erKey
              ? ` {ER: ${w.erKey} / ${w.erTier}}`
              : " {vanilla}";
        const bossTag = w.boss ? " *BOSS*" : "";
        console.log(`w${String(w.wave).padStart(3)} [TRAINER]${bossTag} "${w.trainerName}"${er}`);
      } else {
        console.log(`w${String(w.wave).padStart(3)} [WILD]${w.boss ? " *BOSS*" : ""}`);
      }
      for (const e of w.enemies) {
        console.log(`        - ${e.name}  Lv${e.level}  (${e.ability})`);
      }
    }
    const trainerWaves = run.filter(w => w.kind === "TRAINER");
    const erKeys = trainerWaves.map(w => w.erKey).filter((k): k is string => k != null);
    console.log(
      `\n--- ${difficulty.toUpperCase()}: ${trainerWaves.length} trainer battles | ER picks ${erKeys.length} (${new Set(erKeys).size} distinct) | factory ${trainerWaves.filter(w => w.factory).length} | ghosts ${trainerWaves.filter(w => w.ghost).length} ---`,
    );
    return run;
  };

  /** Shared: no mega/primal/origin enemy form before wave 50 (Ace/Elite gate). */
  const assertNoEarlyMegas = (run: WaveRow[]) => {
    for (const w of run) {
      if (w.wave >= 50) {
        continue;
      }
      for (const e of w.enemies) {
        expect(MEGA_FORM_RE.test(e.formKey), `wave ${w.wave}: early mega ${e.name} (${e.formKey})`).toBe(false);
      }
    }
  };

  /** Shared: the wave-195 rival fields 6 mons and its ace is MEGA Rayquaza (#340). */
  const assertMegaRayFinale = (run: WaveRow[]) => {
    const finale = run.find(w => w.wave === 195);
    expect(finale, "wave-195 rival battle exists").toBeDefined();
    expect(finale?.kind).toBe("TRAINER");
    expect(finale?.enemies.length).toBe(6);
    const ace = finale?.enemies[finale.enemies.length - 1];
    expect(ace?.speciesId, "finale ace is Rayquaza").toBe(SpeciesId.RAYQUAZA);
    expect(MEGA_FORM_RE.test(ace?.formKey ?? ""), "finale Rayquaza is MEGA").toBe(true);
  };

  /** Shared: ER Cascoon finale on Elite/Hell at wave 200. */
  const assertErFinale = (run: WaveRow[]) => {
    const finale = run.find(w => w.wave === 200);
    const expected = getErFinalBossSpecies();
    expect(finale && expected ? finale.enemies[0]?.speciesId : null).toBe(
      expected ? (expected.speciesId as number) : null,
    );
  };

  it("ACE — full 1..200 run is PURE VANILLA", async () => {
    const run = await dumpMode("ace", "audit-ace", 200);
    expect(run.length).toBeGreaterThan(0);
    for (const w of run.filter(w => w.kind === "TRAINER")) {
      expect(w.erKey, `wave ${w.wave}: ER roster leaked into Ace`).toBeNull();
      expect(w.ghost, `wave ${w.wave}: ghost leaked into Ace`).toBe(false);
      expect(w.factory, `wave ${w.wave}: factory team leaked into Ace`).toBe(false);
    }
    assertNoEarlyMegas(run);
    const finale = run.find(w => w.wave === 200);
    expect(finale?.enemies[0]?.speciesId, "Ace finale is vanilla Eternatus").toBe(SpeciesId.ETERNATUS);
  });

  it("ELITE — full 1..200 run invariants", async () => {
    const run = await dumpMode("elite", "audit-elite", 200);
    const trainerWaves = run.filter(w => w.kind === "TRAINER");
    // ER rosters never repeat within a run.
    const erKeys = trainerWaves.map(w => w.erKey).filter((k): k is string => k != null);
    expect(new Set(erKeys).size, "ER roster repeated within the run").toBe(erKeys.length);
    // Factory teams appear (sporadic ~15% of regular waves — over ~40 eligible
    // waves the odds of zero are <0.1%; a zero here means the wiring broke).
    expect(trainerWaves.filter(w => w.factory).length, "no factory team appeared all run").toBeGreaterThan(0);
    assertNoEarlyMegas(run);
    assertMegaRayFinale(run);
    assertErFinale(run);
    // Late-game trainer teams must outclass early-game ones (the "unevolved
    // mons late" class): average BST of trainer-wave enemies past wave 150
    // must exceed the average up to wave 30.
    const avgBst = (lo: number, hi: number) => {
      const all = trainerWaves.filter(w => w.wave >= lo && w.wave <= hi).flatMap(w => w.enemies.map(e => e.bst));
      return all.length > 0 ? all.reduce((s, b) => s + b, 0) / all.length : 0;
    };
    const early = avgBst(2, 30);
    const late = avgBst(150, 199);
    expect(late, `late avg BST ${late} vs early ${early}`).toBeGreaterThan(early);
  });

  it("HELL — full 1..200 run invariants (ghost waves spawn ghosts)", async () => {
    const run = await dumpMode("hell", "audit-hell", 200);
    setErDifficulty("hell");
    const schedule = ghostWavesForCurrentRun();
    for (const ghostWave of schedule) {
      const w = run.find(r => r.wave === ghostWave);
      expect(w, `ghost wave ${ghostWave} present`).toBeDefined();
      expect(w?.ghost, `wave ${ghostWave} did not spawn a ghost trainer`).toBe(true);
      expect(w?.trainerName ?? "", `wave ${ghostWave} ghost shows the source player's name`).toContain("AuditGhost");
    }
    assertMegaRayFinale(run);
    assertErFinale(run);
    setErDifficulty("ace");
  });
});
