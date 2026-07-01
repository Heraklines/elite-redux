/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Regression: the ER custom major statuses (Bleed / Frostbite / Fear) are
// MUTUALLY EXCLUSIVE, like vanilla non-volatile status conditions. A Pokemon
// already afflicted with one must NOT be overwritten by another (bug report:
// "frostbite being replaced by bleed when it should be blocking"). The guard
// lives in each `Er*Tag.canAdd` via `hasOtherErMajorStatus`.
//
// Also re-verifies the Frostbite <-> Paralysis exclusivity (#294) still holds.
//
// Gated behind ER_SCENARIO=1.
// =============================================================================

import { globalScene } from "#app/global-scene";
import { BattlerTagType } from "#enums/battler-tag-type";
import { SpeciesId } from "#enums/species-id";
import { StatusEffect } from "#enums/status-effect";
import { GameManager } from "#test/framework/game-manager";
import { getPokemonSpecies } from "#utils/pokemon-utils";
import Phaser from "phaser";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

const RUN = process.env.ER_SCENARIO === "1";

describe.skipIf(!RUN)("ER major statuses are mutually exclusive", () => {
  let phaserGame: Phaser.Game;

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });

  beforeEach(() => {
    // Rattata: not Rock/Ghost (bleed-eligible), not Ice (frostbite-eligible).
    void new GameManager(phaserGame);
  });

  it("Frostbite blocks a subsequent Bleed; Frostbite remains", () => {
    const mon = globalScene.addPlayerPokemon(getPokemonSpecies(SpeciesId.RATTATA), 50);
    expect(mon.addTag(BattlerTagType.ER_FROSTBITE, 0)).toBe(true);
    expect(mon.addTag(BattlerTagType.ER_BLEED, 0)).toBe(false);
    expect(mon.getTag(BattlerTagType.ER_FROSTBITE)).toBeDefined();
    expect(mon.getTag(BattlerTagType.ER_BLEED)).toBeUndefined();
    mon.destroy();
  });

  it("Bleed blocks a subsequent Frostbite; Bleed remains", () => {
    const mon = globalScene.addPlayerPokemon(getPokemonSpecies(SpeciesId.RATTATA), 50);
    expect(mon.addTag(BattlerTagType.ER_BLEED, 0)).toBe(true);
    expect(mon.addTag(BattlerTagType.ER_FROSTBITE, 0)).toBe(false);
    expect(mon.getTag(BattlerTagType.ER_BLEED)).toBeDefined();
    expect(mon.getTag(BattlerTagType.ER_FROSTBITE)).toBeUndefined();
    mon.destroy();
  });

  it("Fear is blocked by an existing Frostbite (and vice-versa)", () => {
    const a = globalScene.addPlayerPokemon(getPokemonSpecies(SpeciesId.RATTATA), 50);
    a.addTag(BattlerTagType.ER_FROSTBITE, 0);
    expect(a.addTag(BattlerTagType.ER_FEAR, 0)).toBe(false);
    expect(a.getTag(BattlerTagType.ER_FEAR)).toBeUndefined();
    a.destroy();

    const b = globalScene.addPlayerPokemon(getPokemonSpecies(SpeciesId.RATTATA), 50);
    b.addTag(BattlerTagType.ER_FEAR, 0);
    expect(b.addTag(BattlerTagType.ER_BLEED, 0)).toBe(false);
    expect(b.getTag(BattlerTagType.ER_BLEED)).toBeUndefined();
    b.destroy();
  });

  it("re-applying the SAME status is still a no-op overlap (not blocked by the guard)", () => {
    const mon = globalScene.addPlayerPokemon(getPokemonSpecies(SpeciesId.RATTATA), 50);
    expect(mon.addTag(BattlerTagType.ER_FROSTBITE, 0)).toBe(true);
    // Second add of the SAME tag returns false via the existing-tag overlap path,
    // NOT the mutual-exclusion guard; the frostbite is still present.
    expect(mon.addTag(BattlerTagType.ER_FROSTBITE, 0)).toBe(false);
    expect(mon.getTag(BattlerTagType.ER_FROSTBITE)).toBeDefined();
    mon.destroy();
  });

  it("#294: a frostbitten Pokemon cannot be paralyzed (exclusivity intact)", () => {
    const mon = globalScene.addPlayerPokemon(getPokemonSpecies(SpeciesId.RATTATA), 50);
    mon.addTag(BattlerTagType.ER_FROSTBITE, 0);
    expect(mon.trySetStatus(StatusEffect.PARALYSIS)).toBe(false);
    expect(mon.status?.effect).not.toBe(StatusEffect.PARALYSIS);
    mon.destroy();
  });
});
