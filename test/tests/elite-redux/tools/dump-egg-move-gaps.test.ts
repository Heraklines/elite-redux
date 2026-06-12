/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */
// REGRESSION GATE (#417): every egg-pool ER custom's line root must have a
// full (4-move) speciesEggMoves entry at runtime - new pool entrants without
// egg moves fail CI here.
import { speciesEggMoves } from "#balance/moves/egg-moves";
import { pokemonPrevolutions } from "#balance/pokemon-evolutions";
import { speciesEggTiers } from "#balance/species-egg-tiers";
import { allSpecies } from "#data/data-lists";
import type { SpeciesId } from "#enums/species-id";
import { GameManager } from "#test/framework/game-manager";
import Phaser from "phaser";
import { beforeAll, describe, expect, it } from "vitest";

const RUN = process.env.ER_SCENARIO === "1";

describe.skipIf(!RUN)("TOOL: egg-move gaps for egg-pool customs", () => {
  let phaserGame: Phaser.Game;
  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
    void new GameManager(phaserGame);
  });

  it("lists customs in the egg pool with missing/short egg-move sets", () => {
    const byId = new Map(allSpecies.map(sp => [sp.speciesId as number, sp]));
    const tiers = speciesEggTiers as Record<number, number | undefined>;
    const eggMoves = speciesEggMoves as Record<number, number[]>;
    const rootOf = (id: number): number => {
      let cur = id;
      let g = 0;
      while (pokemonPrevolutions[cur as SpeciesId] !== undefined && g++ < 10) {
        cur = pokemonPrevolutions[cur as SpeciesId] as unknown as number;
      }
      return cur;
    };
    const gaps: string[] = [];
    for (const key of Object.keys(tiers)) {
      const id = Number(key);
      if (id < 10000 || tiers[id] === undefined) {
        continue;
      }
      const root = rootOf(id);
      const moves = eggMoves[root];
      if (!moves || moves.length < 4 || moves.every(m => !m)) {
        gaps.push(`${byId.get(id)?.name ?? id} (root ${byId.get(root)?.name ?? root}): ${JSON.stringify(moves)}`);
      }
    }
    console.log(`[eggmove-gaps] ${gaps.length} egg-pool customs with missing/short egg moves:`);
    for (const g of gaps.sort()) {
      console.log("  ", g);
    }
    // #417: every egg-pool custom's line root must carry a full egg-move set.
    expect(gaps).toEqual([]);
  });
});
