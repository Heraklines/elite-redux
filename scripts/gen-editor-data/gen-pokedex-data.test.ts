/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 *
 * Editor data generator (Pokedex Editor tab): dumps the LIVE, ER-initialised
 * learnsets / TM learnsets / abilities / move + ability metadata into
 * editor/data/*.json so the er-editor SPA can edit them. Read-only on the game.
 *
 * Run:  GEN_EDITOR_DATA=1 npx vitest run scripts/gen-editor-data/gen-pokedex-data.test.ts
 *
 * Gated by GEN_EDITOR_DATA so it never runs in normal CI (it writes files). It
 * relies on the standard vitest setup (initTests) having applied every ER init,
 * so getLevelMoves()/ability slots/tmSpecies reflect ER 2.65, not vanilla.
 */

import { tmSpecies } from "#balance/tm-species-map";
import { allAbilities, allMoves, allSpecies } from "#data/data-lists";
import { AbilityId } from "#enums/ability-id";
import { MoveCategory } from "#enums/move-category";
import { PokemonType } from "#enums/pokemon-type";
import { mkdirSync, writeFileSync } from "node:fs";
import { describe, it } from "vitest";

const RUN = process.env.GEN_EDITOR_DATA === "1";

/** Compact JSON (these files are machine-generated, not hand-edited). */
function writeJson(path: string, value: unknown): void {
  writeFileSync(path, `${JSON.stringify(value)}\n`);
}

describe.skipIf(!RUN)("gen editor pokedex data", () => {
  it("writes editor/data learnset/tm/ability/move JSONs", () => {
    // Invert tmSpecies (moveId -> species[]) into species -> moveId[].
    const tmBySpecies: Record<number, number[]> = {};
    for (const [moveIdStr, speciesArr] of Object.entries(tmSpecies)) {
      const moveId = Number(moveIdStr);
      for (const sp of speciesArr as number[]) {
        (tmBySpecies[sp] ??= []).push(moveId);
      }
    }

    // Per-species: level-up learnset, TM learnset, ability slots. Keyed by the
    // numeric speciesId (stable id the override + game loader resolve back).
    const learnsets: Record<number, [number, number][]> = {};
    const tmLearnsets: Record<number, number[]> = {};
    const speciesAbilities: Record<
      number,
      { ability1: number; ability2: number; hidden: number; innates: [number, number, number] }
    > = {};
    for (const sp of allSpecies) {
      const id = sp.speciesId;
      learnsets[id] = sp.getLevelMoves().map(([lvl, mv]) => [lvl, mv] as [number, number]);
      tmLearnsets[id] = (tmBySpecies[id] ?? []).slice().sort((a, b) => a - b);
      // ER 3-passive triple ("innates"); NONE (0) for empty slots.
      const [in1, in2, in3] = sp.getPassiveAbilities();
      speciesAbilities[id] = {
        ability1: sp.ability1,
        ability2: sp.ability2,
        hidden: sp.abilityHidden,
        innates: [in1, in2, in3],
      };
    }

    // Move + ability catalogs with the metadata the palettes sort/search on.
    const movesRich = allMoves
      .filter(Boolean)
      .filter(m => m.id !== 0)
      .map(m => ({
        id: m.id,
        name: m.name,
        type: PokemonType[m.type] ?? "UNKNOWN",
        category: MoveCategory[m.category] ?? "STATUS",
        power: m.power,
        accuracy: m.accuracy,
        pp: m.pp,
      }));
    // A few vanilla abilities don't localize in the gen env (their `name`
    // stays an i18n key like "static.name"); fall back to the prettified
    // AbilityId enum key so the editor never shows a raw key.
    const prettify = (s: string): string =>
      s
        .toLowerCase()
        .split("_")
        .map(w => w.charAt(0).toUpperCase() + w.slice(1))
        .join(" ");
    const abilName = (a: { id: number; name: string }): string =>
      /\.name$/.test(a.name) || /^[a-z_]+\.[a-z]/.test(a.name) ? prettify(AbilityId[a.id] ?? a.name) : a.name;
    const abilitiesRich = allAbilities
      .filter(Boolean)
      .filter(a => a.id !== 0)
      .map(a => ({ id: a.id, name: abilName(a), description: a.description }));

    mkdirSync("editor/data", { recursive: true });
    writeJson("editor/data/learnsets.json", learnsets);
    writeJson("editor/data/tm-learnsets.json", tmLearnsets);
    writeJson("editor/data/species-abilities.json", speciesAbilities);
    writeJson("editor/data/moves-rich.json", movesRich);
    writeJson("editor/data/abilities-rich.json", abilitiesRich);

    // eslint-disable-next-line no-console
    console.log(
      `[gen-editor-data] species=${allSpecies.length} moves=${movesRich.length} abilities=${abilitiesRich.length}`,
    );
  });
});
