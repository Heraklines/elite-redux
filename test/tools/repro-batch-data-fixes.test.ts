/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// REPRO + VERIFY for the data-side bugs in the June batch:
//   #620 Tyrogue must evolve on level-up (stat-branched), not move-gated.
//   #625 Stantler must learn Psyshield Bash on its level-up learnset.
//   #626 Basculin and Basculegion must share a candy bucket (same root species).
//   #621 Phantowl/Noctowl ability pools (documents the by-design rotator finding).
//
// Run: ER_SCENARIO=1 npx vitest run test/tools/repro-batch-data-fixes.test.ts

import { pokemonEvolutions } from "#balance/pokemon-evolutions";
import { pokemonSpeciesLevelMoves } from "#balance/pokemon-level-moves";
import { allAbilities } from "#data/data-lists";
import { MoveId } from "#enums/move-id";
import { SpeciesId } from "#enums/species-id";
import { GameManager } from "#test/framework/game-manager";
import { getPokemonSpecies } from "#utils/pokemon-utils";
import Phaser from "phaser";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const RUN = process.env.ER_SCENARIO === "1";

describe.skipIf(!RUN)("repro: June batch data fixes", () => {
  let g: Phaser.Game;
  beforeAll(() => {
    g = new Phaser.Game({ type: Phaser.HEADLESS });
  });
  afterAll(() => g?.destroy(true));

  it("Stantler learns Psyshield Bash; Tyrogue is level-evolved; Basculegion shares Basculin's candy", async () => {
    const game = new GameManager(g);
    await game.classicMode.startBattle(SpeciesId.PIKACHU);

    // --- #625 Stantler learnset (post ER moveset override) -------------------
    const stantlerMoves = pokemonSpeciesLevelMoves[SpeciesId.STANTLER] ?? [];
    const stantlerHasPsyshield = stantlerMoves.some(([, m]) => m === MoveId.PSYSHIELD_BASH);
    console.log(`Stantler learnset: ${stantlerMoves.map(([lv, m]) => `${MoveId[m]}@${lv}`).join(", ")}`);
    expect(stantlerHasPsyshield, "Stantler must learn Psyshield Bash on level-up (#625)").toBe(true);

    // --- #620 Tyrogue evolution is level-up (no move requirement) ------------
    const tyrogueEvos = pokemonEvolutions[SpeciesId.TYROGUE] ?? [];
    // Each branch must be reachable purely by leveling - none may carry a MOVE
    // requirement (EvoCondKey.MOVE === 3) anymore.
    const tyrogueMoveGated = tyrogueEvos.some(e => (e.condition?.data ?? []).some((c: { key: number }) => c.key === 3));
    console.log(`Tyrogue evolutions: ${tyrogueEvos.map(e => SpeciesId[e.speciesId]).join(", ")}`);
    expect(tyrogueMoveGated, "Tyrogue must not be gated on knowing a move (#620)").toBe(false);
    expect(
      tyrogueEvos.every(e => e.level === 20),
      "Tyrogue branches all evolve at level 20",
    ).toBe(true);

    // --- #626 Basculin <-> Basculegion candy sharing -------------------------
    const basculegionRoot = getPokemonSpecies(SpeciesId.BASCULEGION).getRootSpeciesId();
    console.log(`Basculegion root species: ${SpeciesId[basculegionRoot]}`);
    expect(basculegionRoot, "Basculegion's candy root must be Basculin (#626)").toBe(SpeciesId.BASCULIN);

    // --- #621 Phantowl pool snapshot (documentation only) --------------------
    const phantowl = getPokemonSpecies(10000 as SpeciesId);
    const pool = [phantowl.ability1, phantowl.ability2, phantowl.abilityHidden]
      .map(a => allAbilities[a]?.name)
      .join(" | ");
    console.log(`Phantowl ability pool: ${pool}`);
  }, 120_000);
});
