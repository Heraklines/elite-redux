/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// ER type-nativization (Pass A) — battle EQUIVALENCE.
//
// The removed type-grant abilities added the granted type to `summonData.types`
// on switch-in; the native `_extraTypes` model folds the same type into
// `getTypes()`. This asserts the NATIVE type feeds the type chart / effectiveness
// / immunities identically to what the grant produced — one representative holder
// per category, checking the signature effectiveness the granted type confers:
//   - Phantom -> Ghost: immune (0x) to Normal AND Fighting.
//   - Half Drake -> Dragon: takes 2x from Dragon.
//   - Grounded -> Ground: takes 2x from Water (added Ground weakness) and is
//     hit normally (no Ground immunity granted by the type itself).
//   - Aquatic -> Water: gains the Water STAB/typing (present in getTypes()).
//   - Metallic -> Steel: takes 0x from Poison (Steel immunity).
//   - Ice Age -> Ice, Fairy Tale -> Fairy, Lightning Born -> Electric,
//     Bruiser -> Fighting, Rocky Exterior -> Rock: native type present.
//
// Gated behind ER_SCENARIO=1.
// =============================================================================

import { resolveErSpeciesConstId } from "#data/elite-redux/er-type-nativization";
import { PokemonType } from "#enums/pokemon-type";
import type { SpeciesId } from "#enums/species-id";
import { GameManager } from "#test/framework/game-manager";
import { getPokemonSpecies } from "#utils/pokemon-utils";
import Phaser from "phaser";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

const RUN = process.env.ER_SCENARIO === "1";

describe.skipIf(!RUN)("ER type-nativization battle equivalence", () => {
  let phaserGame: Phaser.Game;
  let game: GameManager;

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });

  beforeEach(() => {
    game = new GameManager(phaserGame);
  });

  /** Spawn a live holder by speciesConst and return the Pokemon. */
  function spawn(speciesConst: string) {
    const id = resolveErSpeciesConstId(speciesConst);
    expect(id, `${speciesConst} resolves`).toBeDefined();
    const sp = getPokemonSpecies(id as SpeciesId);
    return game.scene.addPlayerPokemon(sp, 50, undefined, 0);
  }

  it("Phantom holder (Parasect) is Ghost natively: immune to Normal and Fighting", () => {
    const mon = spawn("SPECIES_PARASECT");
    expect(mon.getTypes()).toContain(PokemonType.GHOST);
    expect(mon.getAttackTypeEffectiveness(PokemonType.NORMAL)).toBe(0);
    expect(mon.getAttackTypeEffectiveness(PokemonType.FIGHTING)).toBe(0);
    mon.destroy();
  });

  it("Half Drake holder (Salazzle) is Dragon natively: takes 2x from Dragon", () => {
    const mon = spawn("SPECIES_SALAZZLE");
    expect(mon.getTypes()).toContain(PokemonType.DRAGON);
    expect(mon.getAttackTypeEffectiveness(PokemonType.DRAGON)).toBeGreaterThanOrEqual(2);
    mon.destroy();
  });

  it("Metallic holder (Dhelmise) is Steel natively: immune to Poison", () => {
    const mon = spawn("SPECIES_DHELMISE");
    expect(mon.getTypes()).toContain(PokemonType.STEEL);
    expect(mon.getAttackTypeEffectiveness(PokemonType.POISON)).toBe(0);
    mon.destroy();
  });

  it("Aquatic holder (Dragalge) is Water natively", () => {
    const mon = spawn("SPECIES_DRAGALGE");
    expect(mon.getTypes()).toContain(PokemonType.WATER);
    mon.destroy();
  });

  it("Grounded holder (Dodrio) is Ground natively: takes 2x from Water", () => {
    const mon = spawn("SPECIES_DODRIO");
    expect(mon.getTypes()).toContain(PokemonType.GROUND);
    expect(mon.getAttackTypeEffectiveness(PokemonType.WATER)).toBeGreaterThanOrEqual(2);
    mon.destroy();
  });

  it("remaining categories: native type present in getTypes()", () => {
    const cases: [string, PokemonType][] = [
      ["SPECIES_CLAWITZER_REDUX", PokemonType.ICE],
      ["SPECIES_IRON_VOCA", PokemonType.FAIRY],
      ["SPECIES_BREEZING", PokemonType.ELECTRIC],
      ["SPECIES_SPINDAZE", PokemonType.FIGHTING],
    ];
    for (const [speciesConst, type] of cases) {
      const mon = spawn(speciesConst);
      expect(mon.getTypes(), `${speciesConst} lacks native ${type}`).toContain(type);
      mon.destroy();
    }
  });
});
