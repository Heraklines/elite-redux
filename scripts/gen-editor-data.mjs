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

// Build species list from the egg-move keys (the editable set).
const eggMoves = JSON.parse(read("src/data/elite-redux/er-egg-moves.json"));
const species = Object.keys(eggMoves)
  .map(c => ({
    const: c,
    name: nameByConst[c] ?? c.replace(/^SPECIES_/, "").replace(/_/g, " "),
    slug: slugByConst[c] ?? null,
  }))
  .sort((a, b) => a.name.localeCompare(b.name));

// All MoveId enum member names (skip the numeric reverse-mapping + NONE-likes).
const moves = [];
{
  const t = read("src/enums/move-id.ts");
  const body = t.slice(t.indexOf("{") + 1, t.lastIndexOf("}"));
  for (const line of body.split("\n")) {
    const m = line.match(/^\s*([A-Z][A-Z0-9_]+)\s*(?:=|,)/);
    if (m) {
      moves.push(m[1]);
    }
  }
}
const uniqueMoves = [...new Set(moves)].sort();

mkdirSync("editor/data", { recursive: true });
writeFileSync("editor/data/species.json", `${JSON.stringify(species, null, 2)}\n`);
writeFileSync("editor/data/moves.json", `${JSON.stringify(uniqueMoves, null, 2)}\n`);
console.log(
  `species: ${species.length} (with slug: ${species.filter(s => s.slug).length})  moves: ${uniqueMoves.length}`,
);
