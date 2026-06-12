// Generate the static MOVE data the team editor SPA needs, parsed from the
// game source (no TS import / build step):
//   editor/data/moves.json — sorted list of all MoveId enum names + ER customs
//
// NOTE: editor/data/species.json (plus items.json / trainers.json) is NOT
// generated here anymore. The old approach built the species list from the
// er-egg-moves.json keys, so any starter-selectable species WITHOUT an
// egg-move entry silently never appeared in the editor. The roster now comes
// from the LIVE runtime tables via the dump tool:
//   ER_SCENARIO=1 npx vitest run test/tests/elite-redux/tools/dump-editor-data.test.ts
//
// Run: node scripts/gen-editor-data.mjs   (re-run when moves change)
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";

const read = p => readFileSync(p, "utf8");

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
writeFileSync("editor/data/moves.json", `${JSON.stringify(uniqueMoves, null, 2)}\n`);
console.log(`moves: ${uniqueMoves.length} (incl. ${erMoveCount} ER custom names)`);
console.log("species/items/trainers: run the dump tool (see header) — they come from the live runtime tables.");
