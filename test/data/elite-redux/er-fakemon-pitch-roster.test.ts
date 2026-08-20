/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { allAbilities } from "#data/ability";
import { ER_FAKEMON_PITCH_ABILITIES } from "#data/elite-redux/abilities/fakemon-pitch-abilities";
import { erBlackSpritePathFromBase } from "#data/elite-redux/er-black-sprite-manifest";
import {
  ER_FAKEMON_PITCH_SPECIES,
  ER_POWER_PLANT_SPECIES_ID,
} from "#data/elite-redux/er-fakemon-pitch-species";
import { pokemonFormChanges } from "#data/pokemon-forms";
import {
  SpeciesFormChangeItemTrigger,
  SpeciesFormChangeManualTrigger,
} from "#data/pokemon-forms/form-change-triggers";
import { FormChangeItem } from "#enums/form-change-item";
import { SpeciesId } from "#enums/species-id";
import "#test/framework/game-manager";
import { getPokemonSpecies } from "#utils/pokemon-utils";
import { describe, expect, it } from "vitest";

const MEGA_FORMS = [
  [SpeciesId.CRYOGONAL, "mega", FormChangeItem.CRYOGONALITE, "cryogonal_mega"],
  [SpeciesId.JIRACHI, "mega", FormChangeItem.JIRACHITE, "jirachi_mega"],
  [SpeciesId.LEDIAN, "mega", FormChangeItem.LEDIANITE, "ledian_mega"],
  [SpeciesId.RAMPARDOS, "mega", FormChangeItem.RAMPARDOSITE, "rampardos_mega"],
  [SpeciesId.REUNICLUS, "mega-x", FormChangeItem.REUNICLUSITE_X, "reuniclus_mega_x"],
  [SpeciesId.XATU, "mega", FormChangeItem.XATUNITE, "xatu_mega"],
  [SpeciesId.ZANGOOSE, "mega", FormChangeItem.ZANGOOSEITE, "zangoose_mega"],
] as const;

describe("Discord fakemon-pitch roster", () => {
  it("registers every custom species with its complete six-ability kit", () => {
    expect(ER_FAKEMON_PITCH_SPECIES).toHaveLength(18);
    for (const def of ER_FAKEMON_PITCH_SPECIES) {
      const species = getPokemonSpecies(def.id as SpeciesId);
      expect(species.speciesId).toBe(def.id);
      expect(species.name).toBe(def.name);
      for (const abilityId of [...def.actives, ...def.innates]) {
        expect(allAbilities[abilityId], `${def.name} ability ${abilityId}`).toBeDefined();
      }
    }
  });

  it("registers every Mega form and its item-trigger edge", () => {
    for (const [speciesId, formKey, item, slug] of MEGA_FORMS) {
      expect(getPokemonSpecies(speciesId).forms.some(form => form.formKey === formKey)).toBe(true);
      const edge = (pokemonFormChanges[speciesId] ?? []).find(change =>
        change.formKey === formKey && change.trigger.hasTriggerType(SpeciesFormChangeItemTrigger),
      );
      expect(edge, `${slug} form-change edge`).toBeDefined();
      expect((edge!.findTrigger(SpeciesFormChangeItemTrigger) as SpeciesFormChangeItemTrigger).item).toBe(item);
    }
  });

  it("registers Live Current as Power Plant's one-way manual battle form", () => {
    const speciesId = ER_POWER_PLANT_SPECIES_ID as SpeciesId;
    expect(getPokemonSpecies(speciesId).forms.some(form => form.formKey === "live-current")).toBe(true);
    expect((pokemonFormChanges[speciesId] ?? []).some(change =>
      change.formKey === "live-current" && change.trigger.hasTriggerType(SpeciesFormChangeManualTrigger),
    )).toBe(true);
  });

  it("has generated front and back T4 paths for every published sprite slug", () => {
    const slugs = [
      ...ER_FAKEMON_PITCH_SPECIES.map(def => def.slug),
      ...MEGA_FORMS.map(([, , , slug]) => slug),
      "power_plant_live_current",
    ];
    expect(new Set(slugs).size).toBe(26);
    for (const slug of slugs) {
      expect(erBlackSpritePathFromBase(`elite-redux/${slug}/front`)).toBe(`black/elite-redux/${slug}/front`);
      expect(erBlackSpritePathFromBase(`elite-redux/${slug}/back`)).toBe(`black/elite-redux/${slug}/back`);
    }
  });

  it("registers every pitch-specific ability definition", () => {
    expect(ER_FAKEMON_PITCH_ABILITIES).toHaveLength(48);
    for (const ability of ER_FAKEMON_PITCH_ABILITIES) {
      expect(allAbilities[ability.pokerogueId]?.name).toBe(ability.draft.name);
    }
  });
});
