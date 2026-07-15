/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Phantowl side-change (newcomer patch): its second active ability Emanate
// (5190) is replaced by Spectralize (5123). Applied via er-species-abilities.json
// (the pokedex-override seam), so the base auto-generated species data is left
// untouched. Regression: the rest of the kit (ability1, hidden, innates) is intact.
// =============================================================================

import { GameManager } from "#test/framework/game-manager";
import { getPokemonSpecies } from "#utils/pokemon-utils";
import Phaser from "phaser";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

const RUN = process.env.ER_SCENARIO === "1";
const PHANTOWL = 10000; // ErSpeciesId.PHANTOWL
const SPECTRALIZE = 5123;
const EMANATE = 5190;

describe.skipIf(!RUN)("ER Phantowl Emanate -> Spectralize swap", () => {
  let phaserGame: Phaser.Game;
  let game: GameManager;

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });

  beforeEach(() => {
    game = new GameManager(phaserGame);
  });

  it("carries Spectralize as its 2nd active ability, not Emanate", async () => {
    await game.classicMode.startBattle();
    const phantowl = getPokemonSpecies(PHANTOWL as never);
    expect(phantowl.ability2).toBe(SPECTRALIZE);
    expect([phantowl.ability1, phantowl.ability2, phantowl.abilityHidden]).not.toContain(EMANATE);
  });

  it("leaves the rest of the kit intact (innates unchanged)", async () => {
    await game.classicMode.startBattle();
    const phantowl = getPokemonSpecies(PHANTOWL as never);
    // Base Phantowl innates map to non-empty passive slots; the override only
    // touched ability2, so the passive triple must still be populated.
    const innates = phantowl.getPassiveAbilities();
    expect(innates.length).toBeGreaterThan(0);
    expect(innates).not.toContain(EMANATE);
  });
});
