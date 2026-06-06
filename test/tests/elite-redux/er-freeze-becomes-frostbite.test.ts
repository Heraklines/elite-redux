/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// ER replaces vanilla FREEZE with Frostbite. Any attempt to freeze a Pokemon
// must instead apply the ER_FROSTBITE battler tag and never set the FREEZE
// status. Gated behind ER_SCENARIO=1.

import { globalScene } from "#app/global-scene";
import { BattlerTagType } from "#enums/battler-tag-type";
import { SpeciesId } from "#enums/species-id";
import { StatusEffect } from "#enums/status-effect";
import { GameManager } from "#test/framework/game-manager";
import { getPokemonSpecies } from "#utils/pokemon-utils";
import Phaser from "phaser";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

const RUN = process.env.ER_SCENARIO === "1";

describe.skipIf(!RUN)("ER freeze is replaced by Frostbite", () => {
  let phaserGame: Phaser.Game;

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });

  beforeEach(() => {
    // GameManager wires up globalScene + an empty field/party context.
    void new GameManager(phaserGame);
  });

  it("trySetStatus(FREEZE) applies ER_FROSTBITE, never the FREEZE status", () => {
    // Rattata: not Ice-type, so neither freeze nor frostbite is immune.
    const mon = globalScene.addPlayerPokemon(getPokemonSpecies(SpeciesId.RATTATA), 20);
    const applied = mon.trySetStatus(StatusEffect.FREEZE);
    expect(applied).toBe(true);
    expect(mon.getTag(BattlerTagType.ER_FROSTBITE)).toBeDefined();
    expect(mon.status?.effect).not.toBe(StatusEffect.FREEZE);
    mon.destroy();
  });

  it("an Ice-type is immune to the frostbite redirect (was freeze-immune)", () => {
    const mon = globalScene.addPlayerPokemon(getPokemonSpecies(SpeciesId.SPHEAL), 20); // Ice/Water
    const applied = mon.trySetStatus(StatusEffect.FREEZE);
    expect(applied).toBe(false);
    expect(mon.getTag(BattlerTagType.ER_FROSTBITE)).toBeUndefined();
    expect(mon.status?.effect).not.toBe(StatusEffect.FREEZE);
    mon.destroy();
  });
});
