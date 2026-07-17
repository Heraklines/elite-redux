/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// ER (#19) wild-encounter gating:
//  1. erLegendMinWave - a BST-proportional legendary wave gate. A flat sub-660 ->
//     wave 55 let Regidrago (BST 580) leak into the mid-game as a Lv85 boss.
//  2. deEvolveWildForLevel - drop an under-leveled evolved form to the stage valid
//     for its level (a pool listing Primeape drawn at Lv13; Primeape evolves at 28).
// =============================================================================

import { SpeciesId } from "#enums/species-id";
import { deEvolveWildForLevel, erLegendMinWave } from "#field/arena";
import { getPokemonSpecies } from "#utils/pokemon-utils";
import { describe, expect, it } from "vitest";

describe("ER wild-encounter gates (#19)", () => {
  it("erLegendMinWave scales the legendary gate with BST", () => {
    expect(erLegendMinWave(540)).toBe(55); // floor anchor
    expect(erLegendMinWave(500)).toBe(55); // below anchor -> clamped to floor
    expect(erLegendMinWave(580)).toBe(65); // Regidrago / Regis / Swords of Justice
    expect(erLegendMinWave(600)).toBe(70); // Lati@s / Heatran
    expect(erLegendMinWave(660)).toBe(85); // box legendaries
    expect(erLegendMinWave(680)).toBe(90); // Lugia / Mewtwo / Rayquaza
    expect(erLegendMinWave(720)).toBe(90); // Arceus -> clamped to ceiling
  });

  it("deEvolveWildForLevel drops an under-leveled evolved form to the valid stage", () => {
    const primeape = getPokemonSpecies(SpeciesId.PRIMEAPE);
    expect(primeape).toBeDefined();
    // Mankey -> Primeape is a Lv28 evolution.
    expect(deEvolveWildForLevel(primeape, 13).speciesId).toBe(SpeciesId.MANKEY); // below evo level
    expect(deEvolveWildForLevel(primeape, 28).speciesId).toBe(SpeciesId.PRIMEAPE); // exactly at evo level
    expect(deEvolveWildForLevel(primeape, 40).speciesId).toBe(SpeciesId.PRIMEAPE); // above evo level
    // A base form with no prevolution is left untouched.
    const mankey = getPokemonSpecies(SpeciesId.MANKEY);
    expect(deEvolveWildForLevel(mankey, 5).speciesId).toBe(SpeciesId.MANKEY);
  });

  it("#19 redo: catches the reported Lv9 Raticate but never over-devolves a correctly-evolved high-level mon", () => {
    // The reported bug: a Lv9 Raticate (Rattata evolves at 20) - now walked back.
    const raticate = getPokemonSpecies(SpeciesId.RATICATE);
    expect(deEvolveWildForLevel(raticate, 9).speciesId).toBe(SpeciesId.RATTATA); // under the L20 evo
    expect(deEvolveWildForLevel(raticate, 20).speciesId).toBe(SpeciesId.RATICATE); // exactly at evo
    expect(deEvolveWildForLevel(raticate, 55).speciesId).toBe(SpeciesId.RATICATE); // well above
    // The hotfix regression class: a correctly-evolved Lv100 mon (Patrat -> Watchog at
    // L20) must NOT be devolved. This is the "Lv100 Watchog shown as Patrat" report.
    const watchog = getPokemonSpecies(SpeciesId.WATCHOG);
    expect(deEvolveWildForLevel(watchog, 100).speciesId).toBe(SpeciesId.WATCHOG);
    expect(deEvolveWildForLevel(watchog, 20).speciesId).toBe(SpeciesId.WATCHOG);
  });
});
