/*
 * Build stats/data/dex-detail.json for the per-Pokemon detail page (learnsets,
 * TMs, abilities + descriptions, evolution graph, a move index and an ability
 * index). It reads the EDITOR's exported data READ-ONLY and writes only into
 * stats/data/. It never reads or writes the game source, and never modifies the
 * editor or editor/data. The editor stays the single source of truth: when the
 * team re-edits, re-run this and redeploy to pick up the new data.
 *
 * Not included (the editor does not export them): move descriptions and egg
 * moves. The Moves tab shows name/type/category/power/accuracy/PP only.
 *
 *   node stats/gen-dex-detail.mjs
 */
import { readFileSync, writeFileSync } from "node:fs";

const ED = new URL("../editor/data/", import.meta.url); // sibling of stats/, read-only
const OUT = new URL("./data/dex-detail.json", import.meta.url);
const read = name => JSON.parse(readFileSync(new URL(name, ED), "utf8"));

const learnsets = read("learnsets.json"); // { id: [[level, moveId], ...] }
const tms = read("tm-learnsets.json"); // { id: [moveId, ...] }
const spAbil = read("species-abilities.json"); // { id: {ability1, ability2, hidden, innates:[]} }
const abilRich = read("abilities-rich.json"); // [{id, name, description}]
const movesRich = read("moves-rich.json"); // [{id, name, type, category, power, accuracy, pp}]
const evos = read("evolutions.json"); // { id: {to:[], from:[]} }
const allSpecies = read("all-species.json"); // [{const, name, slug, id, dex}]

// Move index (referenced by learnsets/TMs) and ability index (referenced by
// species-abilities), both keyed by id so the page can resolve names/text/stats.
const moves = {};
for (const m of movesRich) {
  moves[m.id] = {
    name: m.name,
    type: m.type,
    category: m.category,
    power: m.power ?? 0,
    accuracy: m.accuracy ?? 0,
    pp: m.pp ?? 0,
  };
}

const abilities = {};
for (const a of abilRich) {
  abilities[a.id] = { name: a.name, desc: a.description ?? "" };
}

// Names for every species id (so evolution-line / cross-link entries can render
// a label even when the member is not in the starter-grid dex.json).
const names = {};
for (const s of allSpecies) {
  if (typeof s.id === "number") {
    names[s.id] = { name: s.name, slug: s.slug };
  }
}

// Abilities for a species, in display order, de-duplicated. Slots: the two
// regular abilities, the hidden ability, then the ER innates (passives).
function abilitiesFor(id) {
  const a = spAbil[id];
  if (!a) {
    return [];
  }
  const out = [];
  const seen = new Set();
  const push = (slot, aid) => {
    if (!aid || seen.has(aid)) {
      return;
    }
    seen.add(aid);
    out.push({ slot, id: aid });
  };
  push("ability1", a.ability1);
  push("ability2", a.ability2);
  push("hidden", a.hidden);
  for (const inn of a.innates ?? []) {
    push("innate", inn);
  }
  return out;
}

// One detail record per species that has any of: abilities, learnset, TMs, or an
// evolution edge. Covers the starter grid plus their evolved-stage relatives.
const ids = new Set(
  [...Object.keys(spAbil), ...Object.keys(learnsets), ...Object.keys(tms), ...Object.keys(evos)].map(Number),
);

const species = {};
const missingMoves = new Set();
const missingAbil = new Set();
for (const id of [...ids].sort((a, b) => a - b)) {
  const levelup = learnsets[id] ?? [];
  const tm = tms[id] ?? [];
  const ab = abilitiesFor(id);
  const ev = evos[id] ?? {};
  // Track any referenced id we cannot resolve, so gaps are visible, not silent.
  for (const [, mid] of levelup) {
    if (!moves[mid]) {
      missingMoves.add(mid);
    }
  }
  for (const mid of tm) {
    if (!moves[mid]) {
      missingMoves.add(mid);
    }
  }
  for (const x of ab) {
    if (!abilities[x.id]) {
      missingAbil.add(x.id);
    }
  }
  species[id] = {
    abilities: ab,
    levelup,
    tm,
    evoFrom: ev.from ?? [],
    evoTo: ev.to ?? [],
  };
}

const payload = {
  _source: "editor/data (read-only); move descriptions + egg moves intentionally omitted",
  generatedAt: new Date().toISOString(),
  counts: {
    species: Object.keys(species).length,
    moves: Object.keys(moves).length,
    abilities: Object.keys(abilities).length,
  },
  moves,
  abilities,
  names,
  species,
};

writeFileSync(OUT, JSON.stringify(payload));
console.log(
  `wrote dex-detail.json: ${payload.counts.species} species, ${payload.counts.moves} moves, ${payload.counts.abilities} abilities`,
);
if (missingMoves.size > 0) {
  console.log(
    `WARN: ${missingMoves.size} referenced move ids missing from moves-rich (e.g. ${[...missingMoves].slice(0, 8).join(", ")})`,
  );
}
if (missingAbil.size > 0) {
  console.log(
    `WARN: ${missingAbil.size} referenced ability ids missing from abilities-rich (e.g. ${[...missingAbil].slice(0, 8).join(", ")})`,
  );
}
