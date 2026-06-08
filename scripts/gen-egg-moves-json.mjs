// Build the COMBINED egg-move table the editor + game read:
//   src/data/elite-redux/er-egg-moves.json  ({ "SPECIES_X": ["MOVE", …] })
// from BOTH sources, so the editor covers the full roster (not just ER customs):
//   - vanilla: src/data/balance/moves/egg-moves.ts  ([SpeciesId.X]: [MoveId.A,…])
//   - ER:      whatever is already in er-egg-moves.json (the 198 hand-audited customs)
// ER entries win on the (rare) key collision. Run: node scripts/gen-egg-moves-json.mjs
import { existsSync, readFileSync, writeFileSync } from "node:fs";

const OUT = "src/data/elite-redux/er-egg-moves.json";
const read = p => readFileSync(p, "utf8");

const combined = {};

// 1) Vanilla: [SpeciesId.BULBASAUR]: [ MoveId.A, MoveId.B, … ]
{
  const t = read("src/data/balance/moves/egg-moves.ts");
  const re = /\[SpeciesId\.([A-Z0-9_]+)\]\s*:\s*\[([^\]]*)\]/g;
  let m;
  let n = 0;
  while ((m = re.exec(t)) !== null) {
    const moves = m[2]
      .split(",")
      .map(s => s.trim())
      .filter(Boolean)
      .map(s => s.replace(/^MoveId\./, ""));
    if (moves.length > 0) {
      combined[`SPECIES_${m[1]}`] = moves;
      n++;
    }
  }
  console.log(`vanilla: ${n} species`);
}

// 2) ER customs (already JSON) — overlay, ER wins on collision.
let erCount = 0;
if (existsSync(OUT)) {
  const er = JSON.parse(read(OUT));
  for (const [k, v] of Object.entries(er)) {
    combined[k] = v;
    erCount++;
  }
}
console.log(`ER (existing json): ${erCount} species`);

const sorted = Object.fromEntries(Object.entries(combined).sort(([a], [b]) => a.localeCompare(b)));
writeFileSync(OUT, `${JSON.stringify(sorted, null, 2)}\n`);
console.log(`wrote ${Object.keys(sorted).length} species → ${OUT}`);
