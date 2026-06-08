// Generate the static data the team editor SPA needs, parsed from the game
// source (no TS import / build step):
//   editor/data/species.json — [{ const, name, slug }] for every egg-move species
//   editor/data/moves.json    — sorted list of all MoveId enum names
// Run: node scripts/gen-editor-data.mjs   (re-run when species/moves change)
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";

const read = p => readFileSync(p, "utf8");

// speciesConst -> sprite slug (for the icon)
const slugByConst = {};
{
  const t = read("src/data/elite-redux/er-sprite-manifest.ts");
  const re = /"speciesConst":\s*"(SPECIES_[A-Z0-9_]+)"[\s\S]*?"slug":\s*"([^"]+)"/g;
  let m;
  while ((m = re.exec(t)) !== null) {
    if (!(m[1] in slugByConst)) {
      slugByConst[m[1]] = m[2];
    }
  }
}

// speciesConst -> display name
const nameByConst = {};
{
  const t = read("src/data/elite-redux/er-species.ts");
  const re = /"speciesConst":\s*"(SPECIES_[A-Z0-9_]+)",\s*\n\s*"name":\s*"([^"]+)"/g;
  let m;
  while ((m = re.exec(t)) !== null) {
    if (!(m[1] in nameByConst)) {
      nameByConst[m[1]] = m[2];
    }
  }
}

const titleCase = c =>
  c
    .replace(/^SPECIES_/, "")
    .toLowerCase()
    .split("_")
    .map(w => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");

// Build species list from the egg-move keys (the editable set: vanilla + ER customs).
const eggMoves = JSON.parse(read("src/data/elite-redux/er-egg-moves.json"));
const species = Object.keys(eggMoves)
  .map(c => ({
    const: c,
    name: nameByConst[c] ?? titleCase(c),
    slug: slugByConst[c] ?? null,
  }))
  .sort((a, b) => a.name.localeCompare(b.name));

// Move enum-key style the game installs for ER custom moves (mirror of
// moveNameToEnumKey in init-elite-redux-custom-moves.ts).
const moveNameToEnumKey = name =>
  name
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");

// Move options = vanilla MoveId enum names ∪ ER custom move names. Both resolve
// in-game (see er-egg-moves.ts), so the picker can offer the full move pool.
const moves = [];
{
  // Vanilla: static MoveId enum members (skip numeric reverse-mapping).
  const t = read("src/enums/move-id.ts");
  const body = t.slice(t.indexOf("{") + 1, t.lastIndexOf("}"));
  for (const line of body.split("\n")) {
    const m = line.match(/^\s*([A-Z][A-Z0-9_]+)\s*(?:=|,)/);
    if (m) {
      moves.push(m[1]);
    }
  }
}
let erMoveCount = 0;
{
  // ER customs: enum-key derived from each draft's display name.
  const t = read("src/data/elite-redux/er-moves.ts");
  const re = /"name":\s*"([^"]+)"/g;
  let m;
  while ((m = re.exec(t)) !== null) {
    const key = moveNameToEnumKey(m[1]);
    if (key && key !== "NONE" && /^[A-Z]/.test(key)) {
      moves.push(key);
      erMoveCount++;
    }
  }
}
const uniqueMoves = [...new Set(moves)].sort();

mkdirSync("editor/data", { recursive: true });
writeFileSync("editor/data/species.json", `${JSON.stringify(species, null, 2)}\n`);
writeFileSync("editor/data/moves.json", `${JSON.stringify(uniqueMoves, null, 2)}\n`);
console.log(
  `species: ${species.length} (with slug: ${species.filter(s => s.slug).length})  `
    + `moves: ${uniqueMoves.length} (incl. ${erMoveCount} ER custom names)`,
);
