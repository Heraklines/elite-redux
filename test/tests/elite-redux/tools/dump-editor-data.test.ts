/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// One-off generator (NOT a real test): dumps the static data files the team
// editor SPA (editor/) reads, FROM THE LIVE RUNTIME TABLES after the full
// initializeGame() chain — so the roster is exactly the starter-selectable
// set (vanilla starters + every ER custom the init passes register, minus
// everything they remove: evolved forms, battle-only forms, egg-pool bans).
// The old scripts/gen-editor-data.mjs regex approach built the species list
// from er-egg-moves.json keys, which silently dropped every starter without
// an egg-move entry. Run with:
//   ER_SCENARIO=1 npx vitest run test/tests/elite-redux/tools/dump-editor-data.test.ts
// Output:
//   editor/data/species.json  — [{const,name,slug,id,dex,eggTier,cost}] for
//                               every starter-selectable species
//   editor/data/items.json    — player reward pool entries (key/tier/weight)
//   editor/data/trainers.json — frequency-knob defaults + factory species list
import { speciesEggTiers } from "#balance/species-egg-tiers";
import { speciesStarterCosts } from "#balance/starters";
import { allAbilities, allSpecies } from "#data/data-lists";
import { ER_BALANCE_KNOBS } from "#data/elite-redux/er-balance-knobs";
import { ER_TRAINER_CADENCE } from "#data/elite-redux/er-battle-frequency";
import { ER_FACTORY_SETS } from "#data/elite-redux/er-factory-sets";
import { ER_FAKEMON_PITCH_EDITOR_SPECIES } from "#data/elite-redux/er-fakemon-pitch-species";
import { ER_ID_MAP } from "#data/elite-redux/er-id-map";
import { ER_MOVES } from "#data/elite-redux/er-moves";
import { ER_NEWCOMER_FORMS } from "#data/elite-redux/er-newcomer-forms";
import {
  ER_NEWCOMER_EVO_SPECIES,
  ER_NEWCOMER_PARTNER_FAMILY,
  ER_PARTNER_FAMILY,
  ER_REGITUBE_SPECIES_ID,
  ER_WEBBED_BRUISER_SPECIES_ID,
} from "#data/elite-redux/er-newcomer-species";
import { ER_SPECIES } from "#data/elite-redux/er-species";
import { ER_SPRITE_MANIFEST } from "#data/elite-redux/er-sprite-manifest";
import { ER_FACTORY_TEAM_CHANCE_PCT } from "#data/elite-redux/er-trainer-runtime-hook";
import type { EggTier } from "#enums/egg-type";
import { ModifierTier } from "#enums/modifier-tier";
import { MoveId } from "#enums/move-id";
import { SpeciesId } from "#enums/species-id";
import { modifierPool } from "#modifiers/modifier-pools";
import { getPokemonSpecies } from "#utils/pokemon-utils";
import { writeFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const VANILLA_ID_CUTOFF = 10000;

describe("tools — dump editor SPA data", () => {
  it("writes editor/data/{species,items,trainers}.json from the live tables", () => {
    // ---- species.json -------------------------------------------------------
    const costs = speciesStarterCosts as Record<number, number>;
    const tiers = speciesEggTiers as Record<number, EggTier>;

    // pokerogue id → speciesConst (vanilla via the enum, customs via the drafts).
    const constById = new Map<number, string>();
    for (const [name, value] of Object.entries(SpeciesId)) {
      if (typeof value === "number") {
        constById.set(value, `SPECIES_${name}`);
      }
    }
    for (const draft of ER_SPECIES) {
      const pkrgId = ER_ID_MAP.species[draft.id];
      if (pkrgId !== undefined && pkrgId >= VANILLA_ID_CUTOFF) {
        constById.set(pkrgId, draft.speciesConst);
      }
    }

    const constifyNewcomer = (name: string): string =>
      `SPECIES_${name
        .toUpperCase()
        .replace(/[^A-Z0-9]+/g, "_")
        .replace(/^_+|_+$/g, "")}`;
    const newcomerCatalog = [
      ...ER_NEWCOMER_EVO_SPECIES.map(def => ({ id: def.speciesId, name: def.name, slug: def.slug })),
      { id: ER_REGITUBE_SPECIES_ID, name: "Regitube", slug: "regitube" },
      { id: ER_WEBBED_BRUISER_SPECIES_ID, name: "Webbed Bruiser", slug: "webbed_bruiser" },
      ...ER_PARTNER_FAMILY.map(def => ({ id: def.partnerId, name: def.name, aliasId: def.base })),
      ...ER_NEWCOMER_PARTNER_FAMILY.map(def => ({
        id: def.partnerId,
        name: def.name,
        aliasId: def.baseSpeciesId,
      })),
    ];
    for (const entry of newcomerCatalog) {
      constById.set(entry.id, constifyNewcomer(entry.name));
    }
    const pitchCatalog = Object.entries(ER_FAKEMON_PITCH_EDITOR_SPECIES).map(([speciesConst, entry]) => ({
      speciesConst,
      id: entry.id,
      slug: entry.slug,
    }));
    for (const entry of pitchCatalog) {
      constById.set(entry.id, entry.speciesConst);
    }

    // speciesConst → sprite slug.
    const slugByConst = new Map<string, string>();
    for (const entry of ER_SPRITE_MANIFEST) {
      if (!slugByConst.has(entry.speciesConst)) {
        slugByConst.set(entry.speciesConst, entry.slug);
      }
    }
    for (const entry of newcomerCatalog) {
      const speciesConst = constById.get(entry.id);
      if (!speciesConst) {
        continue;
      }
      if ("slug" in entry && entry.slug) {
        slugByConst.set(speciesConst, entry.slug);
        continue;
      }
      if ("aliasId" in entry) {
        const aliasConst = constById.get(entry.aliasId);
        const aliasSlug = aliasConst ? slugByConst.get(aliasConst) : undefined;
        if (aliasSlug) {
          slugByConst.set(speciesConst, aliasSlug);
        }
      }
    }
    for (const entry of pitchCatalog) {
      slugByConst.set(entry.speciesConst, entry.slug);
    }

    // Vanilla display name → national dex number, for the customs' dex column
    // (longest leading word-prefix match, mirroring init-elite-redux-egg-tiers).
    const vanillaIdByName = new Map<string, number>();
    for (const sp of allSpecies) {
      if (sp.speciesId < VANILLA_ID_CUTOFF) {
        vanillaIdByName.set(sp.name.toLowerCase(), sp.speciesId);
      }
    }
    const formQualifier = /\s+(redux mega|redux b|redux c|redux|primal|mega|hisuian|alolan|galarian|paldean)$/i;
    // Vanilla regional-form ids encode the dex as id % 1000 (Alolan 2xxx,
    // Galarian 4xxx, Hisuian 6xxx, Paldean 8xxx); plain ids ARE the dex.
    const vanillaDex = (id: number): number => (id >= 2000 ? id % 1000 : id);
    const resolveDex = (id: number, name: string): number | null => {
      if (id < VANILLA_ID_CUTOFF) {
        return vanillaDex(id);
      }
      const stripped = name.replace(formQualifier, "").trim().toLowerCase();
      const exact = vanillaIdByName.get(stripped);
      if (exact !== undefined) {
        return vanillaDex(exact);
      }
      const words = stripped.split(/\s+/);
      for (let n = words.length; n >= 1; n--) {
        const prefix = words.slice(0, n).join(" ");
        const found = vanillaIdByName.get(prefix);
        if (found !== undefined) {
          return vanillaDex(found);
        }
      }
      // Fusions like "Ash-Greninja" / "Clemont-Chesnaught": the vanilla base
      // is the LAST hyphen-separated token.
      const lastToken = stripped.split(/[\s-]+/).pop();
      if (lastToken !== undefined) {
        const found = vanillaIdByName.get(lastToken);
        if (found !== undefined) {
          return vanillaDex(found);
        }
      }
      return null;
    };

    const species: {
      const: string;
      name: string;
      slug: string | null;
      id: number;
      dex: number | null;
      eggTier: number | null;
      cost: number;
    }[] = [];
    const missingConsts: Array<{ id: number; name: string }> = [];
    for (const key of Object.keys(costs)) {
      const id = Number(key);
      const sp = getPokemonSpecies(id);
      if (!sp) {
        continue; // dangling cost entry (unregistered species) — not selectable
      }
      const speciesConst = constById.get(id);
      if (speciesConst === undefined) {
        missingConsts.push({ id, name: sp.name });
        continue; // no stable key to edit it by — should not happen
      }
      species.push({
        const: speciesConst,
        name: sp.name,
        slug: slugByConst.get(speciesConst) ?? null,
        id,
        dex: resolveDex(id, sp.name),
        eggTier: Object.hasOwn(tiers, id) ? tiers[id] : null,
        cost: costs[id],
      });
    }
    species.sort((a, b) => a.name.localeCompare(b.name));

    // ---- all-species.json ---------------------------------------------------
    // EVERY registered species (not just starters), so the Pokedex Editor can
    // select + edit the learnset/TM/abilities of evolutions and forms too. Other
    // tabs keep the starter-only species.json above.
    const allSpeciesIndex: {
      const: string;
      name: string;
      slug: string | null;
      id: number;
      dex: number | null;
      bst: number;
    }[] = [];
    for (const sp of allSpecies) {
      const id = sp.speciesId;
      const speciesConst = constById.get(id);
      if (speciesConst === undefined) {
        continue; // no stable key to edit it by
      }
      allSpeciesIndex.push({
        const: speciesConst,
        name: sp.name,
        slug: slugByConst.get(speciesConst) ?? null,
        id,
        dex: resolveDex(id, sp.name),
        // Base-stat total powers the Custom Trainers tab's BST warning (never a block).
        bst: sp.getBaseStatTotal(),
      });
    }
    allSpeciesIndex.sort((a, b) => a.name.localeCompare(b.name));

    const indexedNewcomers = new Map(
      allSpeciesIndex
        .filter(entry => newcomerCatalog.some(newcomer => newcomer.id === entry.id))
        .map(entry => [entry.id, entry]),
    );
    expect(
      newcomerCatalog
        .filter(entry => !indexedNewcomers.has(entry.id))
        .map(entry => ({ id: entry.id, name: entry.name })),
      "registered newcomer species missing from the editor catalog",
    ).toEqual([]);
    expect(
      pitchCatalog
        .filter(entry => !allSpeciesIndex.some(species => species.id === entry.id && species.slug === entry.slug))
        .map(entry => ({ id: entry.id, slug: entry.slug })),
      "registered fakemon-pitch species missing from the editor catalog",
    ).toEqual([]);
    expect(
      newcomerCatalog
        .filter(entry => !indexedNewcomers.get(entry.id)?.slug)
        .map(entry => ({ id: entry.id, name: entry.name })),
      "registered newcomer species missing an editor sprite slug",
    ).toEqual([]);

    // Recently-added megas/partners are real forms on an existing species ID.
    // Keep them in a dedicated Custom Trainers catalog so the Pokedex editor
    // remains species-keyed while team members can select an exact formIndex.
    const speciesForms = ER_NEWCOMER_FORMS.map(def => {
      const base = getPokemonSpecies(def.baseSpecies);
      const baseConst = constById.get(def.baseSpecies);
      const formIndex = base?.forms.findIndex(form => form.formKey === def.formKey) ?? -1;
      if (!base || !baseConst || formIndex < 0) {
        return null;
      }
      return {
        const: `${baseConst}__FORM_${def.formKey.toUpperCase().replace(/[^A-Z0-9]+/g, "_")}`,
        baseConst,
        name: `${def.formName} ${base.name}`,
        aliases: [`${base.name} ${def.formName}`, `${base.name} (${def.formName})`],
        slug: def.slug,
        id: def.baseSpecies,
        formIndex,
        formKey: def.formKey,
        dex: resolveDex(def.baseSpecies, base.name),
        bst: def.stats.reduce((sum, stat) => sum + stat, 0),
        abilities: {
          ability1: def.actives[0],
          ability2: def.actives[1],
          hidden: def.actives[2],
          innates: [def.innates[0], def.innates[1], def.innates[2]],
        },
      };
    }).filter(entry => entry !== null);
    speciesForms.sort((a, b) => a.name.localeCompare(b.name));
    expect(speciesForms.length, "every newcomer form must resolve to a runtime form index").toBe(
      ER_NEWCOMER_FORMS.length,
    );
    expect(
      speciesForms.filter(form => !form.slug),
      "every newcomer form must expose its bespoke sprite slug",
    ).toEqual([]);
    expect(speciesForms.find(form => form.slug === "jumpluff_mega")).toMatchObject({
      name: "Mega Jumpluff",
      aliases: ["Jumpluff Mega", "Jumpluff (Mega)"],
    });

    // ---- items.json ---------------------------------------------------------
    const tierNames: ReadonlyArray<readonly [ModifierTier, string]> = [
      [ModifierTier.COMMON, "COMMON"],
      [ModifierTier.GREAT, "GREAT"],
      [ModifierTier.ULTRA, "ULTRA"],
      [ModifierTier.ROGUE, "ROGUE"],
      [ModifierTier.MASTER, "MASTER"],
    ];
    const items: { key: string; tier: string; weight: number | null; maxWeight: number | null }[] = [];
    for (const [tier, tierName] of tierNames) {
      for (const entry of modifierPool[tier] ?? []) {
        items.push({
          key: entry.modifierType.id,
          tier: tierName,
          weight: typeof entry.weight === "number" ? entry.weight : null,
          maxWeight: typeof entry.maxWeight === "number" ? entry.maxWeight : null,
        });
      }
    }

    // ---- trainers.json ------------------------------------------------------
    // pokerogue move id → enum-style NAME (the key space the editor validates
    // against): vanilla from the MoveId enum, ER customs from the move drafts.
    const moveNameById = new Map<number, string>();
    for (const [name, value] of Object.entries(MoveId)) {
      if (typeof value === "number") {
        moveNameById.set(value, name);
      }
    }
    for (const draft of ER_MOVES) {
      const pkrgId = ER_ID_MAP.moves[draft.id];
      if (pkrgId === undefined || moveNameById.has(pkrgId)) {
        continue;
      }
      const key = draft.name
        .toUpperCase()
        .replace(/[^A-Z0-9]+/g, "_")
        .replace(/^_+|_+$/g, "");
      if (key) {
        moveNameById.set(pkrgId, key);
      }
    }

    const setsByDraftId = new Map<number, { moves: string[]; abilitySlot: number }[]>();
    for (const [draftId, erMoves, abilitySlot] of ER_FACTORY_SETS) {
      const moves = erMoves
        .map(m => ER_ID_MAP.moves[m])
        .filter((id): id is number => id !== undefined)
        .map(id => moveNameById.get(id))
        .filter((n): n is string => n !== undefined);
      const list = setsByDraftId.get(draftId) ?? [];
      list.push({ moves, abilitySlot });
      setsByDraftId.set(draftId, list);
    }
    const draftById = new Map(ER_SPECIES.map(d => [d.id, d]));
    const factorySpecies: {
      const: string;
      name: string;
      slug: string | null;
      sets: number;
      setsDetail: { moves: string[]; abilitySlot: number }[];
    }[] = [];
    for (const [draftId, setsDetail] of setsByDraftId) {
      const draft = draftById.get(draftId);
      const pkrgId = ER_ID_MAP.species[draftId];
      if (!draft || pkrgId === undefined || !getPokemonSpecies(pkrgId)) {
        continue; // unmapped/cosmetic — the game drops these sets too
      }
      factorySpecies.push({
        const: draft.speciesConst,
        name: getPokemonSpecies(pkrgId)?.name ?? draft.name,
        slug: slugByConst.get(draft.speciesConst) ?? null,
        sets: setsDetail.length,
        setsDetail,
      });
    }
    factorySpecies.sort((a, b) => a.name.localeCompare(b.name));
    const trainers = {
      frequencyDefaults: {
        elite: { trainerCadence: ER_TRAINER_CADENCE.elite, factoryTeamPct: ER_FACTORY_TEAM_CHANCE_PCT },
        hell: { trainerCadence: ER_TRAINER_CADENCE.hell, factoryTeamPct: ER_FACTORY_TEAM_CHANCE_PCT },
      },
      factorySpecies,
    };

    writeFileSync("editor/data/species.json", `${JSON.stringify(species, null, 2)}\n`, "utf8");
    writeFileSync("editor/data/all-species.json", `${JSON.stringify(allSpeciesIndex, null, 2)}\n`, "utf8");
    writeFileSync("editor/data/species-forms.json", `${JSON.stringify(speciesForms, null, 2)}\n`, "utf8");
    writeFileSync("editor/data/items.json", `${JSON.stringify(items, null, 2)}\n`, "utf8");
    writeFileSync("editor/data/trainers.json", `${JSON.stringify(trainers, null, 2)}\n`, "utf8");
    // The Game tab renders straight from the knob registry (single source of truth).
    writeFileSync("editor/data/balance-knobs.json", `${JSON.stringify(ER_BALANCE_KNOBS, null, 2)}\n`, "utf8");

    // Ability display names (vanilla + ER customs) for the Add-a-Mon autocomplete.
    const abilityNames = [
      ...new Set(allAbilities.filter(a => a && a.id > 0 && a.name && !a.name.startsWith("???")).map(a => a.name)),
    ].sort();
    writeFileSync("editor/data/abilities.json", `${JSON.stringify(abilityNames, null, 2)}\n`, "utf8");

    // Sanity: the roster covers every starter-cost entry that is a real species,
    // includes vanilla + ER customs, and lost nobody to a missing const key.
    expect(missingConsts, `starter species missing stable editor constants: ${JSON.stringify(missingConsts)}`).toEqual(
      [],
    );
    // 570 vanilla starters (incl. Pikachu, which the old egg-move-key roster
    // dropped) + the ER customs the init passes leave in the grid.
    expect(species.filter(s => s.id < VANILLA_ID_CUTOFF).length).toBeGreaterThanOrEqual(569);
    expect(species.filter(s => s.id >= VANILLA_ID_CUTOFF).length).toBeGreaterThan(100);
    expect(items.length).toBeGreaterThan(50);
    expect(factorySpecies.length).toBeGreaterThan(100);
    // eslint-disable-next-line no-console
    console.log(
      `WROTE editor data: ${species.length} species (${species.filter(s => s.slug).length} with sprites), ${items.length} pool items, ${factorySpecies.length} factory species`,
    );
  });
});
