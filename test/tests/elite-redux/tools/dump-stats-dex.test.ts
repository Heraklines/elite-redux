/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// One-off generator (NOT a real test): dumps the rich dex dataset the public
// "Pokédex & Usage" SPA (stats/) reads, FROM THE LIVE RUNTIME TABLES after the
// full initializeGame() chain — so the roster is exactly the starter-selectable
// set (vanilla starters + every ER custom the init passes register, minus the
// evolved/battle-only forms and egg-pool bans). This mirrors
// dump-editor-data.test.ts (same constById / slug / resolveDex / starter-cost
// roster logic) but writes the richer superset stats/data/dex.json with types,
// base stats, abilities and BST pulled from getPokemonSpecies(id). Run with:
//   ER_SCENARIO=1 npx vitest run test/tests/elite-redux/tools/dump-stats-dex.test.ts
// Output:
//   stats/data/dex.json — [{ slug, name, id, dex, types, baseStats, bst,
//                            abilities, eggTier, cost }] for every
//                            starter-selectable species.
import { speciesEggTiers } from "#balance/species-egg-tiers";
import { speciesStarterCosts } from "#balance/starters";
import { allAbilities, allSpecies } from "#data/data-lists";
import { ER_ID_MAP } from "#data/elite-redux/er-id-map";
import { ER_SPECIES } from "#data/elite-redux/er-species";
import { ER_SPRITE_MANIFEST } from "#data/elite-redux/er-sprite-manifest";
import type { EggTier } from "#enums/egg-type";
import { PokemonType } from "#enums/pokemon-type";
import { SpeciesId } from "#enums/species-id";
import { getPokemonSpecies } from "#utils/pokemon-utils";
import { writeFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const VANILLA_ID_CUTOFF = 10000;

describe("tools — dump stats SPA dex", () => {
  it("writes stats/data/dex.json from the live tables", () => {
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

    // speciesConst → sprite slug.
    const slugByConst = new Map<string, string>();
    for (const entry of ER_SPRITE_MANIFEST) {
      if (!slugByConst.has(entry.speciesConst)) {
        slugByConst.set(entry.speciesConst, entry.slug);
      }
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

    // PokemonType enum value → display name (e.g. 0 → "Fire" cased). The enum is
    // SCREAMING_CASE; the SPA expects "Fire"/"Water"/... so title-case here.
    const typeName = (t: PokemonType | null): string | null => {
      if (t === null || t === undefined || t < 0) {
        return null;
      }
      const raw = PokemonType[t];
      if (typeof raw !== "string") {
        return null;
      }
      return raw.charAt(0) + raw.slice(1).toLowerCase();
    };

    // AbilityId → display name (via allAbilities; 0 / NONE / "???" dropped).
    const abilityName = (id: number): string | null => {
      if (!id) {
        return null;
      }
      const a = allAbilities[id];
      if (!a?.name || a.name.startsWith("???")) {
        return null;
      }
      return a.name;
    };

    const dex: {
      slug: string | null;
      name: string;
      id: number;
      dex: number | null;
      types: [string | null, string | null];
      baseStats: number[];
      bst: number;
      abilities: string[];
      eggTier: number | null;
      cost: number;
    }[] = [];
    let missingConst = 0;
    for (const key of Object.keys(costs)) {
      const id = Number(key);
      const sp = getPokemonSpecies(id);
      if (!sp) {
        continue; // dangling cost entry (unregistered species) — not selectable
      }
      const speciesConst = constById.get(id);
      if (speciesConst === undefined) {
        missingConst++;
        continue; // no stable key to edit it by — should not happen
      }
      // Types: [primary, secondary | null].
      const types: [string | null, string | null] = [typeName(sp.type1), typeName(sp.type2)];
      // Base stats: [hp, atk, def, spatk, spdef, spd] (the runtime order).
      const baseStats = [...sp.baseStats];
      const bst = baseStats.reduce((s, v) => s + v, 0);
      // Abilities: ability1, ability2, hidden — deduped, NONE / ??? dropped.
      const abilities = [
        ...new Set(
          [sp.ability1, sp.ability2, sp.abilityHidden].map(abilityName).filter((n): n is string => n !== null),
        ),
      ];
      dex.push({
        slug: slugByConst.get(speciesConst) ?? null,
        name: sp.name,
        id,
        dex: resolveDex(id, sp.name),
        types,
        baseStats,
        bst,
        abilities,
        eggTier: Object.hasOwn(tiers, id) ? tiers[id] : null,
        cost: costs[id],
      });
    }
    dex.sort((a, b) => a.name.localeCompare(b.name));

    writeFileSync("stats/data/dex.json", `${JSON.stringify(dex, null, 2)}\n`, "utf8");

    // Sanity: the roster covers every starter-cost entry that is a real species,
    // includes vanilla + ER customs, lost nobody to a missing const key, and
    // every entry has real types + base stats.
    expect(missingConst).toBe(0);
    expect(dex.length).toBeGreaterThanOrEqual(600);
    expect(dex.filter(d => d.id < VANILLA_ID_CUTOFF).length).toBeGreaterThanOrEqual(569);
    expect(dex.filter(d => d.id >= VANILLA_ID_CUTOFF).length).toBeGreaterThan(100);
    expect(dex.every(d => d.types[0] !== null)).toBe(true);
    expect(dex.every(d => d.baseStats.length === 6 && d.bst > 0)).toBe(true);
    expect(dex.every(d => d.abilities.length > 0)).toBe(true);
    // eslint-disable-next-line no-console
    console.log(
      `WROTE stats/data/dex.json: ${dex.length} species (${dex.filter(d => d.slug).length} with sprites), `
        + `${dex.filter(d => d.types[1]).length} dual-type, mean BST ${Math.round(dex.reduce((s, d) => s + d.bst, 0) / dex.length)}`,
    );
  });
});
