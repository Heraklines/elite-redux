/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// #419 - Elite trainer BST curve. The curve report (docs/er-bst-curve-report.md)
// showed wave-20 boss teams fielding Kyogre/Suicune/Manaphy at lvl 11. Elite
// trainer mons over the wave's BST ceiling (or legend-like before wave 80) are
// now DEVOLVED stage by stage, or SWAPPED for a wave-appropriate factory pick
// when no prevolution fits. Hell uses its own steeper ladder. Gated behind
// ER_SCENARIO=1.
// =============================================================================

import { allSpecies } from "#data/data-lists";
import { ER_ID_MAP } from "#data/elite-redux/er-id-map";
import { setErDifficulty } from "#data/elite-redux/er-run-difficulty";
import { enforceErEliteBstCurve, enforceErEliteBstCurveForParty } from "#data/elite-redux/er-trainer-runtime-hook";
import { AbilityId } from "#enums/ability-id";
import { MoveId } from "#enums/move-id";
import { SpeciesFormKey } from "#enums/species-form-key";
import { SpeciesId } from "#enums/species-id";
import type { EnemyPokemon } from "#field/pokemon";
import { GameManager } from "#test/framework/game-manager";
import { getPokemonSpecies } from "#utils/pokemon-utils";
import Phaser from "phaser";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

const RUN = process.env.ER_SCENARIO === "1";

describe.skipIf(!RUN)("ER Elite BST curve enforcement (#419)", () => {
  let phaserGame: Phaser.Game;
  let game: GameManager;

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });

  beforeEach(() => {
    game = new GameManager(phaserGame);
    game.override
      .battleStyle("single")
      .enemySpecies(SpeciesId.MAGIKARP)
      .enemyAbility(AbilityId.BALL_FETCH)
      .enemyMoveset(MoveId.SPLASH)
      .enemyLevel(11)
      .startingLevel(11)
      .ability(AbilityId.BALL_FETCH);
  });

  afterEach(() => {
    setErDifficulty("ace");
  });

  const retarget = (speciesId: SpeciesId, wave: number): EnemyPokemon => {
    const enemy = game.scene.getEnemyPokemon()! as EnemyPokemon;
    enemy.species = getPokemonSpecies(speciesId);
    enemy.formIndex = 0;
    (game.scene.currentBattle as unknown as { waveIndex: number }).waveIndex = wave;
    return enemy;
  };

  const findEarlyMegaCandidate = (overCap = 460) => {
    const megaKeys = new Set([SpeciesFormKey.MEGA, SpeciesFormKey.MEGA_X, SpeciesFormKey.MEGA_Y]);
    for (const species of allSpecies) {
      const baseBst = (species.forms?.[0] ?? species).getBaseStatTotal();
      const formIndex =
        species.forms?.findIndex(
          (form, index) =>
            index > 0 && megaKeys.has(form.formKey as SpeciesFormKey) && form.getBaseStatTotal() > overCap,
        ) ?? -1;
      if (baseBst <= 460 && formIndex > 0) {
        return { species, formIndex, baseBst };
      }
    }
    throw new Error("Expected an ER mega with a wave-5-legal base species");
  };

  it("wave-20 Kyogre (the report case) is swapped for a non-legend under the boss cap", async () => {
    await game.classicMode.startBattle(SpeciesId.SNORLAX);
    setErDifficulty("elite");
    const enemy = retarget(SpeciesId.KYOGRE, 20);
    enforceErEliteBstCurve(enemy);
    expect(enemy.species.speciesId).not.toBe(SpeciesId.KYOGRE);
    expect(enemy.species.getBaseStatTotal()).toBeLessThanOrEqual(460); // 420 + 40 boss headroom
    expect(enemy.species.legendary || enemy.species.subLegendary || enemy.species.mythical).toBe(false);
  });

  it("an over-cap final stage devolves (Garchomp at wave 30 becomes its prevolution)", async () => {
    await game.classicMode.startBattle(SpeciesId.SNORLAX);
    setErDifficulty("elite");
    const enemy = retarget(SpeciesId.GARCHOMP, 33);
    enforceErEliteBstCurve(enemy);
    expect(enemy.species.speciesId).toBe(SpeciesId.GABITE);
  });

  it("caps early Hell spawns but removes the cap past wave 100", async () => {
    await game.classicMode.startBattle(SpeciesId.SNORLAX);
    setErDifficulty("hell");
    const early = retarget(SpeciesId.KYOGRE, 20);
    enforceErEliteBstCurve(early);
    expect(early.species.speciesId).not.toBe(SpeciesId.KYOGRE);
    expect(early.getSpeciesForm().getBaseStatTotal()).toBeLessThanOrEqual(500); // 460 + 40 boss headroom

    const late = retarget(SpeciesId.KYOGRE, 120);
    enforceErEliteBstCurve(late);
    expect(late.species.speciesId).toBe(SpeciesId.KYOGRE);
  });

  it("evaluates the active form and reverts an over-cap mega to its legal base form", async () => {
    await game.classicMode.startBattle(SpeciesId.SNORLAX);
    setErDifficulty("hell");
    const candidate = findEarlyMegaCandidate();
    const enemy = retarget(candidate.species.speciesId as SpeciesId, 5);
    enemy.formIndex = candidate.formIndex;
    expect(enemy.getSpeciesForm().getBaseStatTotal()).toBeGreaterThan(460);

    enforceErEliteBstCurve(enemy);

    expect(enemy.species.speciesId).toBe(candidate.species.speciesId);
    expect(enemy.formIndex).toBe(0);
    expect(enemy.getSpeciesForm().getBaseStatTotal()).toBe(candidate.baseBst);
  });

  it("rechecks a legal base after a held-item mutation makes it an over-cap mega", async () => {
    await game.classicMode.startBattle(SpeciesId.SNORLAX);
    setErDifficulty("hell");
    const candidate = findEarlyMegaCandidate(520);
    const enemy = retarget(candidate.species.speciesId as SpeciesId, 35);
    expect(enemy.getSpeciesForm().getBaseStatTotal()).toBeLessThanOrEqual(520);

    // Mirrors the held-mega-stone ordering: the base passed the first gate,
    // then the item changed the final fielded form.
    enforceErEliteBstCurve(enemy);
    enemy.formIndex = candidate.formIndex;
    expect(enemy.getSpeciesForm().getBaseStatTotal()).toBeGreaterThan(520);

    enforceErEliteBstCurveForParty([enemy]);

    expect(enemy.formIndex).toBe(0);
    expect(enemy.getSpeciesForm().getBaseStatTotal()).toBeLessThanOrEqual(520);
  });

  it("clamps standalone ER mega species such as Mega Typhlosion", async () => {
    await game.classicMode.startBattle(SpeciesId.SNORLAX);
    setErDifficulty("hell");
    const megaTyphlosionId = ER_ID_MAP.species[2137] as SpeciesId;
    const enemy = retarget(megaTyphlosionId, 5);
    expect(enemy.getSpeciesForm().getBaseStatTotal()).toBeGreaterThan(460);

    enforceErEliteBstCurve(enemy);

    expect(enemy.species.speciesId).not.toBe(megaTyphlosionId);
    expect(enemy.getSpeciesForm().getBaseStatTotal()).toBeLessThanOrEqual(460);
  });
});
