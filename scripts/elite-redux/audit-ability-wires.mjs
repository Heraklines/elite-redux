// #103 audit resolver: for every ER custom ability, determine its LIVE wire
// source and flag genuine gaps (no-ops / approximations). Accounts for the real
// dispatch routing so it does NOT produce false positives:
//   dispatchArchetypeInternal: if archetype !== "bespoke" -> typed archetype wire
//                              else -> dispatchBespoke(id)
//   dispatchBespoke: dispatchBespokeR48(id) FIRST (wins if non-null), else main switch
//
// Output: a categorized worklist (no-ops, bespoke approximations) + counts.
// Usage: node scripts/elite-redux/audit-ability-wires.mjs
import { readFileSync } from "node:fs";

const SRC = "src/data/elite-redux/archetype-dispatcher.ts";
const ARCH = "src/data/elite-redux/er-ability-archetypes.ts";
const BETA = "vendor/elite-redux/v2.65beta.json";

const src = readFileSync(SRC, "utf8").split("\n");
const archTxt = readFileSync(ARCH, "utf8");
const beta = JSON.parse(readFileSync(BETA, "utf8"));
const byId = Object.fromEntries(beta.abilities.map(a => [a.id, a]));

// ER id -> pokerogue AbilityId. Ids < 5000 are vanilla pokerogue abilities
// (implemented by the base game, NOT the ER dispatcher); ids >= 5000 are
// ER-custom and must be wired by us. Parse the "abilities" section of er-id-map.
const idMapTxt = readFileSync("src/data/elite-redux/er-id-map.ts", "utf8").split("\n");
const abilStart = idMapTxt.findIndex(l => /^\s*"abilities":\s*\{/.test(l));
const pkrgIdOf = {};
for (let i = abilStart + 1; i < idMapTxt.length; i++) {
  if (/^\s*\},?\s*$/.test(idMapTxt[i])) {
    break;
  }
  const m = idMapTxt[i].match(/^\s*"(\d+)":\s*(\d+)/);
  if (m) {
    pkrgIdOf[+m[1]] = +m[2];
  }
}

// 1. Parse archetype per id from er-ability-archetypes.ts.
const archetypeOf = {};
for (const m of archTxt.matchAll(/^\s*(\d+):\s*\{\s*erAbilityId:\s*\d+,\s*archetype:\s*"([^"]+)"/gm)) {
  archetypeOf[+m[1]] = m[2];
}

// 2. Parse the two bespoke switches.
const r48Start = src.findIndex(l => /function dispatchBespokeR48/.test(l));
const mainStart = src.findIndex(l => /export function dispatchBespoke\(/.test(l));
// main switch spans mainStart..r48Start; R48 spans r48Start..end.
function caseReturnKind(lo, hi) {
  // map id -> "skip" | "ok" based on the FIRST occurrence in [lo,hi)
  const res = {};
  let id = null;
  let bodyStart = -1;
  for (let i = lo; i < hi && i < src.length; i++) {
    const m = src[i].match(/^\s*case (\d+):/);
    if (m) {
      id = +m[1];
      bodyStart = i;
      continue;
    }
    if (id != null && /return\s/.test(src[i]) && i >= bodyStart) {
      if (!(id in res)) {
        res[id] = /SKIP_BESPOKE|return skip\(|return ok\(\[\]\)/.test(src[i]) ? "skip" : "ok";
      }
      id = null;
    }
  }
  return res;
}
const mainKind = caseReturnKind(mainStart, r48Start);
const r48Kind = caseReturnKind(r48Start, src.length);

// 3. Resolve live wire per ER ability id (268..1033).
const noops = [];
const wired = [];
for (let id = 268; id <= 1033; id++) {
  const a = byId[id];
  if (!a) {
    continue;
  }
  const arch = archetypeOf[id];
  // bespoke route: R48 first, else main; non-bespoke archetypes wire directly.
  let live;
  if (arch && arch !== "bespoke") {
    live = `archetype:${arch}`;
  } else if (r48Kind[id]) {
    live = `R48:${r48Kind[id]}`;
  } else if (mainKind[id]) {
    live = `main:${mainKind[id]}`;
  } else {
    live = "UNHANDLED"; // archetype bespoke but no case anywhere -> default skip
  }
  const pkrg = pkrgIdOf[id];
  // Vanilla-mapped ids (< 5000) are implemented by base pokerogue, not us.
  const isVanilla = pkrg != null && pkrg < 5000;
  const isNoop = !isVanilla && (live === "main:skip" || live === "R48:skip" || live === "UNHANDLED");
  if (isNoop) {
    noops.push({ id, pkrg, name: a.name, desc: a.desc, live });
  } else {
    wired.push(id);
  }
}

console.log(
  `ER abilities 268-1033: ${noops.length + wired.length}  | wired: ${wired.length}  | NO-OP: ${noops.length}\n`,
);
console.log("=== GENUINE NO-OP abilities (live wire skips / unhandled) ===");
for (const n of noops) {
  console.log(`${n.id} [${n.live}] ${n.name}: ${n.desc}`);
}
