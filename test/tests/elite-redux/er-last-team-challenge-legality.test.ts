/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// #133 - the starter-select "Use Last Team" shortcut (restoreLastTeam) restores a
// saved Starter[] from the previous run. Before the fix it gated each mon ONLY on
// caughtAttr + the point-value limit, so a saved team could smuggle off-type /
// off-tier / off-color / off-gen mons into a CHALLENGE run (a cheat). restoreLast
// Team now drops any saved mon that fails checkStarterValidForChallenge - the SAME
// gate the starter grid greys illegal mons out with. This test mirrors that exact
// per-mon gate (default-form props, soft=true, like the handler computes) and
// asserts which mons survive under a Mono Type challenge vs none. Gated ER_SCENARIO=1.
// =============================================================================

import { copyChallenge } from "#data/challenge";
import { Challenges } from "#enums/challenges";
import { DexAttr } from "#enums/dex-attr";
import { PokemonType } from "#enums/pokemon-type";
import { SpeciesId } from "#enums/species-id";
import { GameManager } from "#test/framework/game-manager";
import { checkStarterValidForChallenge } from "#utils/challenge-utils";
import { getPokemonSpecies } from "#utils/pokemon-utils";
import Phaser from "phaser";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

const RUN = process.env.ER_SCENARIO === "1";

describe.skipIf(!RUN)("ER (#133): Use Last Team honours the active challenge legality", () => {
  let phaserGame: Phaser.Game;
  let game: GameManager;

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });

  beforeEach(() => {
    game = new GameManager(phaserGame);
  });

  // Mirror restoreLastTeam's per-mon gate EXACTLY: build the default-form dexAttr the
  // handler builds for a saved (non-shiny, male, variant 0, form 0) starter, then run
  // the same checkStarterValidForChallenge(species, props, soft) it now applies. A
  // false result is the mon being dropped from the restored party.
  const survivesRestore = (speciesId: SpeciesId): boolean => {
    const species = getPokemonSpecies(speciesId);
    const gd = game.scene.gameData;
    let dexAttr = DexAttr.NON_SHINY | DexAttr.MALE | DexAttr.DEFAULT_VARIANT;
    dexAttr |= gd.getFormAttr(0);
    return checkStarterValidForChallenge(species, gd.getSpeciesDexAttrProps(species, dexAttr), true);
  };

  it("drops off-type saved mons and keeps the matching type under Mono Water", () => {
    game.scene.gameMode.challenges = [
      copyChallenge({ id: Challenges.SINGLE_TYPE, value: PokemonType.WATER + 1, severity: 1 }),
    ];
    expect(survivesRestore(SpeciesId.SQUIRTLE)).toBe(true); // Water -> stays in the restored team
    expect(survivesRestore(SpeciesId.CHARMANDER)).toBe(false); // Fire -> dropped (was the cheat)
    expect(survivesRestore(SpeciesId.BULBASAUR)).toBe(false); // Grass -> dropped
  });

  it("keeps every saved mon when no challenge is active", () => {
    game.scene.gameMode.challenges = [];
    expect(survivesRestore(SpeciesId.SQUIRTLE)).toBe(true);
    expect(survivesRestore(SpeciesId.CHARMANDER)).toBe(true);
    expect(survivesRestore(SpeciesId.BULBASAUR)).toBe(true);
  });
});
