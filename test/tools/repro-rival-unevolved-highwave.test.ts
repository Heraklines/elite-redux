/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// REPRO #612: at wave 55 on HELL the ER rival fielded high-level UNEVOLVED mons (a
// Growlithe). The rival's STAGE (=> roster species) is mapped from its position in
// the run's rival sequence, but its LEVEL is wave-scaled - so on Hell, extra early
// rivals push the early-stage rosters (Route 110 = Growlithe) onto already mid-game
// waves, giving a high-level unevolved mon. The fix evolves each rival member UP to
// its wave-scaled level (Growlithe -> Arcanine) via getTrainerSpeciesForLevel.
//
// Run: ER_SCENARIO=1 npx vitest run test/tools/repro-rival-unevolved-highwave.test.ts

import { pokemonEvolutions } from "#balance/pokemon-evolutions";
import { resetErDifficulty, setErDifficulty } from "#data/elite-redux/er-run-difficulty";
import {
  applyErRivalOverride,
  getErRivalEntry,
  resetErTrainerCacheFor,
} from "#data/elite-redux/er-trainer-runtime-hook";
import { SpeciesId } from "#enums/species-id";
import { TrainerType } from "#enums/trainer-type";
import { TrainerVariant } from "#enums/trainer-variant";
import { Trainer } from "#field/trainer";
import { GameManager } from "#test/framework/game-manager";
import Phaser from "phaser";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const RUN = process.env.ER_SCENARIO === "1";

describe.skipIf(!RUN)("repro: ER rival fields unevolved mons at a high wave (#612)", () => {
  let g: Phaser.Game;
  beforeAll(() => {
    g = new Phaser.Game({ type: Phaser.HEADLESS });
  });
  afterAll(() => resetErDifficulty());

  it("a wave-55 Hell rival fields a level-appropriate (fully evolved) team, not Growlithe", async () => {
    const game = new GameManager(g);
    await game.classicMode.startBattle(SpeciesId.PIKACHU);
    setErDifficulty("hell");

    // Put us on the wave-55 RIVAL_3 fight with a high (wave-55-Hell) enemy level.
    const battle = game.scene.currentBattle;
    battle.waveIndex = 55;
    battle.enemyLevels = [60, 60, 60, 60, 60, 60];

    const trainer = new Trainer(TrainerType.RIVAL_3, TrainerVariant.DEFAULT);
    resetErTrainerCacheFor(trainer);
    expect(getErRivalEntry(trainer), "the wave-55 Hell rival must be an ER rival").not.toBeNull();

    const team: { name: string; id: number; level: number; remainingEvo: boolean }[] = [];
    for (let i = 0; i < 6; i++) {
      const mon = applyErRivalOverride(trainer, i);
      if (!mon) {
        break;
      }
      const evos = pokemonEvolutions[mon.species.speciesId] ?? [];
      team.push({ name: mon.species.name, id: mon.species.speciesId, level: mon.level, remainingEvo: evos.length > 0 });
    }
    console.log(
      `RIVAL_3 @ w55 Hell team: ${team.map(m => `${m.name}(L${m.level}${m.remainingEvo ? "*EVO" : ""})`).join(", ")}`,
    );

    expect(team.length, "the rival team must not be empty").toBeGreaterThan(0);
    const underEvolved = team.filter(m => m.remainingEvo).map(m => m.name);
    // The fix evolves each member up to its wave-scaled level, so at L60 none should
    // still carry an unmet evolution (Growlithe -> Arcanine, Combusken -> Blaziken, ...).
    expect(
      underEvolved,
      `no rival mon should remain unevolved at a high wave; saw: ${underEvolved.join(", ")}`,
    ).toEqual([]);
    // And concretely: the line the report named (Growlithe) must not appear unevolved.
    expect(
      team.some(m => m.id === SpeciesId.GROWLITHE),
      "a high-level Growlithe must not be fielded",
    ).toBe(false);
  }, 120_000);
});
