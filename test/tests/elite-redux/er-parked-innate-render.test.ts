/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// ER parked-innate graceful render (Primal Mew's Shattered Psyche slot).
//
// Primal Mew's innate triple is [Brain Food, Genesis Supernova, AbilityId.NONE].
// The trailing NONE is a DESIGN-PARKED slot (the not-yet-defined Shattered Psyche),
// NOT a bug. The ability screen must OMIT that slot cleanly - never draw a broken /
// blank PASSIVE row. This locks the contract that:
//   - the species-static innate list carries exactly one NONE (the parked slot),
//   - the live-Pokemon getPassiveAbilities() nulls that slot (so the summary loop
//     skips it), leaving only the two real innates rendered.
//
// Gated behind ER_SCENARIO=1.
// =============================================================================

import { allAbilities } from "#data/data-lists";
import { AbilityId } from "#enums/ability-id";
import { SpeciesId } from "#enums/species-id";
import { GameManager } from "#test/framework/game-manager";
import { getPokemonSpecies } from "#utils/pokemon-utils";
import Phaser from "phaser";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

const RUN = process.env.ER_SCENARIO === "1";

describe.skipIf(!RUN)("ER parked-innate graceful render (Primal Mew)", () => {
  let phaserGame: Phaser.Game;
  let game: GameManager;

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });

  beforeEach(() => {
    game = new GameManager(phaserGame);
    game.override.battleStyle("single").startingLevel(50).enemyLevel(50).enemySpecies(SpeciesId.SNORLAX);
  });

  it("the species-static innate triple has exactly one parked NONE slot + two real innates", () => {
    const mew = getPokemonSpecies(SpeciesId.MEW);
    const primalIndex = mew.forms.findIndex(f => f.formKey === "primal");
    expect(primalIndex, "Primal Mew form injected").toBeGreaterThanOrEqual(0);

    const innates = mew.getPassiveAbilities(primalIndex);
    // Exactly one parked slot (NONE) - the design-parked Shattered Psyche.
    const parked = innates.filter(id => id === AbilityId.NONE);
    expect(parked.length, "one design-parked innate slot").toBe(1);
    // The two real innates resolve to live abilities (not NONE).
    const real = innates.filter(id => id !== AbilityId.NONE);
    expect(real.length).toBe(2);
    for (const id of real) {
      expect(allAbilities[id]?.id).toBe(id);
    }
  });

  it("the ability screen omits the NONE slot: no rendered passive is AbilityId.NONE", async () => {
    await game.classicMode.startBattle(SpeciesId.MEW);
    const mon = game.field.getPlayerPokemon();
    // Force into the primal form so the parked innate triple is live.
    const primalIndex = mon.species.forms.findIndex(f => f.formKey === "primal");
    mon.formIndex = primalIndex;

    // getPassiveAbilities NULLs a NONE slot; the summary passive loop skips null
    // AND (post-fix) an AbilityId.NONE object, so no blank PASSIVE row is drawn.
    const rendered = mon.getPassiveAbilities().filter((a): a is NonNullable<typeof a> => a != null);
    expect(
      rendered.every(a => a.id !== AbilityId.NONE),
      "no NONE passive is rendered",
    ).toBe(true);
    // The parked slot is omitted, not rendered as a broken row.
    expect(rendered.length).toBeLessThan(mon.getPassiveAbilities().length);
  });
});
