#!/usr/bin/env node
// =============================================================================
// Diagnose id-map drift in level-up movesets — finds species whose level-up
// or TM movesets reference move ids that don't exist in allMoves after
// initialization. Helps pin down the root cause of the trainer-freeze
// regression seen in production browser sessions.
// =============================================================================

import { readFileSync } from "node:fs";

const dump = JSON.parse(readFileSync("vendor/elite-redux/v2.65beta.json", "utf-8"));

// Collect every move-id referenced by any species' level-up or TM/HM table.
const refs = new Map(); // moveId -> [species names]
for (const s of dump.species) {
  if (!s.levelUpMoves) continue;
  for (const lm of s.levelUpMoves) {
    if (!refs.has(lm.id)) refs.set(lm.id, []);
    refs.get(lm.id).push(`${s.name} L${lm.level}`);
  }
  if (s.TMHMMoves) {
    for (const m of s.TMHMMoves) {
      if (!refs.has(m)) refs.set(m, []);
      refs.get(m).push(`${s.name} TM`);
    }
  }
  if (s.tutor) {
    for (const m of s.tutor) {
      if (!refs.has(m)) refs.set(m, []);
      refs.get(m).push(`${s.name} tutor`);
    }
  }
  if (s.eggMoves) {
    for (const m of s.eggMoves) {
      if (!refs.has(m)) refs.set(m, []);
      refs.get(m).push(`${s.name} egg`);
    }
  }
}

// Count moves in the dump.
const totalMoves = dump.moves.length;
console.log(`Total moves in ER dump: ${totalMoves}`);
console.log(`Distinct move ids referenced by species: ${refs.size}`);

// Moves referenced but not in the dump (id >= totalMoves).
const outOfRange = [];
for (const id of refs.keys()) {
  if (id < 0 || id >= totalMoves) {
    outOfRange.push({ id, refs: refs.get(id).slice(0, 5) });
  }
}

console.log(`\nMoves referenced by species but out-of-range: ${outOfRange.length}`);
for (const m of outOfRange.slice(0, 20)) {
  console.log(`  id=${m.id}: refs=${m.refs.join(", ")}`);
}

// Moves where the dump entry is a placeholder (empty name).
const placeholders = [];
for (const id of refs.keys()) {
  const move = dump.moves[id];
  if (move && (!move.name || move.name === "-------" || move.name.trim() === "")) {
    placeholders.push({ id, name: move.name, refs: refs.get(id).slice(0, 3) });
  }
}
console.log(`\nMoves referenced by species pointing to placeholder entries: ${placeholders.length}`);
for (const p of placeholders.slice(0, 10)) {
  console.log(`  id=${p.id} name='${p.name}' refs=${p.refs.join(", ")}`);
}
