/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// REPRO #621: a player on Phantowl reported the active ability rolling to "Air
// Blower" (Noctowl's ability) when they wanted Low Visibility. Phantowl is the
// L50 evolution of Noctowl. This dumps the LIVE resolved ability pool + passives
// for both species so we can tell whether Phantowl's own pool wrongly carries
// Air Blower (a data bug) or whether the report is just the random Ability
// Randomizer (by design) / an evolution-keeps-pre-evo-ability case.
//
// Run: ER_SCENARIO=1 npx vitest run test/tools/repro-phantowl-abilities.test.ts

import { allAbilities } from "#data/data-lists";
import { SpeciesId } from "#enums/species-id";
import { GameManager } from "#test/framework/game-manager";
import { getPokemonSpecies } from "#utils/pokemon-utils";
import Phaser from "phaser";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const RUN = process.env.ER_SCENARIO === "1";

function abilityName(id: number): string {
  return allAbilities[id]?.name ?? `??(${id})`;
}

describe.skipIf(!RUN)("repro: Phantowl/Noctowl ability pools (#621)", () => {
  let g: Phaser.Game;
  beforeAll(() => {
    g = new Phaser.Game({ type: Phaser.HEADLESS });
  });
  afterAll(() => g?.destroy(true));

  it("dumps the resolved ability + passive pools for Noctowl and Phantowl", async () => {
    const game = new GameManager(g);
    await game.classicMode.startBattle(SpeciesId.PIKACHU);

    for (const [label, id] of [
      ["Noctowl", SpeciesId.NOCTOWL],
      ["Phantowl", 10000 as SpeciesId],
    ] as const) {
      const sp = getPokemonSpecies(id);
      const abilities = [sp.ability1, sp.ability2, sp.abilityHidden].map(a => `${a}:${abilityName(a)}`).join(" | ");
      const pass = sp
        .getPassiveAbilities()
        .map(a => `${a}:${abilityName(a)}`)
        .join(" | ");
      console.log(`${label} (#${id}) abilities: ${abilities}`);
      console.log(`${label} (#${id}) innates  : ${pass}`);
    }
    expect(true).toBe(true);
  }, 120_000);
});
