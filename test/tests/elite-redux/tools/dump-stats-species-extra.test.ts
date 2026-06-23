/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// One-off generator (NOT a real test): dumps types + base stats for EVERY species
// the editor knows (vanilla + ER customs, INCLUDING evolved / non-starter forms),
// FROM THE LIVE RUNTIME TABLES after the full initializeGame() chain. This is the
// same read-only dump mechanism that produced stats/data/dex.json — but dex.json
// only covers the starter-selectable GRID, so the public "Pokédex & Usage" SPA
// (stats/) had no types for evolved forms (e.g. Cradily). This fills that gap so
// the per-Pokemon detail page can compute type matchups and show base-stat bars
// for evolved forms too. READ-ONLY: it reads the editor's species list and the
// runtime species table, and writes a single static file under stats/data. It
// never modifies the game or the editor. Run with:
//   ER_SCENARIO=1 npx vitest run test/tests/elite-redux/tools/dump-stats-species-extra.test.ts
// Output:
//   stats/data/species-extra.json — { species: { [id]: { slug, name, types,
//                                     baseStats, bst } } } for every editor id.
import { PokemonType } from "#enums/pokemon-type";
import { getPokemonSpecies } from "#utils/pokemon-utils";
import { readFileSync, writeFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("tools — dump stats SPA species-extra", () => {
  it("writes stats/data/species-extra.json for every editor species", () => {
    // PokemonType enum value → display name (e.g. 5 → "Rock"). The enum is
    // SCREAMING_CASE; the SPA expects "Rock"/"Grass"/... so title-case here,
    // matching dex.json's casing exactly.
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

    // The editor's species list is the navigable set the detail page links to,
    // keyed by the same species id the SPA joins on (matches dex.json / detail).
    const editorSpecies = JSON.parse(readFileSync("editor/data/all-species.json", "utf8")) as {
      id: number;
      slug: string;
      name: string;
    }[];

    const species: Record<
      number,
      { slug: string; name: string; types: [string | null, string | null]; baseStats: number[]; bst: number }
    > = {};
    let resolved = 0;
    let unresolved = 0;
    for (const e of editorSpecies) {
      if (typeof e.id !== "number") {
        continue;
      }
      const sp = getPokemonSpecies(e.id);
      if (!sp) {
        unresolved++;
        continue; // editor id with no live species (dangling) — skip
      }
      const types: [string | null, string | null] = [typeName(sp.type1), typeName(sp.type2)];
      if (types[0] === null) {
        unresolved++;
        continue; // malformed (no primary type) — skip
      }
      const baseStats = [...sp.baseStats];
      const bst = baseStats.reduce((s, v) => s + v, 0);
      species[e.id] = { slug: e.slug, name: e.name, types, baseStats, bst };
      resolved++;
    }

    const payload = {
      _source:
        "live runtime species table (read-only); types + base stats for EVERY editor species incl. evolved forms",
      count: resolved,
      species,
    };
    writeFileSync("stats/data/species-extra.json", `${JSON.stringify(payload)}\n`, "utf8");

    // Sanity: covers the bulk of the roster, and a known evolved (non-grid) form
    // resolves with real ER types + base stats.
    expect(resolved).toBeGreaterThan(1000);
    const cradily = Object.values(species).find(s => s.slug === "cradily");
    expect(cradily?.types).toEqual(["Rock", "Grass"]);
    expect(cradily?.baseStats.length).toBe(6);
    expect(cradily?.bst).toBeGreaterThan(0);
    // eslint-disable-next-line no-console
    console.log(`WROTE stats/data/species-extra.json: ${resolved} species (${unresolved} editor ids unresolved)`);
  });
});
