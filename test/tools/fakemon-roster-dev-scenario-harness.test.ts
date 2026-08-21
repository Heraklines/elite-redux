/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { isDevEncounterPersistenceBypassActive, loadDevTools } from "#app/dev-tools/registry";
import Overrides from "#app/overrides";
import {
  ER_CONKAPITATOR_SPECIES_ID,
  ER_DIPPOWDOWN_SPECIES_ID,
  ER_FALINKS_CONVERGENT_SPECIES_ID,
  ER_GURDURUR_SPECIES_ID,
  ER_INTANGROWTH_SPECIES_ID,
  ER_IRON_STREAM_SPECIES_ID,
  ER_LILLIGANT_VERDANT_SPECIES_ID,
  ER_MISHAMANUS_SPECIES_ID,
  ER_SLABBERIGUS_SPECIES_ID,
  ER_TAGELA_SPECIES_ID,
  ER_TREMBURR_SPECIES_ID,
} from "#data/elite-redux/er-fakemon-pitch-species";
import {
  ER_EGOELK_SPECIES_ID,
  ER_PARTNER_VAPOREON_SPECIES_ID,
  ER_TITANEON_SPECIES_ID,
} from "#data/elite-redux/er-newcomer-species";
import { SpeciesId } from "#enums/species-id";
import { UiMode } from "#enums/ui-mode";
import { GameManager } from "#test/framework/game-manager";
import Phaser from "phaser";
import { beforeAll, describe, expect, it } from "vitest";

const RUN = process.env.ER_SCENARIO === "1";
const SCENARIO_LABELS = Array.from({ length: 8 }, (_, index) => `Roster: new Pokemon ${index + 1}/8`);

type ExpectedShowcasePokemon = Readonly<{
  speciesId: number;
  formIndex: number;
  formKey: string;
}>;

type ExpectedShowcase = Readonly<{
  player: readonly ExpectedShowcasePokemon[];
  enemy: ExpectedShowcasePokemon;
}>;

const expectedPokemon = (speciesId: number, formIndex = 0, formKey = ""): ExpectedShowcasePokemon => ({
  speciesId,
  formIndex,
  formKey,
});

const EXPECTED_SHOWCASES: Readonly<Record<string, ExpectedShowcase>> = {
  "Roster: new Pokemon 6/8": {
    player: [
      expectedPokemon(ER_MISHAMANUS_SPECIES_ID),
      expectedPokemon(ER_FALINKS_CONVERGENT_SPECIES_ID),
      expectedPokemon(ER_IRON_STREAM_SPECIES_ID),
      expectedPokemon(ER_SLABBERIGUS_SPECIES_ID),
      expectedPokemon(ER_EGOELK_SPECIES_ID),
      expectedPokemon(ER_TITANEON_SPECIES_ID),
    ],
    enemy: expectedPokemon(ER_PARTNER_VAPOREON_SPECIES_ID),
  },
  "Roster: new Pokemon 7/8": {
    player: [
      expectedPokemon(ER_TAGELA_SPECIES_ID),
      expectedPokemon(ER_INTANGROWTH_SPECIES_ID),
      expectedPokemon(SpeciesId.CALYREX, 3, "mega"),
      expectedPokemon(SpeciesId.HYPNO, 1, "mega"),
      expectedPokemon(SpeciesId.ALOLA_RAICHU, 1, "mega-male"),
      expectedPokemon(SpeciesId.ALOLA_RAICHU, 2, "mega-female"),
    ],
    enemy: expectedPokemon(ER_LILLIGANT_VERDANT_SPECIES_ID),
  },
  "Roster: new Pokemon 8/8": {
    player: [
      expectedPokemon(SpeciesId.BARBARACLE, 2, "mega-y"),
      expectedPokemon(ER_LILLIGANT_VERDANT_SPECIES_ID, 1, "mega"),
      expectedPokemon(SpeciesId.UXIE, 2, "primal"),
      expectedPokemon(ER_TREMBURR_SPECIES_ID),
      expectedPokemon(ER_GURDURUR_SPECIES_ID),
      expectedPokemon(ER_CONKAPITATOR_SPECIES_ID),
    ],
    enemy: expectedPokemon(ER_DIPPOWDOWN_SPECIES_ID),
  },
};

type DevHarnessWindow = Window & {
  __erLaunchDevScenarioByLabel?: (label: string) => boolean;
};

function unlockOverrides(): void {
  const overrides = Overrides as unknown as Record<string, unknown>;
  const keys = new Set<string>();
  for (
    let current: object | null = overrides;
    current && current !== Object.prototype;
    current = Object.getPrototypeOf(current)
  ) {
    for (const key of Object.getOwnPropertyNames(current)) {
      keys.add(key);
    }
  }
  for (const key of keys) {
    if (key === "constructor") {
      continue;
    }
    let value: unknown;
    try {
      value = overrides[key];
    } catch {
      continue;
    }
    if (typeof value === "function") {
      continue;
    }
    try {
      Object.defineProperty(overrides, key, { value, writable: true, configurable: true, enumerable: true });
    } catch {
      // Non-configurable framework fields do not need scenario overrides.
    }
  }
}

describe.skipIf(!RUN)("fakemon roster dev scenarios", () => {
  let phaserGame: Phaser.Game;

  beforeAll(async () => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
    await loadDevTools();
  });
  it("keeps eight showcase labels unique and contiguous", () => {
    expect(SCENARIO_LABELS).toEqual(Array.from({ length: 8 }, (_, index) => `Roster: new Pokemon ${index + 1}/8`));
    expect(new Set(SCENARIO_LABELS).size).toBe(8);
    expect(Object.keys(EXPECTED_SHOWCASES)).toEqual(SCENARIO_LABELS.slice(5));
  });

  for (const label of SCENARIO_LABELS) {
    it(`${label} launches through the in-game dev picker rail`, async () => {
      const game = new GameManager(phaserGame);
      unlockOverrides();
      await game.runToTitle();

      const launch = (window as DevHarnessWindow).__erLaunchDevScenarioByLabel;
      expect(launch, "the title menu must expose the staging scenario harness").toBeTypeOf("function");
      expect(launch?.(label)).toBe(true);
      expect(isDevEncounterPersistenceBypassActive()).toBe(true);

      await game.phaseInterceptor.to("EncounterPhase");
      await game.phaseInterceptor.to("CommandPhase");

      expect(game.scene.ui.getMode()).toBe(UiMode.COMMAND);
      expect(game.scene.currentBattle.waveIndex).toBe(145);
      expect(game.scene.currentBattle.isClassicFinalBoss).toBe(false);
      expect(game.scene.getPlayerParty()).toHaveLength(6);
      expect(game.scene.getPlayerParty().every(pokemon => pokemon.level === 100)).toBe(true);
      expect(game.scene.getPlayerParty().every(pokemon => pokemon.getMoveset().length > 0)).toBe(true);
      expect(game.scene.getEnemyParty().length).toBeGreaterThan(0);
      const expected = EXPECTED_SHOWCASES[label];
      if (expected) {
        const identity = (pokemon: {
          species: { speciesId: number };
          formIndex: number;
          getFormKey: () => string;
        }) => ({
          speciesId: pokemon.species.speciesId,
          formIndex: pokemon.formIndex,
          formKey: pokemon.getFormKey(),
        });
        expect(game.scene.getPlayerParty().map(identity)).toEqual(expected.player);
        expect(identity(game.scene.getEnemyParty()[0]!)).toEqual(expected.enemy);
      }
    }, 180_000);
  }
});
