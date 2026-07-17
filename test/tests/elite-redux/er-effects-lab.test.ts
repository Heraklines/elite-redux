/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// ER Effects Lab - category registry + Transformation-Effect evolution list.
//
// Covers the DATA tier of the Effects Lab section of the Shiny Lab (the interactive
// preview view + FX are exercised by the render harness recipes `er-effects-lab` /
// `er-effects-lab-back`):
//   - the data-driven category registry shape (one "Transformation Effects"
//     category today, each a `{ id, label, buildView }` descriptor);
//   - the evolution-list derivation is REGISTRATION-DERIVED, never hardcoded: it
//     mirrors the live Omniform family of the Partner Eevee head, so it leads with
//     the head and includes every registered partner evolution (and would pick up
//     any future one automatically).
//
// Gated behind ER_SCENARIO=1 (needs the ER species/registry init that populates the
// Omniform registration).
// =============================================================================

import { ER_PARTNER_FAMILY } from "#data/elite-redux/er-newcomer-species";
import { AbilityId } from "#enums/ability-id";
import { MoveId } from "#enums/move-id";
import { SpeciesId } from "#enums/species-id";
import { GameManager } from "#test/framework/game-manager";
import { ER_EFFECTS_LAB_CATEGORIES, getErTransformEffectEvolutions } from "#ui/handlers/er-effects-lab";
import { getPokemonSpecies } from "#utils/pokemon-utils";
import Phaser from "phaser";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

const RUN = process.env.ER_SCENARIO === "1";

/** The vanilla Eevee "partner" form index (the Omniform family HEAD is this form). */
function partnerFormIndex(): number {
  return getPokemonSpecies(SpeciesId.EEVEE).forms.findIndex(f => f.formKey === "partner");
}

describe.skipIf(!RUN)("ER Effects Lab (data tier)", () => {
  let phaserGame: Phaser.Game;
  let game: GameManager;

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });

  beforeEach(async () => {
    game = new GameManager(phaserGame);
    game.override
      .battleStyle("single")
      .criticalHits(false)
      .startingLevel(50)
      .enemyLevel(50)
      .enemySpecies(SpeciesId.MAGIKARP)
      .enemyAbility(AbilityId.BALL_FETCH)
      .enemyMoveset(MoveId.SPLASH)
      .starterForms({ [SpeciesId.EEVEE]: partnerFormIndex() });
    // A real boot runs the ER newcomer registration that populates the Omniform
    // family; the derivation reads that live registration.
    await game.classicMode.startBattle(SpeciesId.EEVEE);
  });

  it("category registry is a data-driven list; Transformation Effects ships today", () => {
    expect(ER_EFFECTS_LAB_CATEGORIES.length).toBeGreaterThanOrEqual(1);
    for (const cat of ER_EFFECTS_LAB_CATEGORIES) {
      expect(typeof cat.id).toBe("string");
      expect(cat.id.length).toBeGreaterThan(0);
      expect(typeof cat.label).toBe("string");
      expect(cat.label.length).toBeGreaterThan(0);
      // No em dashes in a player-facing label (maintainer writing rule).
      expect(cat.label).not.toContain("—");
      expect(typeof cat.buildView).toBe("function");
    }
    const transform = ER_EFFECTS_LAB_CATEGORIES.find(c => c.id === "transformation");
    expect(transform).toBeDefined();
    expect(transform?.label).toBe("Transformation Effects");
  });

  it("evolution list is registration-derived: head first, then every partner evolution", () => {
    const entries = getErTransformEffectEvolutions();
    // Head (Eevee partner) + at least one evolution.
    expect(entries.length).toBeGreaterThan(1);

    // It mirrors the partner REGISTRATION (identity-for-identity, order preserved):
    // the Eevee "partner" HEAD, then every ER_PARTNER_FAMILY entry - derived from the
    // registration table, not a hardcoded list.
    const headIdx = partnerFormIndex();
    expect(headIdx).toBeGreaterThanOrEqual(0);
    const expectedIds = [`${SpeciesId.EEVEE}:${headIdx}`, ...ER_PARTNER_FAMILY.map(def => `${def.partnerId}:0`)];
    expect(entries.map(e => `${e.speciesId}:${e.formIndex}`)).toEqual(expectedIds);

    // Leads with the family head (the vanilla Eevee partner form).
    expect(entries[0].speciesId).toBe(SpeciesId.EEVEE);
    expect(entries[0].formIndex).toBe(headIdx);

    // Every registered partner evolution appears (future ones are covered too since
    // the assertion tracks the table, not a fixed count).
    for (const def of ER_PARTNER_FAMILY) {
      expect(entries.some(e => e.speciesId === def.partnerId)).toBe(true);
    }

    // Each entry resolves a real species + form + display name for the strip/FX.
    for (const entry of entries) {
      expect(entry.species).toBeTruthy();
      expect(entry.form).toBeTruthy();
      expect(entry.name.length).toBeGreaterThan(0);
      expect(typeof entry.form.type1).toBe("number");
    }
  });
});
