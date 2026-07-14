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
// Also generates:
//   editor/data/trainer-classes.json — every TrainerType enum name that ships a
//   BW sprite in the er-assets trainer dir ({name, sprite, genders}). Excludes
//   names with no sprite (they would render broken in-game). The er-assets dir
//   is resolved from $ER_ASSETS_DIR, then ../er-assets, then the local checkout.
//
// Run: node scripts/gen-editor-data.mjs   (re-run when moves change)
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

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

// Shiny Lab effect registry (editor/data/shiny-effects.json): the per-category
// effect option lists the Custom Trainers editor offers as a per-mon shiny-effect
// picker. Parsed STATICALLY from the game's registry source (PALETTE/SURFACE/
// AROUND_IDS + the LABELS/ACCENTS maps) — same "no TS import" style as the move
// list above — so the editor never diverges from ER_SHINY_LAB_EFFECTS_BY_CATEGORY.
{
  const src = read("src/data/elite-redux/er-shiny-lab-effects.ts");
  // Pull one `const NAME = [ "a", "b", ... ] as const;` id array by name.
  const idsOf = name => {
    const m = src.match(new RegExp(`const ${name}\\s*=\\s*\\[([\\s\\S]*?)\\]\\s*as const`));
    return m ? [...m[1].matchAll(/"([^"]+)"/g)].map(x => x[1]) : [];
  };
  // Pull a flat `const NAME: Record<string, string> = { key: "val", ... };` map.
  const mapOf = name => {
    const m = src.match(new RegExp(`const ${name}:\\s*Record<string, string>\\s*=\\s*\\{([\\s\\S]*?)\\n\\};`));
    const out = {};
    if (m) {
      for (const p of m[1].matchAll(/([A-Za-z0-9_]+):\s*"([^"]*)"/g)) {
        out[p[1]] = p[2];
      }
    }
    return out;
  };
  const LABELS = mapOf("LABELS");
  const ACCENTS = mapOf("ACCENTS");
  // Mirrors labelFor() + the ACCENTS per-category fallback in the game source.
  const labelFor = id => LABELS[id] ?? `${id.slice(0, 1).toUpperCase()}${id.slice(1)}`;
  const ACCENT_FALLBACK = { palette: "#5ad1ff", surface: "#ff7ad9", around: "#ffd27a" };
  const catFor = category =>
    idsOf(`${category.toUpperCase()}_IDS`).map(id => ({
      id,
      label: labelFor(id),
      accent: ACCENTS[id] ?? ACCENT_FALLBACK[category],
    }));
  const shinyEffects = { palette: catFor("palette"), surface: catFor("surface"), around: catFor("around") };
  const shinyTotal = shinyEffects.palette.length + shinyEffects.surface.length + shinyEffects.around.length;
  if (shinyTotal === 0) {
    throw new Error("gen-editor-data: parsed 0 shiny effects — registry format changed?");
  }
  writeFileSync("editor/data/shiny-effects.json", `${JSON.stringify(shinyEffects, null, 2)}\n`);
  console.log(
    `shiny-effects: ${shinyTotal} (${shinyEffects.palette.length} palette / ${shinyEffects.surface.length} surface / ${shinyEffects.around.length} around).`,
  );
}

writeFileSync("editor/data/moves.json", `${JSON.stringify(uniqueMoves, null, 2)}\n`);
console.log(`moves: ${uniqueMoves.length} (incl. ${erMoveCount} ER custom names)`);
console.log("species/items/trainers: run the dump tool (see header) — they come from the live runtime tables.");

// Trainer-class sprite catalog: every TrainerType enum name that ships a BW
// sprite in the er-assets trainer dir. `<lower>.png` → genders:false;
// `<lower>_m.png` → genders:true; neither → excluded (no sprite in-game).
{
  const ASSETS_DIR = (() => {
    const candidates = [
      process.env.ER_ASSETS_DIR,
      resolve(process.cwd(), "../er-assets"),
      "C:/Users/Hafida/pokerogue/.worktrees/er-assets",
    ].filter(Boolean);
    for (const c of candidates) {
      if (existsSync(resolve(c, "images/trainer"))) {
        return resolve(c, "images/trainer");
      }
    }
    return null;
  })();

  if (ASSETS_DIR) {
    const pngs = new Set(readdirSync(ASSETS_DIR).filter(f => f.endsWith(".png")));
    // Parse the TrainerType enum member names (skip the numeric reverse map).
    const tt = read("src/enums/trainer-type.ts");
    const body = tt.slice(tt.indexOf("{") + 1, tt.lastIndexOf("}"));
    const names = [];
    for (const line of body.split("\n")) {
      const m = line.match(/^\s*([A-Z][A-Z0-9_]+)\s*(?:=|,)/);
      if (m && m[1] !== "UNKNOWN") {
        names.push(m[1]);
      }
    }
    const classes = [];
    for (const name of names) {
      const lower = name.toLowerCase();
      if (pngs.has(`${lower}.png`)) {
        classes.push({ name, sprite: lower, genders: false });
      } else if (pngs.has(`${lower}_m.png`)) {
        classes.push({ name, sprite: lower, genders: true });
      }
    }
    writeFileSync("editor/data/trainer-classes.json", `${JSON.stringify(classes, null, 2)}\n`);
    console.log(`trainer-classes: ${classes.length} of ${names.length} TrainerType names have a sprite.`);
  } else {
    console.log("trainer-classes: SKIPPED — er-assets trainer dir not found (set ER_ASSETS_DIR).");
  }
}

// BGM catalog: every track that ships in the er-assets audio/bgm dir, so the
// Custom Trainers editor can offer a per-trainer BATTLE MUSIC picker. Each entry
// is { key, battle } where key = the filename without ".mp3" and battle =
// key.startsWith("battle_") (so battle themes can be listed first in the picker).
// The er-assets dir is resolved the same way as the trainer sprites above:
// $ER_ASSETS_DIR, then ../er-assets, then the local checkout.
{
  const BGM_DIR = (() => {
    const candidates = [
      process.env.ER_ASSETS_DIR,
      resolve(process.cwd(), "../er-assets"),
      "C:/Users/Hafida/pokerogue/.worktrees/er-assets",
    ].filter(Boolean);
    for (const c of candidates) {
      if (existsSync(resolve(c, "audio/bgm"))) {
        return resolve(c, "audio/bgm");
      }
    }
    return null;
  })();

  if (BGM_DIR) {
    const keys = readdirSync(BGM_DIR)
      .filter(f => f.endsWith(".mp3"))
      .map(f => f.slice(0, -".mp3".length))
      .sort();
    const bgm = keys.map(key => ({ key, battle: key.startsWith("battle_") }));
    writeFileSync("editor/data/bgm.json", `${JSON.stringify(bgm, null, 2)}\n`);
    const battleCount = bgm.filter(b => b.battle).length;
    console.log(`bgm: ${bgm.length} tracks (${battleCount} battle themes).`);
  } else {
    console.log("bgm: SKIPPED — er-assets audio/bgm dir not found (set ER_ASSETS_DIR).");
  }
}
