/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// ER N-type STATIC species model (newcomer fakemon forms, step 1).
//
// `PokemonSpeciesForm` is natively 2-type (type1 / type2). The newcomer patch
// adds species/forms that are natively 3+ types (Mega Parasect = Bug/Grass/Ghost,
// Primal Regigigas = six types). The static model carries those via an ADDITIVE
// `setExtraTypes()` array; `Pokemon.getBaseTypes()` folds them in so effectiveness,
// STAB, immunity and the N-type battle-info/summary renderers pick them up.
//
// Proven here on a LIVE Pokemon through the real game logic:
//   - a 3-type form: getTypes() carries all three, and the extra type flips a
//     type immunity (Poison vs Water/Steel = x0) that Water alone would not.
//   - a 6-type form (Primal Regigigas typing): getTypes() carries all six and
//     Fighting effectiveness stacks across every weak type (x16).
//   - type1/type2 stay backward-compatible (a form with no extra types is
//     unchanged; duplicates of type1/type2 are dropped).
//
// Gated behind ER_SCENARIO=1.
// =============================================================================

import { PokemonType } from "#enums/pokemon-type";
import { SpeciesId } from "#enums/species-id";
import { GameManager } from "#test/framework/game-manager";
import { getPokemonSpecies } from "#utils/pokemon-utils";
import Phaser from "phaser";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

const RUN = process.env.ER_SCENARIO === "1";

/** Restore a species form-0's static typing after a test mutates it. */
interface FormTypeSnapshot {
  speciesId: SpeciesId;
  type1: PokemonType;
  type2: PokemonType | null;
}

describe.skipIf(!RUN)("ER N-type static species model", () => {
  let phaserGame: Phaser.Game;
  let game: GameManager;
  const snapshots: FormTypeSnapshot[] = [];

  function retype(speciesId: SpeciesId, type1: PokemonType, type2: PokemonType | null, extra: PokemonType[]): void {
    const form = getPokemonSpecies(speciesId).forms[0] ?? getPokemonSpecies(speciesId);
    snapshots.push({ speciesId, type1: form.type1, type2: form.type2 });
    form.setTypes(type1, type2);
    form.setExtraTypes(extra);
  }

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });

  beforeEach(() => {
    game = new GameManager(phaserGame);
    game.override.battleStyle("single").criticalHits(false).enemyLevel(100).startingLevel(100).startingWave(145);
  });

  afterEach(() => {
    // Undo the shared-species mutations (isolate:false — do not bleed into other files).
    for (const snap of snapshots) {
      const form = getPokemonSpecies(snap.speciesId).forms[0] ?? getPokemonSpecies(snap.speciesId);
      form.setTypes(snap.type1, snap.type2);
      form.setExtraTypes([]);
    }
    snapshots.length = 0;
  });

  it("pure data: setExtraTypes drops duplicates of type1/type2 and dedupes", () => {
    const form = getPokemonSpecies(SpeciesId.MAGIKARP).forms[0] ?? getPokemonSpecies(SpeciesId.MAGIKARP);
    snapshots.push({ speciesId: SpeciesId.MAGIKARP, type1: form.type1, type2: form.type2 });
    form.setTypes(PokemonType.WATER, PokemonType.STEEL);
    // WATER + STEEL are already type1/type2; POISON appears twice.
    form.setExtraTypes([PokemonType.WATER, PokemonType.POISON, PokemonType.POISON, PokemonType.STEEL]);
    expect([...form.getExtraTypes()]).toEqual([PokemonType.POISON]);
    expect(form.hasExtraTypes()).toBe(true);
    expect(form.isOfType(PokemonType.POISON)).toBe(true);
    form.setExtraTypes([]);
    expect(form.hasExtraTypes()).toBe(false);
    expect([...form.getExtraTypes()]).toEqual([]);
  });

  it("a 3-type form: getTypes carries all three and the extra type flips a type immunity", async () => {
    // Water/Steel + extra... make it Water/Fire/Steel so Poison is x0 vs the STEEL,
    // which pure-Water would take at x1.
    retype(SpeciesId.MAGIKARP, PokemonType.WATER, PokemonType.FIRE, [PokemonType.STEEL]);
    await game.classicMode.startBattle(SpeciesId.MAGIKARP);
    const karp = game.scene.getPlayerPokemon()!;

    const types = karp.getTypes();
    expect(types).toContain(PokemonType.WATER);
    expect(types).toContain(PokemonType.FIRE);
    expect(types).toContain(PokemonType.STEEL);
    expect(karp.isOfType(PokemonType.STEEL)).toBe(true);

    // Poison is x0 vs Steel (immune), x1 vs Water/Fire -> overall x0.
    expect(karp.getAttackTypeEffectiveness(PokemonType.POISON, {})).toBe(0);
    // Ground is x2 vs Steel/Fire (x2*x2) and x1 vs Water -> x4.
    expect(karp.getAttackTypeEffectiveness(PokemonType.GROUND, {})).toBe(4);
  });

  it("a 6-type form (Primal Regigigas typing): all six types stack in effectiveness", async () => {
    // Normal/Rock/Ice/Steel/Electric/Dragon (Water was removed per maintainer directive
    // 2026-07-22). This is the N-type stress case.
    retype(SpeciesId.MAGIKARP, PokemonType.NORMAL, PokemonType.ROCK, [
      PokemonType.ICE,
      PokemonType.STEEL,
      PokemonType.ELECTRIC,
      PokemonType.DRAGON,
    ]);
    await game.classicMode.startBattle(SpeciesId.MAGIKARP);
    const karp = game.scene.getPlayerPokemon()!;

    const types = karp.getTypes();
    expect(new Set(types).size).toBe(6);
    for (const t of [
      PokemonType.NORMAL,
      PokemonType.ROCK,
      PokemonType.ICE,
      PokemonType.STEEL,
      PokemonType.ELECTRIC,
      PokemonType.DRAGON,
    ]) {
      expect(types).toContain(t);
    }
    // Water is gone: no Water typing on the primal form.
    expect(types).not.toContain(PokemonType.WATER);

    // Fighting: x2 vs Normal, Rock, Ice, Steel; x1 vs Electric, Dragon -> x16.
    expect(karp.getAttackTypeEffectiveness(PokemonType.FIGHTING, {})).toBe(16);
  });
});
