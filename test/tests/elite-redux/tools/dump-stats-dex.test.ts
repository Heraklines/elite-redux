/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { speciesEggMoves } from "#balance/moves/egg-moves";
// Canonical stats-site catalog export. This deliberately reads the initialized
// runtime rather than editor snapshots so every balance patch, injected species,
// injected form, move, ability, innate, extra type, learnset, TM and egg move is
// reflected on the next scheduled stats refresh.
import { pokemonEvolutions, pokemonPrevolutions } from "#balance/pokemon-evolutions";
import { speciesEggTiers } from "#balance/species-egg-tiers";
import { speciesStarterCosts } from "#balance/starters";
import { speciesTmMoves } from "#balance/tms";
import { allAbilities, allMoves, allSpecies } from "#data/data-lists";
import { ER_ID_MAP } from "#data/elite-redux/er-id-map";
import { ER_NEWCOMER_FORMS } from "#data/elite-redux/er-newcomer-forms";
import {
  ER_NEWCOMER_EVO_SPECIES,
  ER_REGITUBE_SPECIES_ID,
  ER_WEBBED_BRUISER_SPECIES_ID,
} from "#data/elite-redux/er-newcomer-species";
import { ER_SPECIES } from "#data/elite-redux/er-species";
import { ER_SPRITE_MANIFEST } from "#data/elite-redux/er-sprite-manifest";
import type { PokemonSpecies, PokemonSpeciesForm } from "#data/pokemon-species";
import { Challenges } from "#enums/challenges";
import type { EggTier } from "#enums/egg-type";
import { MoveCategory } from "#enums/move-category";
import { PokemonType } from "#enums/pokemon-type";
import { SpeciesId } from "#enums/species-id";
import { writeFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const VANILLA_ID_CUTOFF = 10000;

const slugify = (value: string): string =>
  value
    .normalize("NFKD")
    .replace(/[^\p{ASCII}]/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");

const titleType = (type: PokemonType | null): string | null => {
  if (type === null || type === undefined || type < 0) {
    return null;
  }
  const raw = PokemonType[type];
  return typeof raw === "string" ? raw.charAt(0) + raw.slice(1).toLowerCase() : null;
};

const fullTypes = (form: PokemonSpeciesForm): string[] =>
  [form.type1, form.type2, ...form.getExtraTypes()]
    .map(type => titleType(type))
    .filter((type): type is string => type !== null);

const runtimeForm = (species: PokemonSpecies, formIndex = 0): PokemonSpeciesForm =>
  species.forms.length > 0 ? (species.forms[formIndex] ?? species.forms[0]) : species;

const abilitySlots = (form: PokemonSpeciesForm): { slot: string; id: number }[] => {
  const out: { slot: string; id: number }[] = [];
  const seen = new Set<number>();
  const add = (slot: string, id: number) => {
    if (id > 0 && allAbilities[id]?.name && !allAbilities[id].name.startsWith("???") && !seen.has(id)) {
      seen.add(id);
      out.push({ slot, id });
    }
  };
  add("ability1", form.ability1);
  add("ability2", form.ability2);
  add("hidden", form.abilityHidden);
  for (const id of form.getPassiveAbilities(form.formIndex)) {
    add("innate", id);
  }
  return out;
};

const tmMovesFor = (speciesId: number, formKey = ""): number[] => {
  const result = new Set<number>();
  for (const entry of speciesTmMoves[speciesId] ?? []) {
    if (typeof entry === "number") {
      result.add(entry);
    } else if (String(entry[0]) === formKey) {
      result.add(entry[1]);
    }
  }
  return [...result].sort((a, b) => a - b);
};

describe("tools - dump complete runtime stats catalog", () => {
  it("writes every stats catalog payload from initialized runtime tables", () => {
    const costs = speciesStarterCosts as Record<number, number>;
    const tiers = speciesEggTiers as Record<number, EggTier>;
    const constById = new Map<number, string>();
    for (const [name, value] of Object.entries(SpeciesId)) {
      if (typeof value === "number") {
        constById.set(value, `SPECIES_${name}`);
      }
    }
    for (const draft of ER_SPECIES) {
      const id = ER_ID_MAP.species[draft.id];
      if (id !== undefined) {
        constById.set(id, draft.speciesConst);
      }
    }

    const spriteSlugByConst = new Map<string, string>();
    for (const entry of ER_SPRITE_MANIFEST) {
      if (!spriteSlugByConst.has(entry.speciesConst)) {
        spriteSlugByConst.set(entry.speciesConst, entry.slug);
      }
    }
    const newcomerSlugById = new Map<number, string>(ER_NEWCOMER_EVO_SPECIES.map(def => [def.speciesId, def.slug]));
    newcomerSlugById.set(ER_REGITUBE_SPECIES_ID, "regitube");
    newcomerSlugById.set(ER_WEBBED_BRUISER_SPECIES_ID, "webbed_bruiser");
    const newcomerFormSlug = new Map(ER_NEWCOMER_FORMS.map(def => [`${def.baseSpecies}:${def.formKey}`, def.slug]));

    const vanillaNameToId = new Map<string, number>();
    for (const species of allSpecies) {
      if (species.speciesId < VANILLA_ID_CUTOFF) {
        vanillaNameToId.set(species.name.toLowerCase(), species.speciesId);
      }
    }
    const vanillaDex = (id: number): number => (id >= 2000 ? id % 1000 : id);
    const formQualifier = /\s+(redux mega|redux b|redux c|redux|primal|mega|hisuian|alolan|galarian|paldean)$/i;
    const resolveDex = (id: number, name: string): number | null => {
      if (id < VANILLA_ID_CUTOFF) {
        return vanillaDex(id);
      }
      const stripped = name.replace(formQualifier, "").trim().toLowerCase();
      const exact = vanillaNameToId.get(stripped);
      if (exact !== undefined) {
        return vanillaDex(exact);
      }
      const words = stripped.split(/\s+/);
      for (let length = words.length; length >= 1; length--) {
        const found = vanillaNameToId.get(words.slice(0, length).join(" "));
        if (found !== undefined) {
          return vanillaDex(found);
        }
      }
      const tail = stripped.split(/[\s-]+/).pop();
      const found = tail ? vanillaNameToId.get(tail) : undefined;
      return found === undefined ? null : vanillaDex(found);
    };

    const usedSlugs = new Map<string, string>();
    const uniqueSlug = (preferred: string, identity: string): string => {
      const clean = slugify(preferred) || `species_${identity.replace(":", "_")}`;
      const owner = usedSlugs.get(clean);
      if (owner === undefined || owner === identity) {
        usedSlugs.set(clean, identity);
        return clean;
      }
      const suffixed = `${clean}_${identity.replace(":", "_")}`;
      usedSlugs.set(suffixed, identity);
      return suffixed;
    };

    const baseSlugs = new Map<number, string>();
    const spriteSlugs = new Map<number, string | null>();
    for (const species of allSpecies) {
      const id = species.speciesId;
      const speciesConst = constById.get(id);
      const spriteSlug = (speciesConst && spriteSlugByConst.get(speciesConst)) ?? newcomerSlugById.get(id) ?? null;
      const enumName = SpeciesId[id];
      const preferred = spriteSlug ?? (typeof enumName === "string" ? enumName : species.name);
      baseSlugs.set(id, uniqueSlug(preferred, String(id)));
      spriteSlugs.set(id, spriteSlug);
    }

    const detailSpecies: Record<string, unknown> = {};
    const names: Record<string, unknown> = {};
    const extraSpecies: Record<string, unknown> = {};
    let formCount = 0;

    for (const species of allSpecies) {
      const id = species.speciesId;
      const baseSlug = baseSlugs.get(id)!;
      const baseSpriteSlug = spriteSlugs.get(id) ?? null;
      const rootId = Number(runtimeForm(species).getRootSpeciesId(true));
      const dex = resolveDex(id, species.name);
      const forms = species.forms.length > 0 ? species.forms : [species];
      const formRows = forms.map((form, formIndex) => {
        const formKey = "formKey" in form ? String(form.formKey) : "";
        const explicitSlug = newcomerFormSlug.get(`${id}:${formKey}`);
        const routeSlug =
          formIndex === 0
            ? baseSlug
            : uniqueSlug(explicitSlug ?? `${baseSlug}_${formKey || formIndex}`, `${id}:${formIndex}`);
        const displayName =
          formIndex === 0 || !formKey
            ? species.name
            : species.getFormNameToDisplay(formIndex, true)
              || `${species.name} ${"formName" in form ? form.formName : formKey}`;
        const spriteSlug = explicitSlug ?? (formIndex === 0 ? baseSpriteSlug : null);
        const baseStats = [...form.baseStats];
        const levelup = form.getLevelMoves().map(([level, move]) => [level, Number(move)]);
        const tm = tmMovesFor(id, formKey);
        const egg = [...(speciesEggMoves[id] ?? speciesEggMoves[rootId] ?? [])].map(Number);
        formCount++;
        return {
          speciesId: id,
          rootId,
          formIndex,
          formKey,
          name: displayName,
          slug: routeSlug,
          spriteSlug,
          isStarterSelectable: form.isStarterSelectable,
          types: fullTypes(form),
          baseStats,
          bst: baseStats.reduce((sum, value) => sum + value, 0),
          activeAbilityIds: [form.ability1, form.ability2, form.abilityHidden].map(Number),
          innateAbilityIds: [...form.getPassiveAbilities(form.formIndex)].map(Number).filter(ability => ability > 0),
          abilities: abilitySlots(form),
          levelup,
          tm,
          egg,
        };
      });
      const base = formRows[0];
      const evoTo = [...new Set((pokemonEvolutions[id] ?? []).map(evolution => Number(evolution.speciesId)))];
      const evoFrom = Object.hasOwn(pokemonPrevolutions, id) ? [Number(pokemonPrevolutions[id])] : [];
      detailSpecies[id] = {
        rootId,
        abilities: base.abilities,
        levelup: base.levelup,
        tm: base.tm,
        egg: base.egg,
        evoFrom,
        evoTo,
        forms: formRows,
      };
      names[id] = { name: species.name, slug: baseSlug, spriteSlug: baseSpriteSlug, dex, rootId };
      extraSpecies[id] = {
        id,
        rootId,
        slug: baseSlug,
        spriteSlug: baseSpriteSlug,
        name: species.name,
        dex,
        types: base.types,
        baseStats: base.baseStats,
        bst: base.bst,
        activeAbilityIds: base.activeAbilityIds,
        innateAbilityIds: base.innateAbilityIds,
        forms: formRows,
      };
    }

    const moves: Record<string, unknown> = {};
    for (const move of allMoves) {
      if (!move || move.id <= 0 || !move.name || move.name.startsWith("???")) {
        continue;
      }
      moves[move.id] = {
        name: move.name,
        description: move.effect ?? "",
        type: PokemonType[move.type] ?? "UNKNOWN",
        category: MoveCategory[move.category] ?? "UNKNOWN",
        power: move.power,
        accuracy: move.accuracy,
        pp: move.pp,
        priority: move.priority,
        chance: move.chance,
      };
    }
    const abilities: Record<string, unknown> = {};
    for (const ability of allAbilities) {
      if (!ability || ability.id <= 0 || !ability.name || ability.name.startsWith("???")) {
        continue;
      }
      abilities[ability.id] = {
        name: ability.name,
        desc: ability.description ?? "",
        suppressable: ability.suppressable,
        copiable: ability.copiable,
        replaceable: ability.replaceable,
        ignorable: ability.ignorable,
      };
    }
    const challengeNames: Record<string, string> = {};
    for (const [name, value] of Object.entries(Challenges)) {
      if (typeof value === "number") {
        challengeNames[value] = name
          .toLowerCase()
          .replace(/_/g, " ")
          .replace(/\b\w/g, letter => letter.toUpperCase());
      }
    }

    const dex = Object.keys(costs)
      .map(Number)
      .map(id => {
        const species = allSpecies.find(candidate => candidate.speciesId === id);
        if (!species) {
          return null;
        }
        const base = (extraSpecies[id] as { forms: Record<string, unknown>[] }).forms[0];
        const lineRows = Object.values(extraSpecies)
          .filter(row => (row as { rootId: number }).rootId === id)
          .flatMap(row => (row as { forms: Record<string, unknown>[] }).forms);
        const abilityNames = new Set<string>();
        for (const row of lineRows) {
          for (const slot of row.abilities as { id: number }[]) {
            const ability = abilities[slot.id] as { name?: string } | undefined;
            if (ability?.name) {
              abilityNames.add(ability.name);
            }
          }
        }
        return {
          slug: base.slug,
          spriteSlug: base.spriteSlug,
          name: species.name,
          id,
          rootId: Number(base.rootId),
          formIndex: 0,
          dex: resolveDex(id, species.name),
          types: base.types,
          baseStats: base.baseStats,
          bst: base.bst,
          abilities: [...abilityNames],
          formNames: lineRows
            .filter(row => Number(row.speciesId) !== id || Number(row.formIndex) !== 0)
            .map(row => row.name),
          formSlugs: lineRows
            .filter(row => Number(row.speciesId) !== id || Number(row.formIndex) !== 0)
            .map(row => row.slug),
          eggTier: Object.hasOwn(tiers, id) ? tiers[id] : null,
          cost: costs[id],
        };
      })
      .filter((entry): entry is NonNullable<typeof entry> => entry !== null)
      .sort((a, b) => a.name.localeCompare(b.name));

    const generatedAt = new Date().toISOString();
    const sourceSha = process.env.STATS_SOURCE_SHA || "local";
    const detailPayload = {
      _source: "initialized game runtime",
      generatedAt,
      sourceSha,
      counts: {
        species: Object.keys(detailSpecies).length,
        forms: formCount,
        moves: Object.keys(moves).length,
        abilities: Object.keys(abilities).length,
      },
      challengeNames,
      moves,
      abilities,
      names,
      species: detailSpecies,
    };
    const extraPayload = {
      _source: "initialized game runtime",
      generatedAt,
      sourceSha,
      count: Object.keys(extraSpecies).length,
      formCount,
      species: extraSpecies,
    };

    writeFileSync("stats/data/dex.json", `${JSON.stringify(dex, null, 2)}\n`, "utf8");
    writeFileSync("stats/data/dex-detail.json", `${JSON.stringify(detailPayload)}\n`, "utf8");
    writeFileSync("stats/data/species-extra.json", `${JSON.stringify(extraPayload)}\n`, "utf8");

    expect(dex.length).toBe(
      Object.keys(costs).filter(id => allSpecies.some(species => species.speciesId === Number(id))).length,
    );
    expect(Object.keys(detailSpecies).length).toBe(allSpecies.length);
    expect(Object.keys(moves).length).toBe(
      allMoves.filter(move => move?.id > 0 && move.name && !move.name.startsWith("???")).length,
    );
    expect(Object.keys(abilities).length).toBe(
      allAbilities.filter(ability => ability?.id > 0 && ability.name && !ability.name.startsWith("???")).length,
    );
    for (const def of ER_NEWCOMER_EVO_SPECIES) {
      expect(extraSpecies[def.speciesId], `missing newcomer species ${def.slug}`).toBeDefined();
    }
    for (const def of ER_NEWCOMER_FORMS) {
      const row = extraSpecies[def.baseSpecies] as
        | { forms: { formKey: string; slug: string; spriteSlug: string | null }[] }
        | undefined;
      expect(
        row?.forms.some(form => form.slug === def.slug || form.spriteSlug === def.slug),
        `missing form ${def.slug}`,
      ).toBe(true);
    }
    expect(Object.values(abilities).some(ability => (ability as { name: string }).name === "Glycolysis")).toBe(true);
    expect(Object.values(abilities).some(ability => (ability as { name: string }).name === "Gale Bloom")).toBe(true);
    expect(Object.values(abilities).some(ability => (ability as { name: string }).name === "Eclipse Wing")).toBe(true);
    expect(dex.some(entry => entry.formSlugs.includes("jumpluff_mega"))).toBe(true);
    expect(dex.some(entry => entry.formSlugs.includes("yveltal_mega_z"))).toBe(true);
    expect(Object.values(moves).every(move => typeof (move as { description: unknown }).description === "string")).toBe(
      true,
    );
  });
});
