/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */
// Regression: EggLapsePhase generates an egg Pokémon (egg.ts) at the hidden-
// ability slot (abilityIndex 2). For an ER-custom species whose ability id
// isn't registered in `allAbilities`, `getAbility()` returned `undefined` and
// `hasAbility().id` threw during construction (generateNature → calculateStats),
// an UNCAUGHT promise rejection that stalled EggLapsePhase → battle softlock.
// `getAbility()` must always return a valid Ability.
import { allSpecies } from "#data/data-lists";
import { AbilityId } from "#enums/ability-id";
import { SpeciesId } from "#enums/species-id";
import { GameManager } from "#test/framework/game-manager";
import Phaser from "phaser";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

const VANILLA_CUTOFF = 5000;

describe("ER egg-generation ability resolution", () => {
  let phaserGame: Phaser.Game;
  let game: GameManager;

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });

  beforeEach(() => {
    game = new GameManager(phaserGame);
    game.override.battleStyle("single");
  });

  it("every ER-custom species constructs at the hidden-ability slot without throwing", async () => {
    await game.classicMode.startBattle([SpeciesId.MAGIKARP]);
    const customs = allSpecies.filter(s => s?.speciesId >= VANILLA_CUTOFF);
    expect(customs.length).toBeGreaterThan(0);

    const offenders: string[] = [];
    let crashed = 0;
    for (const species of customs) {
      try {
        // Mirror egg.ts generatePlayerPokemonHelper: abilityIndex 2 (hidden).
        const mon = game.scene.addPlayerPokemon(species, 1, 2, undefined, undefined, false);
        const ability = mon.getAbility();
        // getAbility() must never return undefined (callers deref `.id`).
        if (!ability || typeof ability.id !== "number") {
          offenders.push(`${species.name}(${species.speciesId}) → bad ability`);
        }
        // Exercise the exact crash path: hasAbility derefs getAbility().id.
        mon.hasAbility(AbilityId.WONDER_GUARD, false, true);
        mon.destroy();
      } catch (err) {
        crashed++;
        if (offenders.length < 15) {
          offenders.push(`${species.name}(${species.speciesId}) THREW: ${(err as Error).message}`);
        }
      }
    }
    expect(crashed, `construction threw for ${crashed} ER customs:\n${offenders.slice(0, 15).join("\n")}`).toBe(0);
    expect(offenders, offenders.slice(0, 15).join("\n")).toHaveLength(0);
  }, 120_000);
});
