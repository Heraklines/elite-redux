/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// Repro: monotype (any) challenge → leaving challenge select → starter screen
// blacks out. Console pinned it:
//   TypeError: Cannot read properties of undefined (reading 'formKey')
//     at checkStarterValidForChallenge → updateStarters → resetFilters
// The soft-validity path reads `species.forms[props.formIndex].formKey` while
// walking evolutions; for an ER species whose `forms[formIndex]` is undefined
// (empty/short forms array) it threw, aborting the whole grid render. Fixed with
// optional chaining. This sweeps every starter-pool species through the soft path
// and asserts none throws.

import { speciesStarterCosts } from "#balance/starters";
import type { SpeciesId } from "#enums/species-id";
import { GameManager } from "#test/framework/game-manager";
import { checkStarterValidForChallenge } from "#utils/challenge-utils";
import { getPokemonSpecies } from "#utils/pokemon-utils";
import Phaser from "phaser";
import { beforeAll, describe, expect, it } from "vitest";

describe("ER challenge starter validity (monotype black-screen repro)", () => {
  let phaserGame: Phaser.Game;

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
    void new GameManager(phaserGame);
  });

  it("checkStarterValidForChallenge (soft) does not throw for any starter-pool species", () => {
    const starterIds = Object.keys(speciesStarterCosts).map(s => Number(s) as SpeciesId);
    const failures: string[] = [];
    for (const id of starterIds) {
      try {
        const species = getPokemonSpecies(id);
        // formIndex 0 is enough to expose an empty `forms` array (forms[0] === undefined).
        checkStarterValidForChallenge(species, { formIndex: 0 } as never, true);
      } catch (e) {
        failures.push(`species ${id}: ${(e as Error).message}`);
      }
    }
    expect(failures, `soft challenge validity threw:\n${failures.slice(0, 30).join("\n")}`).toEqual([]);
  });
});
