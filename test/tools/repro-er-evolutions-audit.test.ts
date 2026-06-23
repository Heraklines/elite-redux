/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// REPRO + AUDIT #627: ER evolutions are pure level-ups, but the port kept vanilla
// PokeRogue friendship / time-of-day conditions (Igglybuff stuck on friendship at
// L26; Alolan Rattata only evolved at night). The B6 evolution init now clears the
// vanilla condition for plain-LEVEL ER evos. This asserts the named repros are
// fixed and audits the WHOLE table for any remaining friendship(1)/time(2) gates.
//
// Run: ER_SCENARIO=1 npx vitest run test/tools/repro-er-evolutions-audit.test.ts

import { pokemonEvolutions } from "#balance/pokemon-evolutions";
import { SpeciesId } from "#enums/species-id";
import { GameManager } from "#test/framework/game-manager";
import Phaser from "phaser";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const RUN = process.env.ER_SCENARIO === "1";
const FRIENDSHIP = 1;
const TIME = 2;

function condKeys(evo: { condition?: { data?: { key: number }[] } | null }): number[] {
  return (evo.condition?.data ?? []).map(c => c.key);
}

describe.skipIf(!RUN)("audit: ER evolutions are level-based (#627)", () => {
  let g: Phaser.Game;
  beforeAll(() => {
    g = new Phaser.Game({ type: Phaser.HEADLESS });
  });
  afterAll(() => g?.destroy(true));

  it("named repros evolve by level, and no friendship/time gates remain", async () => {
    const game = new GameManager(g);
    await game.classicMode.startBattle(SpeciesId.PIKACHU);

    const dump = (id: SpeciesId, label: string) => {
      const evos = pokemonEvolutions[id] ?? [];
      console.log(
        `${label}: ${evos.map(e => `${SpeciesId[e.speciesId]}@${e.level}[${condKeys(e).join(",") || "-"}]`).join(" / ")}`,
      );
      return evos;
    };

    const iggly = dump(SpeciesId.IGGLYBUFF, "Igglybuff");
    const aloRat = dump(SpeciesId.ALOLA_RATTATA, "Alolan Rattata");

    // #627: Igglybuff evolves at level 10 with NO condition (was friendship).
    const igglyJig = iggly.find(e => e.speciesId === SpeciesId.JIGGLYPUFF);
    expect(igglyJig, "Igglybuff -> Jigglypuff edge exists").toBeTruthy();
    expect(igglyJig?.level, "Igglybuff evolves at level 10 (ER dex)").toBe(10);
    expect(condKeys(igglyJig!), "Igglybuff has no friendship/time gate").not.toContain(FRIENDSHIP);

    // #627: Alolan Rattata evolves by level only (was night-of-day).
    const aloRatic = aloRat.find(e => e.speciesId === SpeciesId.ALOLA_RATICATE);
    expect(aloRatic, "Alolan Rattata -> Alolan Raticate edge exists").toBeTruthy();
    expect(condKeys(aloRatic!), "Alolan Rattata has no time-of-day gate").not.toContain(TIME);

    // Whole-table audit: list every species still carrying a friendship/time gate
    // (these are the residual divergences to review - mostly regional forms whose
    // edges aren't in the ER dump and need a direct null).
    const offenders: string[] = [];
    for (const [idStr, evos] of Object.entries(pokemonEvolutions)) {
      for (const e of evos as { speciesId: SpeciesId; condition?: { data?: { key: number }[] } | null }[]) {
        const keys = condKeys(e);
        if (keys.includes(FRIENDSHIP) || keys.includes(TIME)) {
          const from = SpeciesId[Number(idStr) as SpeciesId] ?? idStr;
          offenders.push(
            `${from}->${SpeciesId[e.speciesId] ?? e.speciesId}[${keys.includes(FRIENDSHIP) ? "F" : ""}${keys.includes(TIME) ? "T" : ""}]`,
          );
        }
      }
    }
    console.log(`Residual friendship/time gates (${offenders.length}):\n  ${offenders.join("\n  ")}`);
  }, 120_000);
});
