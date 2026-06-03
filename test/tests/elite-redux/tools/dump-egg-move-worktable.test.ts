/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// One-off generator (NOT a real test): dumps every egg-able ER-custom base
// species with its full kit (types / base stats / abilities + innates /
// evolution / everything it already learns) into a worktable, so egg moves can
// be hand-audited per species. Run with:
//   ER_SCENARIO=1 npx vitest run test/tests/elite-redux/tools/dump-egg-move-worktable.test.ts
// Output: docs/plans/er-egg-moves-worktable.md

import { pokemonEvolutions, pokemonPrevolutions } from "#balance/pokemon-evolutions";
import { speciesEggTiers } from "#balance/species-egg-tiers";
import { allAbilities, allMoves } from "#data/data-lists";
import { ER_ID_MAP } from "#data/elite-redux/er-id-map";
import { ER_SPECIES } from "#data/elite-redux/er-species";
import { AbilityId } from "#enums/ability-id";
import { PokemonType } from "#enums/pokemon-type";
import { getPokemonSpecies } from "#utils/pokemon-utils";
import { writeFileSync } from "node:fs";
import { describe, it } from "vitest";

const VANILLA_ID_CUTOFF = 10000;

function moveName(pkrgMoveId: number | undefined): string {
  if (pkrgMoveId === undefined || pkrgMoveId === 0) {
    return "";
  }
  return allMoves[pkrgMoveId]?.name ?? `?${pkrgMoveId}`;
}
function abilityName(pkrgAbId: number | undefined): string {
  if (pkrgAbId === undefined || pkrgAbId === 0) {
    return "";
  }
  return allAbilities[pkrgAbId]?.name ?? `?${pkrgAbId}`;
}
const STAT = ["HP", "Atk", "Def", "SpA", "SpD", "Spe"];

describe("tools — dump ER egg-move worktable", () => {
  it("writes the worktable", () => {
    // ER draft id -> draft
    const draftById = new Map<number, (typeof ER_SPECIES)[number]>();
    const draftByConst = new Map<string, (typeof ER_SPECIES)[number]>();
    for (const d of ER_SPECIES) {
      draftById.set(d.id, d);
      draftByConst.set(d.speciesConst, d);
    }
    // pkrg species id -> ER draft (via id map)
    const draftByPkrg = new Map<number, (typeof ER_SPECIES)[number]>();
    for (const d of ER_SPECIES) {
      const pk = ER_ID_MAP.species[d.id];
      if (pk !== undefined) {
        draftByPkrg.set(pk, d);
      }
    }

    const mapMove = (erId: number): number | undefined => ER_ID_MAP.moves?.[erId];
    const mapAb = (erId: number): number | undefined => ER_ID_MAP.abilities?.[erId];

    // Egg-able ER customs = those registered in speciesEggTiers with id >= cutoff.
    const targets: number[] = Object.keys(speciesEggTiers)
      .map(Number)
      .filter(id => id >= VANILLA_ID_CUTOFF && !Object.hasOwn(pokemonPrevolutions, id))
      .sort((a, b) => a - b);

    const lines: string[] = [];
    lines.push("# ER Egg-Move Audit — Worktable\n");
    lines.push(`Egg-able ER-custom base species needing 4 hand-audited egg moves each: **${targets.length}**.\n`);
    lines.push(
      "Per species: type, BST + stat spread (role hint), active abilities + innates, what it evolves into, and its FULL existing learnset (level-up / TM / tutor) so egg moves are genuine off-movepool additions. Fill `EGG:` with 4 MoveId names.\n",
    );
    lines.push("---\n");

    for (const pkrgId of targets) {
      const sp = getPokemonSpecies(pkrgId);
      const draft = draftByPkrg.get(pkrgId);
      if (!sp || !draft) {
        continue;
      }
      const bst = sp.baseStats.reduce((a, b) => a + b, 0);
      const spread = sp.baseStats.map((v, i) => `${STAT[i]} ${v}`).join(" / ");
      const t1 = PokemonType[sp.type1];
      const t2 = sp.type2 == null ? "" : `/${PokemonType[sp.type2]}`;
      const abilities = [sp.ability1, sp.ability2, sp.abilityHidden]
        .filter(a => a && a !== AbilityId.NONE)
        .map(abilityName)
        .filter((v, i, arr) => arr.indexOf(v) === i)
        .join(", ");
      const innates = draft.innates
        .map(mapAb)
        .map(abilityName)
        .filter(n => n.length > 0)
        .join(", ");
      const evos = (pokemonEvolutions[pkrgId] ?? [])
        .map(e => getPokemonSpecies(e.speciesId)?.name ?? `?${e.speciesId}`)
        .join(", ");
      const levelMoves = draft.levelUpMoves
        .map(m => moveName(mapMove(m.id)))
        .filter(n => n.length > 0)
        .filter((v, i, arr) => arr.indexOf(v) === i);
      const tmMoves = (draft.tmhmMoves ?? [])
        .map(mapMove)
        .map(moveName)
        .filter(n => n.length > 0)
        .filter((v, i, arr) => arr.indexOf(v) === i);
      const tutorMoves = (draft.tutorMoves ?? [])
        .map(mapMove)
        .map(moveName)
        .filter(n => n.length > 0)
        .filter((v, i, arr) => arr.indexOf(v) === i);
      const learnset = new Set([...levelMoves, ...tmMoves, ...tutorMoves]);

      lines.push(`## ${sp.name}  (${draft.speciesConst}, id ${pkrgId})`);
      lines.push(`- Type: ${t1}${t2}   BST ${bst}  —  ${spread}`);
      lines.push(`- Abilities: ${abilities || "—"}`);
      lines.push(`- Innates: ${innates || "—"}`);
      lines.push(`- Evolves into: ${evos || "(none / final)"}`);
      lines.push(`- Already learns (${learnset.size}): ${[...learnset].sort().join(", ") || "—"}`);
      lines.push("- EGG: ____, ____, ____, ____");
      lines.push("");
    }

    writeFileSync("docs/plans/er-egg-moves-worktable.md", lines.join("\n"), "utf8");
    // eslint-disable-next-line no-console
    console.log(`WROTE worktable: ${targets.length} egg-able ER-custom species`);
  });
});
