/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { buildScenarioSpeciesOptions, openScenarioBuilder } from "#app/dev-tools/test-suite/builder";
import { decodeScenarioSpec } from "#app/dev-tools/test-suite/scenario-spec";
import { ER_NEWCOMER_FORMS } from "#data/elite-redux/er-newcomer-forms";
import {
  ER_DRAWCLOPS_SPECIES_ID,
  ER_DUSTNOIR_SPECIES_ID,
  ER_EGOELK_SPECIES_ID,
  ER_FORBIDDRON_SPECIES_ID,
  ER_IDOLFIN_SPECIES_ID,
  ER_NIMBEON_SPECIES_ID,
  ER_RYUVEON_SPECIES_ID,
  ER_TITANEON_SPECIES_ID,
  ER_TWINKLETUFF_SPECIES_ID,
  ER_WEBBED_BRUISER_SPECIES_ID,
} from "#data/elite-redux/er-newcomer-species";
import type { SpeciesId } from "#enums/species-id";
import { GameManager } from "#test/framework/game-manager";
import { getPokemonSpecies } from "#utils/pokemon-utils";
import Phaser from "phaser";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const RUN = process.env.ER_SCENARIO === "1";

const NEWCOMER_SPECIES = [
  ER_DRAWCLOPS_SPECIES_ID,
  ER_DUSTNOIR_SPECIES_ID,
  ER_NIMBEON_SPECIES_ID,
  ER_RYUVEON_SPECIES_ID,
  ER_TITANEON_SPECIES_ID,
  ER_TWINKLETUFF_SPECIES_ID,
  ER_EGOELK_SPECIES_ID,
  ER_FORBIDDRON_SPECIES_ID,
  ER_IDOLFIN_SPECIES_ID,
  ER_WEBBED_BRUISER_SPECIES_ID,
] as const;

describe.skipIf(!RUN)("scenario builder newcomer catalog", () => {
  let phaserGame: Phaser.Game;

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });

  beforeEach(() => {
    new GameManager(phaserGame);
    document.getElementById("er-dev-scenario-builder")?.remove();
    document.getElementById("er-builder-species")?.remove();
    document.getElementById("er-builder-moves")?.remove();
    document.getElementById("er-builder-items")?.remove();
  });

  afterEach(() => {
    document.getElementById("er-dev-scenario-builder")?.remove();
  });

  it("lists every new standalone species and every injected newcomer form", () => {
    const options = buildScenarioSpeciesOptions();
    const keyed = new Map(options.map(option => [`${option.species}:${option.formIndex}`, option]));

    for (const speciesId of NEWCOMER_SPECIES) {
      const species = getPokemonSpecies(speciesId as SpeciesId);
      expect(keyed.get(`${speciesId}:0`)?.label, `${species.name} base option`).toBe(species.name);
    }

    for (const definition of ER_NEWCOMER_FORMS) {
      const species = getPokemonSpecies(definition.baseSpecies);
      const formIndex = species.forms.findIndex(form => form.formKey === definition.formKey);
      expect(formIndex, `${species.name} ${definition.formKey} injected`).toBeGreaterThanOrEqual(0);
      const option = keyed.get(`${definition.baseSpecies}:${formIndex}`);
      expect(option, `${species.name} ${definition.formKey} picker option`).toBeDefined();
      expect(option?.label).toContain(species.name);
      expect(option?.label).toContain(species.forms[formIndex].formName);
    }
  });

  it("renders form options in the datalist and fills the selected form index", () => {
    const yveltal = ER_NEWCOMER_FORMS.find(definition => definition.slug === "yveltal_mega_z");
    expect(yveltal).toBeDefined();
    const species = getPokemonSpecies(yveltal!.baseSpecies);
    const formIndex = species.forms.findIndex(form => form.formKey === yveltal!.formKey);
    const option = buildScenarioSpeciesOptions().find(
      entry => entry.species === yveltal!.baseSpecies && entry.formIndex === formIndex,
    );
    expect(option).toBeDefined();

    const setShareCode = vi.fn();
    openScenarioBuilder({ launch: vi.fn(() => false), setShareCode, closeMenu: vi.fn() });

    const labels = Array.from(document.querySelectorAll<HTMLOptionElement>("#er-builder-species option")).map(
      entry => entry.value,
    );
    expect(labels).toContain(option!.label);

    const speciesInput = document.querySelector<HTMLInputElement>('input[list="er-builder-species"]');
    expect(speciesInput).not.toBeNull();
    const formInput = speciesInput!.nextElementSibling as HTMLInputElement;
    speciesInput!.value = option!.label;
    speciesInput!.dispatchEvent(new Event("change"));
    expect(formInput.value).toBe(String(formIndex));

    const launch = Array.from(document.querySelectorAll("button")).find(button =>
      button.textContent?.includes("Launch"),
    );
    expect(launch).toBeDefined();
    launch!.click();
    expect(setShareCode).toHaveBeenCalledOnce();
    const spec = decodeScenarioSpec(setShareCode.mock.calls[0][0]);
    expect("error" in spec).toBe(false);
    if (!("error" in spec)) {
      expect(spec.party[0].species).toBe(yveltal!.baseSpecies);
      expect(spec.party[0].formIndex).toBe(formIndex);
    }
  });
});
