/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// ER factory-sets generator (#347).
//
// Input:  the maintainer-provided `factory_sets (1).xlsx` (Battle-Factory-style
//         competitive sets exported from ER) — pass the extracted sheet1.xml
//         path as argv[2].
// Output: src/data/elite-redux/er-factory-sets.ts — compact tuples of
//         [erSpeciesId, [erMoveIds x4], erItemId, abilitySlot].
//
// Resolution happens here at GENERATION time against vendor v2.65beta.json:
//   - species by display name (the sheet uses display names incl. customs);
//   - moves by display name OR the ROM's 12-char short name (the sheet ships
//     truncated names like "DrainingKiss");
//   - items are DROPPED: the sheet's Item# indexes an expanded frontier
//     held-item table from a newer ER build that is not in our vendor decomp
//     (2.65.3b ships only the vanilla 63-entry table), so the ids cannot be
//     decoded safely. The runtime baseline trainer item roll still applies.
//     This also guarantees no Swirly Glasses leaks (#347).
//
// Usage: node scripts/elite-redux/builders/factory-sets.mjs <sheet1.xml>
// =============================================================================

import { readFileSync, writeFileSync } from "node:fs";

const sheetPath = process.argv[2];
if (!sheetPath) {
  console.error("usage: node factory-sets.mjs <sheet1.xml>");
  process.exit(1);
}

const vendor = JSON.parse(readFileSync("vendor/elite-redux/v2.65beta.json", "utf8"));

const norm = s =>
  String(s ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");

// Species: positional index == the ER id space used by ER_ID_MAP.species.
const speciesByName = new Map();
vendor.species.forEach((s, i) => {
  if (s?.name) {
    speciesByName.set(norm(s.name), i);
  }
});

// Moves: positional index == the ER id space used by ER_ID_MAP.moves.
const moveByName = new Map();
const moveByShort = new Map();
vendor.moves.forEach((m, i) => {
  if (m?.name) {
    moveByName.set(norm(m.name), i);
  }
  if (m?.sName) {
    moveByShort.set(norm(m.sName), i);
  }
});

function resolveMove(raw) {
  const key = norm(raw);
  if (!key) {
    return 0;
  }
  const direct = moveByName.get(key) ?? moveByShort.get(key);
  if (direct !== undefined) {
    return direct;
  }
  // The sheet truncates long names — try unique-prefix against full names.
  let hit;
  let hits = 0;
  for (const [name, id] of moveByName) {
    if (name.startsWith(key)) {
      hit = id;
      hits++;
    }
  }
  return hits === 1 ? hit : -1;
}

const xml = readFileSync(sheetPath, "utf8");
const rows = [...xml.matchAll(/<row[^>]*>([\s\S]*?)<\/row>/g)];
const cellsOf = rowXml => {
  const out = {};
  for (const m of rowXml.matchAll(/<c r="([A-Z]+)\d+"[^>]*>([\s\S]*?)<\/c>/g)) {
    const inner = m[2];
    const is = inner.match(/<t[^>]*>([\s\S]*?)<\/t>/);
    const v = inner.match(/<v>([\s\S]*?)<\/v>/);
    out[m[1]] = is ? is[1] : v ? v[1] : "";
  }
  return out;
};

const sets = [];
const unknownSpecies = new Map();
const unknownMoves = new Map();

for (let r = 1; r < rows.length; r++) {
  const c = cellsOf(rows[r][1]);
  const speciesId = speciesByName.get(norm(c.B));
  if (speciesId === undefined) {
    unknownSpecies.set(c.B, (unknownSpecies.get(c.B) ?? 0) + 1);
    continue;
  }
  const moves = [];
  let badMove = false;
  for (const col of ["E", "F", "G", "H"]) {
    const raw = c[col];
    if (!raw) {
      continue;
    }
    const id = resolveMove(raw);
    if (id < 0) {
      unknownMoves.set(raw, (unknownMoves.get(raw) ?? 0) + 1);
      badMove = true;
      continue;
    }
    if (id > 0) {
      moves.push(id);
    }
  }
  if (badMove && moves.length === 0) {
    continue; // nothing usable
  }
  const abilityNum = Math.min(2, Math.max(0, Number.parseInt(c.K ?? "0", 10) || 0));
  sets.push([speciesId, moves, abilityNum]);
}

console.log(
  `parsed=${rows.length - 1} resolved=${sets.length} `
    + `unknownSpecies=${unknownSpecies.size} unknownMoves=${unknownMoves.size}`,
);
if (unknownSpecies.size > 0) {
  console.log("unknown species:", [...unknownSpecies.entries()].slice(0, 20));
}
if (unknownMoves.size > 0) {
  console.log("unknown moves:", [...unknownMoves.entries()].slice(0, 20));
}

const body = sets.map(s => `  [${s[0]}, [${s[1].join(", ")}], ${s[2]}],`).join("\n");
const out = `/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// AUTO-GENERATED FILE — DO NOT EDIT BY HAND.
// Source: factory_sets xlsx (maintainer-provided ER Battle-Factory sets).
// Regenerate with:
//   node scripts/elite-redux/builders/factory-sets.mjs <sheet1.xml>
// Held items are intentionally omitted (undecodable id space) — see builder.
// =============================================================================

/** One factory set: [erSpeciesId, erMoveIds, abilitySlot]. */
export type ErFactorySetTuple = readonly [number, readonly number[], 0 | 1 | 2];

export const ER_FACTORY_SETS: readonly ErFactorySetTuple[] = [
${body}
];
`;
writeFileSync("src/data/elite-redux/er-factory-sets.ts", out);
console.log(`wrote src/data/elite-redux/er-factory-sets.ts (${sets.length} sets)`);
