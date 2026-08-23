/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { speciesEggMoves } from "#balance/moves/egg-moves";
import { pokemonEvolutions } from "#balance/pokemon-evolutions";
import { pokemonSpeciesLevelMoves } from "#balance/pokemon-level-moves";
import { speciesEggTiers } from "#balance/species-egg-tiers";
import { speciesStarterCosts } from "#balance/starters";
import { tmSpecies } from "#balance/tm-species-map";
import { speciesTmMoves } from "#balance/tms";
import { allAbilities } from "#data/data-lists";
import { ER_FAKEMON_PITCH_ABILITIES } from "#data/elite-redux/abilities/fakemon-pitch-abilities";
import { erBlackSpritePathFromBase } from "#data/elite-redux/er-black-sprite-manifest";
import {
  ER_FAKEMON_PITCH_EDITOR_SPECIES,
  ER_FAKEMON_PITCH_SPECIES,
  ER_POWER_PLANT_SPECIES_ID,
} from "#data/elite-redux/er-fakemon-pitch-species";
import { getEliteReduxCustomIconLoads } from "#data/elite-redux/er-ios-icon-preload";
import { pokemonFormChanges } from "#data/pokemon-forms";
import { SpeciesFormChangeItemTrigger, SpeciesFormChangeManualTrigger } from "#data/pokemon-forms/form-change-triggers";
import { AbilityId } from "#enums/ability-id";
import { FormChangeItem } from "#enums/form-change-item";
import { PokemonType } from "#enums/pokemon-type";
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
  [SpeciesId.GOLURK, "mega-y", FormChangeItem.GOLURKITE_Y, "golurk_mega_y"],
  [SpeciesId.SKUNTANK, "mega", FormChangeItem.SKUNTANKITE, "skuntank_mega"],
  [SpeciesId.DODRIO, "mega", FormChangeItem.DODRIONITE, "dodrio_mega"],
  [SpeciesId.PYUKUMUKU, "mega", FormChangeItem.PYUKUMUKUNITE, "pyukumuku_mega"],
] as const;

