/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// Diagnostic: "Liepard hit by Superpower (Fighting) wasn't super-effective."
// Fighting is 2x vs Dark; Liepard is (supposedly) pure Dark. Confirm the runtime
// species typing, Superpower's runtime type, and the type-chart multiplier so we
// know whether the base matchup is correct (=> the report is a fusion/form/item
// case) or genuinely broken.

import { allMoves } from "#data/data-lists";
import { getTypeDamageMultiplier } from "#data/type";
import { MoveId } from "#enums/move-id";
import { PokemonType } from "#enums/pokemon-type";
import { SpeciesId } from "#enums/species-id";
import { GameManager } from "#test/framework/game-manager";
import { getPokemonSpecies } from "#utils/pokemon-utils";
import Phaser from "phaser";
import { beforeAll, describe, expect, it } from "vitest";

describe("ER Liepard vs Superpower (type matchup diagnostic)", () => {
  let phaserGame: Phaser.Game;

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
    void new GameManager(phaserGame);
  });

  it("Liepard is pure Dark at runtime", () => {
    const liepard = getPokemonSpecies(SpeciesId.LIEPARD);
    console.log(
      `[diag] Liepard types: ${PokemonType[liepard.type1]} / ${liepard.type2 == null ? "none" : PokemonType[liepard.type2]}`,
    );
    expect(liepard.type1).toBe(PokemonType.DARK);
    expect(liepard.type2).toBeNull();
  });

  it("Superpower is Fighting at runtime", () => {
    const sp = allMoves[MoveId.SUPERPOWER];
    console.log(`[diag] Superpower type: ${PokemonType[sp.type]}, power ${sp.power}, cat ${sp.category}`);
    expect(sp.type).toBe(PokemonType.FIGHTING);
  });

  it("Fighting is 2x super-effective vs Dark", () => {
    expect(getTypeDamageMultiplier(PokemonType.FIGHTING, PokemonType.DARK)).toBe(2);
  });
});
