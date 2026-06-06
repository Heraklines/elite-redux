/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// Repro for "Multi-Headed mons (Doduo, Mawile) hit 3× instead of 2×". Head count
// is a per-species ROM flag (F_TWO_HEADED / F_THREE_HEADED); the old wiring
// hardcoded 3 hits for everyone. getErHeadCount now returns the right count and
// the Multi-Headed ability adds headCount-1 strikes. Gated ER_SCENARIO=1.

import { globalScene } from "#app/global-scene";
import { allAbilities } from "#data/data-lists";
import { ErMultiHeadedAbAttr, getErHeadCount } from "#data/elite-redux/archetypes/multi-headed";
import { ErAbilityId } from "#enums/er-ability-id";
import { SpeciesId } from "#enums/species-id";
import { GameManager } from "#test/framework/game-manager";
import { getPokemonSpecies } from "#utils/pokemon-utils";
import Phaser from "phaser";
import { beforeAll, describe, expect, it } from "vitest";

const RUN = process.env.ER_SCENARIO === "1";

describe.skipIf(!RUN)("ER Multi-Headed head count", () => {
  let phaserGame: Phaser.Game;

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
    void new GameManager(phaserGame);
  });

  const headCountOf = (speciesId: SpeciesId): number => {
    const mon = globalScene.addPlayerPokemon(getPokemonSpecies(speciesId), 50);
    const n = getErHeadCount(mon);
    mon.destroy();
    return n;
  };

  it("is 2 for two-headed mons (Doduo, Mawile, Weezing, Zweilous)", () => {
    expect(headCountOf(SpeciesId.DODUO)).toBe(2);
    expect(headCountOf(SpeciesId.MAWILE)).toBe(2);
    expect(headCountOf(SpeciesId.WEEZING)).toBe(2);
    expect(headCountOf(SpeciesId.ZWEILOUS)).toBe(2);
  });

  it("is 3 for three-headed mons (Dodrio, Hydreigon, Dugtrio, Magnezone)", () => {
    expect(headCountOf(SpeciesId.DODRIO)).toBe(3);
    expect(headCountOf(SpeciesId.HYDREIGON)).toBe(3);
    expect(headCountOf(SpeciesId.DUGTRIO)).toBe(3);
    expect(headCountOf(SpeciesId.MAGNEZONE)).toBe(3);
  });

  it("the Multi-Headed ability is wired with ErMultiHeadedAbAttr (not 2x AddSecondStrike)", () => {
    const ability = allAbilities[ErAbilityId.MULTI_HEADED];
    expect(ability).toBeDefined();
    const multiHeadAttrs = ability.attrs.filter(a => a instanceof ErMultiHeadedAbAttr);
    expect(multiHeadAttrs.length).toBe(1);
  });
});
