/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// ER Primal Mew innate triple - fully defined (the parked slot is now filled).
//
// Primal Mew's innate triple is [Brain Food, Genesis Supernova, Shattered Psyche
// (5968)]. The trailing slot used to be a design-PARKED AbilityId.NONE; it is now
// implemented, so the triple carries THREE real innates and NO parked NONE. The
// summary passive loop still defensively skips a NONE-id passive (it just no
// longer has one to skip on Primal Mew), so no blank PASSIVE row is ever drawn.
//
// Gated behind ER_SCENARIO=1.
// =============================================================================

import { allAbilities } from "#data/data-lists";
import { ER_SHATTERED_PSYCHE_ABILITY_ID } from "#data/elite-redux/abilities/shattered-psyche";
import { AbilityId } from "#enums/ability-id";
import { SpeciesId } from "#enums/species-id";
import { GameManager } from "#test/framework/game-manager";
import { getPokemonSpecies } from "#utils/pokemon-utils";
import Phaser from "phaser";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

const RUN = process.env.ER_SCENARIO === "1";
const SHATTERED_PSYCHE = ER_SHATTERED_PSYCHE_ABILITY_ID as AbilityId;

describe.skipIf(!RUN)("ER Primal Mew innate triple (Shattered Psyche slot filled)", () => {
  let phaserGame: Phaser.Game;
  let game: GameManager;

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });

  beforeEach(() => {
    game = new GameManager(phaserGame);
    game.override.battleStyle("single").startingLevel(50).enemyLevel(50).enemySpecies(SpeciesId.SNORLAX);
  });

  it("the species-static innate triple is three real innates including Shattered Psyche (no parked NONE)", () => {
    const mew = getPokemonSpecies(SpeciesId.MEW);
    const primalIndex = mew.forms.findIndex(f => f.formKey === "primal");
    expect(primalIndex, "Primal Mew form injected").toBeGreaterThanOrEqual(0);

    const innates = mew.getPassiveAbilities(primalIndex);
    // No parked slot remains - the Shattered Psyche placeholder is implemented.
    const parked = innates.filter(id => id === AbilityId.NONE);
    expect(parked.length, "no design-parked innate slot remains").toBe(0);
    // All three innates resolve to live abilities.
    const real = innates.filter(id => id !== AbilityId.NONE);
    expect(real.length).toBe(3);
    for (const id of real) {
      expect(allAbilities[id]?.id).toBe(id);
    }
    // Shattered Psyche (5968) is the filled slot.
    expect(innates).toContain(SHATTERED_PSYCHE);
  });

  it("the ability screen renders all three innates, none of which is AbilityId.NONE", async () => {
    await game.classicMode.startBattle(SpeciesId.MEW);
    const mon = game.field.getPlayerPokemon();
    // Force into the primal form so the innate triple is live.
    const primalIndex = mon.species.forms.findIndex(f => f.formKey === "primal");
    mon.formIndex = primalIndex;

    // The summary passive loop skips null AND an AbilityId.NONE object; with the
    // slot filled there is no NONE, so all three innates render cleanly.
    const rendered = mon.getPassiveAbilities().filter((a): a is NonNullable<typeof a> => a != null);
    expect(
      rendered.every(a => a.id !== AbilityId.NONE),
      "no NONE passive is rendered",
    ).toBe(true);
    expect(
      rendered.some(a => a.id === SHATTERED_PSYCHE),
      "Shattered Psyche innate present",
    ).toBe(true);
  });
});
