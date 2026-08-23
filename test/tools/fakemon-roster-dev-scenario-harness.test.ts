/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { isDevEncounterPersistenceBypassActive, loadDevTools } from "#app/dev-tools/registry";
import Overrides from "#app/overrides";
import {
  ER_CHROMIGHTY_SPECIES_ID,
  ER_CONKAPITATOR_SPECIES_ID,
  ER_DIPPOWDOWN_SPECIES_ID,
  ER_FAKEMON_PITCH_SPECIES,
  ER_FALINKS_CONVERGENT_SPECIES_ID,
  ER_GURDURUR_SPECIES_ID,
  ER_GUZZLORD_M_SPECIES_ID,
  ER_INTANGROWTH_SPECIES_ID,
  ER_IRON_STREAM_SPECIES_ID,
  ER_LILLIGANT_VERDANT_SPECIES_ID,
  ER_MISHAMANUS_SPECIES_ID,
  ER_QUAKERSBY_SPECIES_ID,
  ER_SLABBERIGUS_SPECIES_ID,
  ER_TAGELA_SPECIES_ID,
  ER_TEMPORAL_SKULL_SPECIES_ID,
  ER_TREMBURR_SPECIES_ID,
  ER_VANTARROW_SPECIES_ID,
} from "#data/elite-redux/er-fakemon-pitch-species";
import {
  ER_EGOELK_SPECIES_ID,
  ER_PARTNER_VAPOREON_SPECIES_ID,
  ER_TITANEON_SPECIES_ID,
} from "#data/elite-redux/er-newcomer-species";
import { SpeciesId } from "#enums/species-id";
import { UiMode } from "#enums/ui-mode";
import { GameManager } from "#test/framework/game-manager";
import { getPokemonSpecies } from "#utils/pokemon-utils";
import Phaser from "phaser";
import { beforeAll, describe, expect, it } from "vitest";

const RUN = process.env.ER_SCENARIO === "1";
const SCENARIO_LABELS = Array.from({ length: 10 }, (_, index) => `Roster: new Pokemon ${index + 1}/10`);
const PITCH_SPRITE_SLUGS = new Map(ER_FAKEMON_PITCH_SPECIES.map(({ id, slug }) => [id, slug]));

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

const expectedFormPokemon = (speciesId: number, formKey: string): ExpectedShowcasePokemon => ({
  speciesId,
  formIndex: -1,
  formKey,
});

const EXPECTED_SHOWCASES: Readonly<Record<string, ExpectedShowcase>> = {
  "Roster: new Pokemon 6/10": {
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
  "Roster: new Pokemon 7/10": {
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
  "Roster: new Pokemon 8/10": {
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
  "Roster: new Pokemon 9/10": {
    player: [
      expectedPokemon(ER_VANTARROW_SPECIES_ID),
      expectedPokemon(ER_CHROMIGHTY_SPECIES_ID),
      expectedPokemon(ER_TEMPORAL_SKULL_SPECIES_ID),
      expectedPokemon(ER_QUAKERSBY_SPECIES_ID),
      expectedPokemon(ER_GUZZLORD_M_SPECIES_ID),
      expectedFormPokemon(SpeciesId.GOLURK, "mega-y"),
    ],
    enemy: expectedFormPokemon(SpeciesId.SKUNTANK, "mega"),
  },
  "Roster: new Pokemon 10/10": {
    player: [
      expectedFormPokemon(SpeciesId.SKUNTANK, "mega"),
      expectedFormPokemon(SpeciesId.DODRIO, "mega"),
      expectedFormPokemon(SpeciesId.PYUKUMUKU, "mega"),
      expectedFormPokemon(SpeciesId.ROWLET, "partner"),
      expectedFormPokemon(SpeciesId.ONIX, "partner"),
      expectedFormPokemon(SpeciesId.GIMMIGHOUL, "partner"),
    ],
    enemy: expectedFormPokemon(SpeciesId.GOLURK, "mega-y"),
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
  it("keeps all showcase labels unique and registered", () => {
    expect(SCENARIO_LABELS.slice(0, 8)).toEqual(
      Array.from({ length: 10 }, (_, index) => `Roster: new Pokemon ${index + 1}/10`),
    );
    expect(new Set(SCENARIO_LABELS).size).toBe(10);
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

      for (const pokemon of [...game.scene.getPlayerParty(), ...game.scene.getEnemyParty()]) {
        const slug = PITCH_SPRITE_SLUGS.get(pokemon.species.speciesId);
        if (slug === undefined) {
          continue;
        }
        const expectedPathPrefix = pokemon.formIndex === 0 ? `elite-redux/${slug}/` : "elite-redux/";
        const expectedFrontKeyPrefix = pokemon.formIndex === 0 ? `pkmn__er__${slug}` : "pkmn__er__";
        const expectedBackKeyPrefix = pokemon.formIndex === 0 ? `pkmn__back__er__${slug}` : "pkmn__back__er__";
        const expectedIconKeyPrefix = pokemon.formIndex === 0 ? `er_icon__${slug}` : "er_icon__";
        expect(pokemon.getBattleSpriteAtlasPath(false).startsWith(expectedPathPrefix)).toBe(true);
        expect(pokemon.getBattleSpriteAtlasPath(true).startsWith(expectedPathPrefix)).toBe(true);
        expect(pokemon.getBattleSpriteKey(false).startsWith(expectedFrontKeyPrefix)).toBe(true);
        expect(pokemon.getBattleSpriteKey(true).startsWith(expectedBackKeyPrefix)).toBe(true);
        expect(pokemon.getIconAtlasKey().startsWith(expectedIconKeyPrefix)).toBe(true);
      }

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
        const resolveExpected = (pokemon: ExpectedShowcasePokemon): ExpectedShowcasePokemon => ({
          ...pokemon,
          formIndex:
            pokemon.formIndex >= 0
              ? pokemon.formIndex
              : getPokemonSpecies(pokemon.speciesId as SpeciesId).forms.findIndex(
                  form => form.formKey === pokemon.formKey,
                ),
        });
        expect(game.scene.getPlayerParty().map(identity)).toEqual(expected.player.map(resolveExpected));
        expect(identity(game.scene.getEnemyParty()[0]!)).toEqual(resolveExpected(expected.enemy));
      }
    }, 180_000);
  }
});
