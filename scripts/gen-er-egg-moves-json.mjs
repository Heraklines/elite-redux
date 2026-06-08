// One-off: convert src/data/elite-redux/er-egg-moves.ts (SPECIES_X: [MoveId.A,…])
// into the editor-friendly src/data/elite-redux/er-egg-moves.json
// ({ "SPECIES_X": ["A", …] }). Move NAMES are kept as strings so the team
// editor can read/write them without touching TS. Run: node scripts/gen-er-egg-moves-json.mjs
import { readFileSync, writeFileSync } from "node:fs";

const SRC = "src/data/elite-redux/er-egg-moves.ts";
const OUT = "src/data/elite-redux/er-egg-moves.json";

const text = readFileSync(SRC, "utf8");
const out = {};
// Match `SPECIES_FOO: [MoveId.A, MoveId.B, MoveId.C, MoveId.D]`
const entryRe = /(SPECIES_[A-Z0-9_]+)\s*:\s*\[([^\]]+)\]/g;
let m;
let count = 0;
while ((m = entryRe.exec(text)) !== null) {
  const speciesConst = m[1];
  const moves = m[2]
    .split(",")
    .map(s => s.trim())
    .filter(Boolean)
    .map(s => s.replace(/^MoveId\./, ""));
  out[speciesConst] = moves;
  count++;
}

writeFileSync(OUT, `${JSON.stringify(out, null, 2)}\n`);
console.log(`wrote ${count} species → ${OUT}`);