const STANDALONE_CONTRACT = [
  {
    id: 70051,
    name: "Mishamanus",
    slug: "mishamanus",
    editorConst: "SPECIES_MISHAMANUS",
    category: "Astromancer Pokémon",
    types: [PokemonType.GHOST, PokemonType.FAIRY],
    stats: [75, 60, 60, 120, 120, 120],
    actives: [5325, 5224, 6052],
    innates: [AbilityId.LEVITATE, AbilityId.SHADOW_TAG, 6053],
    weight: 4.4,
    evolvesFrom: SpeciesId.MISMAGIUS,
    evolveLevel: 55,
    learnsetSource: SpeciesId.MISMAGIUS,
  },
  {
    id: 70052,
    name: "Falinks Convergent",
    slug: "falinks_convergent",
    editorConst: "SPECIES_FALINKS_CONVERGENT",
    types: [PokemonType.PSYCHIC, PokemonType.FIGHTING],
    stats: [65, 70, 60, 100, 100, 75],
    actives: [5158, 5620, AbilityId.FRIEND_GUARD],
    innates: [5452, 5190, 5085],
    weight: 62,
    learnsetSource: SpeciesId.FALINKS,
    eggTier: 1,
    starterCost: 4,
    eggMoveSource: SpeciesId.FALINKS,
  },
  {
    id: 70053,
    name: "Iron Stream",
    slug: "iron_stream",
    editorConst: "SPECIES_IRON_STREAM",
    types: [PokemonType.WATER, PokemonType.PSYCHIC],
    stats: [86, 66, 90, 124, 96, 128],
    actives: [6079, 5159, 5224],
    innates: [AbilityId.QUARK_DRIVE, 6064, 6065],
    weight: 125,
    learnsetSource: SpeciesId.IRON_LEAVES,
    eggTier: 2,
    starterCost: 6,
    eggMoveSource: SpeciesId.IRON_LEAVES,
  },
  {
    id: 70054,
    name: "Slabberigus",
    slug: "slabberigus",
    editorConst: "SPECIES_SLABBERIGUS",
    types: [PokemonType.ROCK, PokemonType.GHOST],
    stats: [88, 65, 105, 50, 145, 30],
    actives: [5306, AbilityId.SHADOW_SHIELD, 5024],
    innates: [6066, 6067, 5697],
    weight: 76.5,
    eggTier: 1,
    starterCost: 4,
    learnsetSource: SpeciesId.COFAGRIGUS,
  },
  {
    id: 70055,
    name: "Tagela",
    slug: "tagela",
    editorConst: "SPECIES_TAGELA",
    types: [PokemonType.GHOST, PokemonType.PSYCHIC],
    stats: [65, 55, 115, 100, 40, 60],
    actives: [34, 4, 102],
    innates: [144, 5080, 221],
    weight: 35,
    learnsetSource: SpeciesId.TANGELA,
    eggTier: 0,
    starterCost: 3,
    eggMoveSource: SpeciesId.TANGELA,
  },
  {
    id: 70056,
    name: "Intangrowth",
    slug: "intangrowth",
    editorConst: "SPECIES_INTANGROWTH",
    types: [PokemonType.GHOST, PokemonType.PSYCHIC],
    stats: [100, 100, 50, 110, 125, 50],
    actives: [6068, 5070, 5367],
    innates: [5283, 6069, 6070],
    weight: 128.6,
    evolvesFrom: 70055,
    learnsetSource: SpeciesId.TANGROWTH,
  },
  {
    id: 70057,
    name: "Lilligant Verdant",
    slug: "lilligant_verdant",
    editorConst: "SPECIES_LILLIGANT_VERDANT",
    types: [PokemonType.WATER, PokemonType.FAIRY, PokemonType.GHOST],
    stats: [90, 50, 80, 110, 90, 80],
    actives: [6071, 5298, 5281],
    innates: [5596, 5233, AbilityId.QUEENLY_MAJESTY],
    weight: 16.3,
    evolvesFrom: SpeciesId.PETILIL,
    evolveLevel: 20,
    learnsetSource: SpeciesId.LILLIGANT,
  },
] as const;
describe("Discord fakemon-pitch roster", () => {
  it("registers every custom species with its complete six-ability kit", () => {
    expect(ER_FAKEMON_PITCH_SPECIES).toHaveLength(30);
    for (const def of ER_FAKEMON_PITCH_SPECIES) {
      const species = getPokemonSpecies(def.id as SpeciesId);

      expect(species.speciesId).toBe(def.id);
      expect(species.name).toBe(def.name);
      for (const abilityId of [...def.actives, ...def.innates]) {
        expect(allAbilities[abilityId], `${def.name} ability ${abilityId}`).toBeDefined();
      }
    }
  });

  it("matches the seven 70051-70057 standalone contract records", () => {
    for (const expected of STANDALONE_CONTRACT) {
      const actual = ER_FAKEMON_PITCH_SPECIES.find(def => def.id === expected.id);
      expect(actual, `missing ${expected.id}`).toBeDefined();
      expect(actual).toMatchObject(expected);
      expect(actual?.types).toEqual(expected.types);
      expect(actual?.stats).toEqual(expected.stats);
      expect(actual?.actives).toEqual(expected.actives);
      expect(actual?.innates).toEqual(expected.innates);
    }

    expect(ER_FAKEMON_PITCH_EDITOR_SPECIES).toMatchObject(
      Object.fromEntries(STANDALONE_CONTRACT.map(({ editorConst, id, slug }) => [editorConst, { id, slug }])),
    );
  });

  it("preserves Mishamanus's source category in the live species registration", () => {
    expect(getPokemonSpecies(70051 as SpeciesId).category).toBe("Astromancer Pokémon");
  });

  it("adds pitch evolution branches without replacing vanilla edges", () => {
    const edges = (sourceId: number) =>
      ((pokemonEvolutions as Record<number, readonly { speciesId: number; level: number }[]>)[sourceId] ?? []).map(
        edge => [edge.speciesId, edge.level],
      );

    expect(edges(SpeciesId.STANTLER)).toEqual(
      expect.arrayContaining([
        [SpeciesId.WYRDEER, 31],
        [70026, 31],
      ]),
    );
    expect(edges(SpeciesId.PETILIL)).toEqual(
      expect.arrayContaining([
        [SpeciesId.HISUI_LILLIGANT, 23],
        [SpeciesId.LILLIGANT, 23],
        [70057, 20],
      ]),
    );
    expect(edges(SpeciesId.MISMAGIUS)).toEqual(expect.arrayContaining([[70051, 55]]));
    expect(edges(70055)).toEqual([[70056, 26]]);
  });

  it("makes standalone convergents obtainable with source egg tiers and costs", () => {
    expect(speciesEggTiers[70052]).toBe(speciesEggTiers[SpeciesId.FALINKS]);
    expect(speciesStarterCosts[70052]).toBe(speciesStarterCosts[SpeciesId.FALINKS]);

    expect(speciesEggTiers[70053]).toBe(speciesEggTiers[SpeciesId.IRON_LEAVES]);
    expect(speciesStarterCosts[70053]).toBe(speciesStarterCosts[SpeciesId.IRON_LEAVES]);
    expect(speciesEggTiers[70054]).toBe(1);
    expect(speciesStarterCosts[70054]).toBe(5);
    expect(speciesEggTiers[70055]).toBe(speciesEggTiers[SpeciesId.TANGELA]);
    expect(speciesStarterCosts[70055]).toBe(4);
  });

  it("applies standalone learnsets, egg moves, and bidirectional TM wiring", () => {
    const standalone = ER_FAKEMON_PITCH_SPECIES.filter(def => def.id >= 70051 && def.id <= 70057);
    expect(standalone).toHaveLength(7);

    const levelMoves = pokemonSpeciesLevelMoves as Record<number, [number, number][]>;
    const eggMoves = speciesEggMoves as Record<number, number[]>;
    const tmMoves = speciesTmMoves as Record<number, (number | [unknown, number])[]>;
    const reverseTmMoves = tmSpecies as Record<number, (number | readonly unknown[])[]>;

    for (const def of standalone) {
      const expectedLevelMoves = [...(levelMoves[def.learnsetSource] ?? [])].map(
        ([level, move]) => [level, move] as [number, number],
      );
      for (const [level, move] of def.learnsetAdditions ?? []) {
        if (!expectedLevelMoves.some(([, existingMove]) => existingMove === move)) {
          expectedLevelMoves.push([level, move]);
        }
      }
      expectedLevelMoves.sort((a, b) => a[0] - b[0]);
      expect(levelMoves[def.id]).toEqual(expectedLevelMoves);

      if (def.eggMoveSource !== undefined) {
        expect(eggMoves[def.id]).toEqual(eggMoves[def.eggMoveSource]);
      }

      const expectedTmMoves = [
        ...new Set([
          ...(tmMoves[def.learnsetSource] ?? []).map(entry => (Array.isArray(entry) ? entry[1] : entry)),
          ...(def.learnsetAdditions ?? []).map(([, move]) => move),
        ]),
      ];
      expect(tmMoves[def.id]).toEqual(expectedTmMoves);
      for (const move of expectedTmMoves) {
        expect((reverseTmMoves[move] ?? []).some(entry => !Array.isArray(entry) && Number(entry) === def.id)).toBe(
          true,
        );
      }
    }
  });

  it("preloads every pitch species icon atlas exactly once", () => {
    const pitchSlugs = ER_FAKEMON_PITCH_SPECIES.map(def => def.slug);
    const pitchLoads = getEliteReduxCustomIconLoads().filter(load => pitchSlugs.includes(load.slug));

    expect(pitchLoads).toHaveLength(pitchSlugs.length);
    expect(new Set(pitchLoads.map(load => load.slug))).toEqual(new Set(pitchSlugs));
    for (const slug of pitchSlugs) {
      const matchingLoads = pitchLoads.filter(load => load.slug === slug);
      expect(matchingLoads).toEqual([{ key: `er_icon__${slug}`, slug, file: "icon" }]);
    }
  });

  it("registers every Mega form and its item-trigger edge", () => {
    for (const [speciesId, formKey, item, slug] of MEGA_FORMS) {
      expect(getPokemonSpecies(speciesId).forms.some(form => form.formKey === formKey)).toBe(true);
      const edge = (pokemonFormChanges[speciesId] ?? []).find(
        change => change.formKey === formKey && change.trigger.hasTriggerType(SpeciesFormChangeItemTrigger),
      );
      expect(edge, `${slug} form-change edge`).toBeDefined();
      expect((edge!.findTrigger(SpeciesFormChangeItemTrigger) as SpeciesFormChangeItemTrigger).item).toBe(item);
    }
  });

  it("registers Live Current as Power Plant's one-way manual battle form", () => {
    const speciesId = ER_POWER_PLANT_SPECIES_ID as SpeciesId;
    expect(getPokemonSpecies(speciesId).forms.some(form => form.formKey === "live-current")).toBe(true);
    expect(
      (pokemonFormChanges[speciesId] ?? []).some(
        change => change.formKey === "live-current" && change.trigger.hasTriggerType(SpeciesFormChangeManualTrigger),
      ),
    ).toBe(true);
  });

  it("has generated front and back T4 paths for every published sprite slug", () => {
    const slugs = [
      ...ER_FAKEMON_PITCH_SPECIES.map(def => def.slug),
      ...MEGA_FORMS.map(([, , , slug]) => slug),
      "power_plant_live_current",
    ];
    expect(new Set(slugs).size).toBe(42);
    for (const slug of slugs) {
      expect(erBlackSpritePathFromBase(`elite-redux/${slug}/front`)).toBe(`black/elite-redux/${slug}/front`);
      expect(erBlackSpritePathFromBase(`elite-redux/${slug}/back`)).toBe(`black/elite-redux/${slug}/back`);
    }
  });

  it("registers every pitch-specific ability definition", () => {
    for (const ability of ER_FAKEMON_PITCH_ABILITIES) {
      expect(allAbilities[ability.pokerogueId]?.name).toBe(ability.draft.name);
    }
  });
});
