// Emits the per-batch worklists (spec section 6) from ~/er-probe/attr-inventory.json.
// Worklists only: this script never writes declarations, bindings, labels or probes.
//
// Usage: node scripts/decomp/make-worklists.mjs [inventory.json] [--check]
//
// Assignment rules:
//   1. Sort by file path, then by the line of the class in that file.
//   2. B01-B07: ab-attrs.ts by line, ranges of 30,30,30,30,30,29,29.
//   3. B08-B12: archetypes alphabetical by file, cut at file boundaries nearest to 1/5, 2/5, ... of the total.
//   4. B13 newcomer-signature-mechanics.ts; B14 the five named files (in that order); B15 the rest of
//      elite-redux/abilities/*; B16/B17 the file:null classes in inventory order, 25 + 25;
//      B18 ability-upgrades/attrs/* then ability-studio/runtime-components.ts.
//   5. The 10 classes with a golden precedent declaration are ranged first and then dropped from the entries; they
//      are listed in batches/precedents.json instead, so no class is done twice.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const args = process.argv.slice(2);
const inventoryPath = args.find(a => !a.startsWith("--")) ?? path.join(os.homedir(), "er-probe/attr-inventory.json");
const outDir = path.join(root, "src/data/elite-redux/ability-studio/decl/batches");
const precedentDir = path.join(root, "src/data/elite-redux/ability-studio/decl/precedents");

const inventory = JSON.parse(fs.readFileSync(inventoryPath, "utf8"));
const precedents = new Set(
  fs
    .readdirSync(precedentDir)
    .filter(f => f.endsWith(".decl.ts"))
    .map(f => f.replace(".decl.ts", "")),
);

const fileCache = new Map();
function lineOf(className, file) {
  if (file === null) {
    return null;
  }
  if (!fileCache.has(file)) {
    fileCache.set(file, fs.readFileSync(path.join(root, file), "utf8").split("\n"));
  }
  const re = new RegExp("^ *(export )?(default )?(abstract )?class " + className + "([^A-Za-z0-9_]|$)");
  const index = fileCache.get(file).findIndex(l => re.test(l));
  if (index < 0) {
    throw new Error(`class ${className} not found in ${file}`);
  }
  return index + 1;
}

const entries = inventory.map((e, order) => ({
  className: e.type,
  file: e.file,
  line: lineOf(e.type, e.file),
  uses: e.uses,
  abilities: e.abilities,
  order,
}));
const byFileLine = (a, b) => (a.file < b.file ? -1 : a.file > b.file ? 1 : a.line - b.line);

const batches = {};
const claimed = new Set();
function take(id, list) {
  batches[id] = list;
  for (const e of list) {
    if (claimed.has(e.className)) {
      throw new Error(`${e.className} assigned twice`);
    }
    claimed.add(e.className);
  }
}

const abAttrs = entries.filter(e => e.file === "src/data/abilities/ab-attrs.ts").sort(byFileLine);
let cursor = 0;
[30, 30, 30, 30, 30, 29, 29].forEach((n, i) => {
  take(`B0${i + 1}`, abAttrs.slice(cursor, cursor + n));
  cursor += n;
});
if (cursor !== abAttrs.length) {
  throw new Error(`ab-attrs.ts has ${abAttrs.length} classes, ranges cover ${cursor}`);
}

const archetypes = entries.filter(e => e.file?.startsWith("src/data/elite-redux/archetypes/")).sort(byFileLine);
const boundaries = [];
{
  let count = 0;
  for (let i = 0; i < archetypes.length; i++) {
    count++;
    if (i === archetypes.length - 1 || archetypes[i + 1].file !== archetypes[i].file) {
      boundaries.push(count);
    }
  }
}
const cuts = [0];
for (let k = 1; k < 5; k++) {
  const target = Math.round((archetypes.length * k) / 5);
  const best = boundaries.reduce((a, b) => (Math.abs(b - target) < Math.abs(a - target) ? b : a));
  cuts.push(best);
}
cuts.push(archetypes.length);
for (let i = 0; i < 5; i++) {
  take(`B${String(8 + i).padStart(2, "0")}`, archetypes.slice(cuts[i], cuts[i + 1]));
}

const abilitiesDir = "src/data/elite-redux/abilities/";
const newcomer = `${abilitiesDir}newcomer-signature-mechanics.ts`;
const b14Files = [
  "fakemon-pitch-mechanics.ts",
  "bernerd-roster-mechanics.ts",
  "fakemon-pitch-raichu.ts",
  "plusle-minun.ts",
  "electivire.ts",
].map(f => abilitiesDir + f);
const erAbilities = entries.filter(e => e.file?.startsWith(abilitiesDir));
take("B13", erAbilities.filter(e => e.file === newcomer).sort(byFileLine));
take(
  "B14",
  b14Files.flatMap(f => erAbilities.filter(e => e.file === f).sort(byFileLine)),
);
take("B15", erAbilities.filter(e => e.file !== newcomer && !b14Files.includes(e.file)).sort(byFileLine));

const unlocated = entries.filter(e => e.file === null).sort((a, b) => a.order - b.order);
take("B16", unlocated.slice(0, 25));
take("B17", unlocated.slice(25, 50));

take("B18", [
  ...entries.filter(e => e.file?.startsWith("src/data/elite-redux/ability-upgrades/attrs/")).sort(byFileLine),
  ...entries.filter(e => e.file === "src/data/elite-redux/ability-studio/runtime-components.ts").sort(byFileLine),
]);

// Verification: every inventory class in exactly one batch.
const missing = entries.filter(e => !claimed.has(e.className));
if (missing.length > 0 || claimed.size !== inventory.length) {
  throw new Error(`unassigned: ${missing.map(e => e.className).join(", ")}`);
}
for (const p of precedents) {
  if (!claimed.has(p)) {
    throw new Error(`precedent ${p} is not an inventory class`);
  }
}

fs.mkdirSync(outDir, { recursive: true });
const strip = ({ order: _o, ...rest }) => rest;
const precedentList = [];
let total = 0;
const counts = {};
for (const [id, list] of Object.entries(batches)) {
  const rangeSize = list.length;
  const work = list.filter(e => !precedents.has(e.className));
  precedentList.push(...list.filter(e => precedents.has(e.className)).map(e => ({ ...strip(e), batch: id })));
  fs.writeFileSync(
    path.join(outDir, `${id}.json`),
    `${JSON.stringify({ batch: id, classes: work.map(strip) }, null, 2)}\n`,
  );
  counts[id] = `${work.length}${work.length === rangeSize ? "" : ` (+${rangeSize - work.length} precedent)`}`;
  total += work.length;
}
fs.writeFileSync(
  path.join(outDir, "precedents.json"),
  `${JSON.stringify({ note: "Already declared by hand in decl/precedents/; excluded from every batch.", classes: precedentList }, null, 2)}\n`,
);
console.log(counts);
console.log(
  `batch entries ${total} + precedents ${precedentList.length} = ${total + precedentList.length} of ${inventory.length} inventory classes`,
);
