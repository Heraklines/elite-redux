/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// ER (#135) Tier 1 — Hell post-wave-100 trainer difficulty buff.
//
// On HELL, after wave 100, the trainer's HIGHEST-BST mon is promoted to a 2-bar
// boss carrying a GUARANTEED (stealable) Greater Ward Stone + a resist berry for
// each of its type weaknesses. Non-apex mons are untouched by the forced buff.
//
// This drives the REAL run pipeline (newBattle -> genPartyMember on a natural
// Hell trainer wave > 100, then the encounter phase's generateEnemyModifiers,
// which runs applyErTrainerHeldItems). It then asserts on the live enemy party.
// Gated behind ER_SCENARIO=1 (like the other ER GameManager harnesses).
// =============================================================================

import { globalScene } from "#app/global-scene";
import { ErResistBerryModifier } from "#data/elite-redux/er-resist-berries";
import { resetErDifficulty, setErDifficulty } from "#data/elite-redux/er-run-difficulty";
import { resetErRunTrainerTracking } from "#data/elite-redux/er-trainer-runtime-hook";
import { ErWardStoneModifier } from "#data/elite-redux/er-ward-stones";
import { BattleType } from "#enums/battle-type";
import { ModifierPoolType } from "#enums/modifier-pool-type";
import type { EnemyPokemon } from "#field/pokemon";
import { regenerateModifierPoolThresholds } from "#modifiers/modifier-type";
import { GameManager } from "#test/framework/game-manager";
import Phaser from "phaser";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const RUN = process.env.ER_SCENARIO === "1";

interface HellTrainerBattle {
  party: EnemyPokemon[];
  /** The single highest-BST mon (ties -> lowest party index). */
  apex: EnemyPokemon;
  /** A mon that is NOT the apex. */
  nonApex: EnemyPokemon;
  wave: number;
}

describe.skipIf(!RUN)("ER (#135) Hell post-100 trainer boss buff — Tier 1", () => {
  let phaserGame: Phaser.Game;

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
    void new GameManager(phaserGame);
  });

  afterAll(() => {
    resetErDifficulty();
  });

  const bstOf = (mon: EnemyPokemon): number => mon.getSpeciesForm().baseTotal;

  /**
   * Drive a real Hell run and stop at the FIRST natural trainer wave > 100 whose
   * party has >=2 mons and a UNIQUE highest BST (so "the highest" is
   * unambiguous). Populates the party via genPartyMember, then runs the real
   * modifier pipeline (which invokes applyErTrainerHeldItems -> the Tier-1
   * buff). Returns the live party + the apex / a non-apex mon.
   */
  const findHellTrainerBattle = async (): Promise<HellTrainerBattle> => {
    for (let seedN = 0; seedN < 12; seedN++) {
      setErDifficulty("hell");
      resetErRunTrainerTracking();
      globalScene.setSeed(`hell-boss-buff-${seedN}`);
      Reflect.set(globalScene, "currentBattle", null);
      globalScene.newArena(globalScene.gameMode.getStartingBiome());
      Reflect.set(globalScene, "enemyModifiers", []);

      while ((globalScene.currentBattle?.waveIndex ?? 0) < 200) {
        globalScene.newBattle();
        const battle = globalScene.currentBattle;
        const wave = battle?.waveIndex ?? 0;
        if (wave <= 100 || wave > 200) {
          continue;
        }
        if (battle.battleType !== BattleType.TRAINER || !battle.trainer) {
          continue;
        }

        // Populate the party (the encounter phase does this before modifiers).
        battle.enemyLevels?.forEach((_level, e) => {
          if (!battle.enemyParty[e]) {
            battle.enemyParty[e] = battle.trainer!.genPartyMember(e);
          }
        });
        const party = battle.enemyParty;
        if (party.length < 2) {
          continue;
        }

        // Apex by ACTIVE-form BST (what the buff uses); require it unique.
        let apex = party[0];
        for (const mon of party) {
          if (bstOf(mon) > bstOf(apex)) {
            apex = mon;
          }
        }
        const topBst = bstOf(apex);
        if (party.filter(m => bstOf(m) === topBst).length !== 1) {
          // Reset the freshly built party so the next wave generates clean.
          battle.enemyParty.length = 0;
          continue; // ambiguous apex — keep scanning
        }

        // Run the REAL modifier pipeline (this is what calls applyErTrainerHeldItems).
        Reflect.set(globalScene, "enemyModifiers", []);
        regenerateModifierPoolThresholds(globalScene.getEnemyField(), ModifierPoolType.TRAINER);
        await globalScene.generateEnemyModifiers();

        const nonApex = party.find(m => m !== apex)!;
        return { party, apex, nonApex, wave };
      }
    }
    throw new Error("could not find a natural Hell trainer wave >100 with a unique apex in 12 seeds");
  };

  const wardStoneOf = (mon: EnemyPokemon): ErWardStoneModifier | undefined =>
    globalScene.findModifier(m => m instanceof ErWardStoneModifier && m.pokemonId === mon.id, false) as
      | ErWardStoneModifier
      | undefined;

  const resistBerriesOf = (mon: EnemyPokemon): ErResistBerryModifier[] =>
    globalScene.findModifiers(
      m => m instanceof ErResistBerryModifier && (m as ErResistBerryModifier).pokemonId === mon.id,
      false,
    ) as ErResistBerryModifier[];

  it("promotes the highest-BST trainer mon to a 2-bar boss with a Ward Stone + resist berries", async () => {
    const { apex, nonApex, party, wave } = await findHellTrainerBattle();

    console.log(
      `[#135] wave ${wave}: apex ${apex.getNameToRender({ useIllusion: false })} (BST ${bstOf(apex)}) `
        + `vs non-apex ${nonApex.getNameToRender({ useIllusion: false })} (BST ${bstOf(nonApex)}); party size ${party.length}`,
    );

    // 2 boss health-bar segments on the apex.
    expect(apex.isBoss()).toBe(true);
    expect(apex.bossSegments).toBe(2);

    // A GUARANTEED stealable Ward Stone — the regular tier (greater), NOT Prime (Tier 2).
    const stone = wardStoneOf(apex);
    expect(stone).toBeDefined();
    expect(stone!.tier).toBe("greater");
    expect(stone!.isTransferable).toBe(true);

    // >=1 resist berry (one per type-weakness). A 500+ BST mon has >=1 covered weakness.
    const berries = resistBerriesOf(apex);
    console.log(`[#135] apex carries ${berries.length} resist berr${berries.length === 1 ? "y" : "ies"}`);
    expect(berries.length).toBeGreaterThanOrEqual(1);
  });

  it("does NOT force the boss treatment on a non-apex trainer mon", async () => {
    const { apex, nonApex } = await findHellTrainerBattle();
    expect(bstOf(nonApex)).toBeLessThan(bstOf(apex));

    // The forced 2-bar boss promotion is the apex's alone. Trainer mons are
    // built non-boss (boss segments are only set in the EncounterPhase, which
    // this harness doesn't run), so in this pipeline the ONLY thing that makes a
    // mon a boss is the Tier-1 buff — a non-apex mon must NOT be one.
    expect(nonApex.isBoss()).toBe(false);
  });
});
