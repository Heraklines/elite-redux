/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// ER Omniform evolution VIEW model (src/ui/omniform-evolution-view.ts).
//
//   - the strip WINDOW math (pure): windowed scrolling + the 18-evolution cap;
//   - the evolution-list DERIVATION from registration (ER_SCENARIO): a Partner
//     Eevee yields the head + every registered partner eeveelution with the
//     current form marked; a normal single-form mon yields NOTHING (so the strip
//     never renders for it).
// =============================================================================

import { ER_PARTNER_EEVEE_ABILITY_ID } from "#data/elite-redux/abilities/composite-newcomers";
import { ER_PARTNER_FAMILY } from "#data/elite-redux/er-newcomer-species";
import { AbilityId } from "#enums/ability-id";
import { SpeciesId } from "#enums/species-id";
import { GameManager } from "#test/framework/game-manager";
import {
  computeStripWindow,
  currentEvolutionIndex,
  getOmniformEvolutions,
  isOmniformMon,
  OMNIFORM_MAX_EVOLUTIONS,
} from "#ui/omniform-evolution-view";
import { getPokemonSpecies } from "#utils/pokemon-utils";
import Phaser from "phaser";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

// -----------------------------------------------------------------------------
// Pure strip WINDOW math - no game boot needed.
// -----------------------------------------------------------------------------
describe("Omniform strip window math", () => {
  it("shows all entries with no overflow when they fit the window", () => {
    const w = computeStripWindow(4, 0, 5);
    expect(w).toEqual({ start: 0, count: 4, hasLeft: false, hasRight: false });
  });

  it("keeps the selection centred and flags right overflow at the start", () => {
    const w = computeStripWindow(9, 0, 5);
    expect(w.start).toBe(0);
    expect(w.count).toBe(5);
    expect(w.hasLeft).toBe(false);
    expect(w.hasRight).toBe(true);
  });

  it("scrolls and flags both overflows in the middle", () => {
    const w = computeStripWindow(9, 4, 5);
    expect(w.start).toBe(2);
    expect(w.count).toBe(5);
    expect(w.hasLeft).toBe(true);
    expect(w.hasRight).toBe(true);
  });

  it("clamps to the end and flags only left overflow", () => {
    const w = computeStripWindow(9, 8, 5);
    expect(w.start).toBe(4);
    expect(w.count).toBe(5);
    expect(w.hasLeft).toBe(true);
    expect(w.hasRight).toBe(false);
  });

  it("caps the browsable count at the 18-evolution maximum (scrolling)", () => {
    expect(OMNIFORM_MAX_EVOLUTIONS).toBe(18);
    // 24 registered, but only 18 are browsable; a late selection still windows.
    const w = computeStripWindow(24, 17, 5);
    expect(w.count).toBe(5);
    expect(w.start).toBe(13); // clamped to cap(18) - size(5)
    expect(w.hasRight).toBe(false);
    expect(w.hasLeft).toBe(true);
  });

  it("is safe for degenerate inputs (0 / 1 entries)", () => {
    expect(computeStripWindow(0, 0, 5)).toEqual({ start: 0, count: 0, hasLeft: false, hasRight: false });
    expect(computeStripWindow(1, 0, 5)).toEqual({ start: 0, count: 1, hasLeft: false, hasRight: false });
  });
});

// -----------------------------------------------------------------------------
// Evolution-list DERIVATION from registration - needs the real ER data (boot).
// -----------------------------------------------------------------------------
const RUN = process.env.ER_SCENARIO === "1";

describe.skipIf(!RUN)("Omniform evolution derivation (Partner Eevee)", () => {
  let phaserGame: Phaser.Game;
  let game: GameManager;

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });

  beforeEach(() => {
    game = new GameManager(phaserGame);
    const partnerFormIndex = getPokemonSpecies(SpeciesId.EEVEE).forms.findIndex(f => f.formKey === "partner");
    game.override
      .battleStyle("single")
      .starterForms({ [SpeciesId.EEVEE]: partnerFormIndex })
      .ability(ER_PARTNER_EEVEE_ABILITY_ID as AbilityId);
  });

  it("marks Partner Eevee as an Omniform mon and lists every registered evolution", async () => {
    await game.classicMode.startBattle(SpeciesId.EEVEE);
    const mon = game.field.getPlayerPokemon();

    expect(isOmniformMon(mon)).toBe(true);

    const evos = getOmniformEvolutions(mon);
    // The head (Eevee partner form) + every registered partner eeveelution.
    expect(evos.length).toBe(ER_PARTNER_FAMILY.length + 1);

    // The list is registration-DERIVED: every partner family species appears.
    for (const def of ER_PARTNER_FAMILY) {
      expect(evos.some(e => e.speciesId === def.partnerId)).toBe(true);
    }

    // The current battle-active form (Eevee partner) leads and is marked distinctly.
    const currentIdx = currentEvolutionIndex(evos);
    expect(currentIdx).toBe(0);
    expect(evos[currentIdx].isCurrent).toBe(true);
    expect(evos[currentIdx].speciesId).toBe(SpeciesId.EEVEE);
    // Exactly one entry is the current form.
    expect(evos.filter(e => e.isCurrent).length).toBe(1);
  });

  it("resolves each evolution's ACTIVE + INNATE abilities from its registration", async () => {
    await game.classicMode.startBattle(SpeciesId.EEVEE);
    const mon = game.field.getPlayerPokemon();
    const evos = getOmniformEvolutions(mon);

    const vaporeon = evos.find(e => e.speciesId === ER_PARTNER_FAMILY[0].partnerId);
    expect(vaporeon).toBeDefined();
    // A partner eeveelution carries the composite (Omniform) as its innate[0].
    expect(vaporeon!.innateAbilityIds[0]).toBe(ER_PARTNER_FAMILY[0].compositeId);
    expect(vaporeon!.activeAbilityId).not.toBe(AbilityId.NONE);
  });

  it("does NOT treat a normal single-form mon as an Omniform mon (no strip)", async () => {
    game.override.starterForms({}).ability(AbilityId.NONE);
    await game.classicMode.startBattle(SpeciesId.GARCHOMP);
    const mon = game.field.getPlayerPokemon();

    expect(isOmniformMon(mon)).toBe(false);
    expect(getOmniformEvolutions(mon)).toEqual([]);
  });
});
