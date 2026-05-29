// #103 (moves) audit resolver: for every ER custom move, resolve whether its
// special EFFECT is wired. The move dispatcher wires typed archetypes and returns
// SKIP_BESPOKE for archetype "bespoke" entries (base stats — power/acc/pp/type —
// are still set at registration; only the special effect is missing). Filters out
// vanilla-mapped ids (<5000, implemented by base pokerogue).
// Usage: node scripts/elite-redux/audit-move-wires.mjs
import { readFileSync } from "node:fs";

const beta = JSON.parse(readFileSync("vendor/elite-redux/v2.65beta.json", "utf8"));
const byId = Object.fromEntries((beta.moves ?? []).map(m => [m.id, m]));

// archetype per ER move id
const archTxt = readFileSync("src/data/elite-redux/er-move-archetypes.ts", "utf8");
const archetypeOf = {};
for (const m of archTxt.matchAll(/^\s*(\d+):\s*\{\s*erMoveId:\s*\d+,\s*archetype:\s*"([^"]+)"/gm)) {
  archetypeOf[+m[1]] = m[2];
}

// ER move id -> pokerogue MoveId (ids <5000 are vanilla, implemented by base game)
const idMap = readFileSync("src/data/elite-redux/er-id-map.ts", "utf8").split("\n");
const movesStart = idMap.findIndex(l => /^\s*"moves":\s*\{/.test(l));
const pkrgIdOf = {};
for (let i = movesStart + 1; i < idMap.length; i++) {
  if (/^\s*\},?\s*$/.test(idMap[i])) {
    break;
  }
  const m = idMap[i].match(/^\s*"(\d+)":\s*(\d+)/);
  if (m) {
    pkrgIdOf[+m[1]] = +m[2];
  }
}

const gaps = [];
let wired = 0;
let vanilla = 0;
for (const idStr of Object.keys(archetypeOf)) {
  const id = +idStr;
  const pkrg = pkrgIdOf[id];
  if (pkrg != null && pkrg < 5000) {
    vanilla++;
    continue;
  }
  if (archetypeOf[id] === "bespoke") {
    const m = byId[id];
    gaps.push({ id, pkrg, name: m?.name ?? "?", desc: m?.desc ?? "?" });
  } else {
    wired++;
  }
}

console.log(`ER custom moves with archetype entries: ${Object.keys(archetypeOf).length}`);
console.log(
  `  effect-wired (typed archetype): ${wired} | vanilla-mapped: ${vanilla} | bespoke effect-UNWIRED: ${gaps.length}\n`,
);
console.log("=== bespoke moves needing effect wiring (base stats OK) ===");
for (const g of gaps.sort((a, b) => a.id - b.id)) {
  console.log(`${g.id}  ${g.name}: ${g.desc}`);
}
