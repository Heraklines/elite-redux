/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Regression (#mono-fairy) - a Mono-Type challenge's STARTER filter and its in-battle
// ENFORCEMENT must use the SAME type predicate. Post type-nativization, a type a mon
// used to gain from an ability (e.g. Fairy via FAIRY_TALE) is now a NATIVE extra/N-type
// (setExtraTypes), which getBaseTypes -> isOfType (enforcement) folds in. The starter
// filter checked only [type1, type2], so an extra-typed mon was legal to FIELD/CATCH in
// the challenge but wrongly greyed out of the starter grid - the reported mono-Fairy
// Redux mismatch. The filter now includes getExtraTypes(), so both agree.
//
// Gated ER_SCENARIO=1 (needs ER init to run type-nativization).
// =============================================================================

import { copyChallenge } from "#data/challenge";
import { allSpecies } from "#data/data-lists";
import { Challenges } from "#enums/challenges";
import { DexAttr } from "#enums/dex-attr";
import { PokemonType } from "#enums/pokemon-type";
import { SpeciesId } from "#enums/species-id";
import { GameManager } from "#test/framework/game-manager";
import { checkStarterValidForChallenge } from "#utils/challenge-utils";
import { getPokemonSpecies, getPokemonSpeciesForm } from "#utils/pokemon-utils";
import Phaser from "phaser";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

const RUN = process.env.ER_SCENARIO === "1";

describe.skipIf(!RUN)("ER (#mono-fairy): mono-type starter filter honours native extra/N-types", () => {
  let phaserGame: Phaser.Game;
  let game: GameManager;

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });

  beforeEach(() => {
    game = new GameManager(phaserGame);
  });

  const validUnderMonoFairy = (speciesId: number): boolean => {
    const species = getPokemonSpecies(speciesId);
    const gd = game.scene.gameData;
    let dexAttr = DexAttr.NON_SHINY | DexAttr.MALE | DexAttr.DEFAULT_VARIANT;
    dexAttr |= gd.getFormAttr(0);
    return checkStarterValidForChallenge(species, gd.getSpeciesDexAttrProps(species, dexAttr), true);
  };

  it("a mon that is Fairy ONLY via a native extra type is starter-legal under Mono Fairy", () => {
    game.scene.gameMode.challenges = [
      copyChallenge({ id: Challenges.SINGLE_TYPE, value: PokemonType.FAIRY + 1, severity: 1 }),
    ];

    // Find a species whose DEFAULT form is Fairy ONLY as an extra/N-type (not type1/type2)
    // - the exact class type-nativization produces (e.g. Iron Voca via FAIRY_TALE).
    const extraFairy = allSpecies.find(s => {
      const form = getPokemonSpeciesForm(s.speciesId, 0);
      const base = [form.type1, form.type2];
      return !base.includes(PokemonType.FAIRY) && form.getExtraTypes().includes(PokemonType.FAIRY);
    });

    expect(extraFairy, "expected at least one native-extra-Fairy species post-nativization").toBeDefined();
    // The predicate fix: an extra-typed Fairy mon is now starter-legal (matching in-battle
    // isOfType enforcement, which already folds in getExtraTypes()).
    expect(validUnderMonoFairy(extraFairy!.speciesId)).toBe(true);

    // Sanity: the filter still REJECTS a genuinely non-Fairy mon (no over-permissiveness).
    expect(validUnderMonoFairy(SpeciesId.CHARMANDER)).toBe(false); // Fire
    // And a vanilla Fairy (type in the base slots) stays legal.
    expect(validUnderMonoFairy(SpeciesId.CLEFAIRY)).toBe(true);
  });
});
