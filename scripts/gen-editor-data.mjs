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

// Ghost Trainer FX aura catalog (editor/data/trainer-fx.json): the aura effects the
// Custom Trainers editor offers as a per-trainer SPRITE effect picker. Parsed
// STATICALLY from TRAINER_AURA_EFFECTS in er-trainer-fx.ts (id + label), with the
// swatch accent pulled from the Shiny Lab ACCENTS map (each aura id is also an
// AROUND shiny id). Same "no TS import" style as the lists above, so the editor
// picker never diverges from the ghost FX catalog / isKnownTrainerAuraId whitelist.
{
  const fxSrc = read("src/data/elite-redux/er-trainer-fx.ts");
  const m = fxSrc.match(/TRAINER_AURA_EFFECTS[^=]*=\s*\[([\s\S]*?)\]\s*as const/);
  const auras = [];
  if (m) {
    for (const e of m[1].matchAll(/\{\s*id:\s*"([^"]+)",\s*label:\s*"([^"]+)"/g)) {
      auras.push({ id: e[1], label: e[2] });
    }
  }
  if (auras.length === 0) {
    throw new Error("gen-editor-data: parsed 0 trainer aura effects — er-trainer-fx.ts format changed?");
  }
  // Reuse the Shiny Lab ACCENTS map for the swatch colour (aura ids are AROUND ids).
  const shinySrc = read("src/data/elite-redux/er-shiny-lab-effects.ts");
  const accents = {};
  const accMatch = shinySrc.match(/const ACCENTS:\s*Record<string, string>\s*=\s*\{([\s\S]*?)\n\};/);
  if (accMatch) {
    for (const p of accMatch[1].matchAll(/([A-Za-z0-9_]+):\s*"([^"]*)"/g)) {
      accents[p[1]] = p[2];
    }
  }
  const AROUND_ACCENT_FALLBACK = "#ffd27a";
  const trainerFx = auras.map(a => ({ id: a.id, label: a.label, accent: accents[a.id] ?? AROUND_ACCENT_FALLBACK }));
  writeFileSync("editor/data/trainer-fx.json", `${JSON.stringify(trainerFx, null, 2)}\n`);
  console.log(`trainer-fx: ${trainerFx.length} aura effects.`);
}

// Held-item catalog (editor/data/held-items.json): the full set of enemy-legal
// held-item keys resolveHeldItemKey (src/system/llm-director/held-item-resolver.ts)
// can field, grouped by category so the Custom Trainers editor's held-item picker
// can offer them ergonomically. Four categories, parsed STATICALLY from the game
// source (same "no TS import" style as the lists above):
//   booster — the 18 ATTACK_TYPE_BOOSTER items (AttackTypeBoosterItem enum)
//   berry   — every BerryType as `<NAME>_BERRY`
//   gem     — the ER elemental gems (ER_*_GEM keys in modifier-type.ts)
//   utility — a curated set of fixed keyed items that make sense on an enemy
// The resolver is the source of truth at runtime; keys here MUST match the keys it
// accepts (booster item names, `<berry>_BERRY`, `ER_*_GEM`, plain fixed keys).
{
  // Title-case a SCREAMING_SNAKE key: "MYSTIC_WATER" -> "Mystic Water".
  const titleCase = key =>
    key
      .toLowerCase()
      .split("_")
      .filter(Boolean)
      .map(w => w.slice(0, 1).toUpperCase() + w.slice(1))
      .join(" ");
  const held = [];

  // booster: the AttackTypeBoosterItem enum (module-local in modifier-type.ts).
  {
    const src = read("src/modifier/modifier-type.ts");
    const m = src.match(/enum AttackTypeBoosterItem\s*\{([\s\S]*?)\}/);
    const names = m ? [...m[1].matchAll(/^\s*([A-Z][A-Z0-9_]+)\s*,?/gm)].map(x => x[1]) : [];
    for (const name of names) {
      held.push({ key: name, label: titleCase(name), category: "booster" });
    }
    if (names.length === 0) {
      throw new Error("gen-editor-data: parsed 0 type boosters — AttackTypeBoosterItem enum format changed?");
    }
  }

  // berry: BerryType enum members -> `<NAME>_BERRY`.
  {
    const src = read("src/enums/berry-type.ts");
    const m = src.match(/enum BerryType\s*\{([\s\S]*?)\}/);
    const names = m ? [...m[1].matchAll(/^\s*([A-Z][A-Z0-9_]+)\s*,?/gm)].map(x => x[1]) : [];
    for (const name of names) {
      held.push({ key: `${name}_BERRY`, label: `${titleCase(name)} Berry`, category: "berry" });
    }
    if (names.length === 0) {
      throw new Error("gen-editor-data: parsed 0 berries — BerryType enum format changed?");
    }
  }

  // gem: the ER elemental-gem keys registered in modifier-type.ts.
  {
    const src = read("src/modifier/modifier-type.ts");
    const keys = [...src.matchAll(/^\s*(ER_[A-Z]+_GEM):\s*\(\)\s*=>/gm)].map(x => x[1]);
    for (const key of [...new Set(keys)]) {
      // "ER_FIRE_GEM" -> "Fire Gem"; "ER_OMNI_GEM" -> "Omni Gem".
      held.push({ key, label: titleCase(key.replace(/^ER_/, "")), category: "gem" });
    }
    if (keys.length === 0) {
      throw new Error("gen-editor-data: parsed 0 elemental gems — ER_*_GEM registration format changed?");
    }
  }

  // utility: curated fixed keyed items (mirrors the resolver's plain-key path).
  // SILK_SCARF is intentionally absent here — it lives in the booster category.
  const UTILITY_KEYS = [
    "LEFTOVERS",
    "SHELL_BELL",
    "FOCUS_BAND",
    "QUICK_CLAW",
    "KINGS_ROCK",
    "WIDE_LENS",
    "SCOPE_LENS",
    "GRIP_CLAW",
    "TOXIC_ORB",
    "FLAME_ORB",
    "BATON",
    "SOOTHE_BELL",
    "SOUL_DEW",
    "MYSTICAL_ROCK",
    "GOLDEN_PUNCH",
    "BERRY_POUCH",
    "EVIOLITE",
    "LUCKY_EGG",
    "GOLDEN_EGG",
    "REVIVER_SEED",
    "MULTI_LENS",
  ];
  for (const key of UTILITY_KEYS) {
    held.push({ key, label: titleCase(key), category: "utility" });
  }

  writeFileSync("editor/data/held-items.json", `${JSON.stringify(held, null, 2)}\n`);
  const byCat = held.reduce((acc, h) => ((acc[h.category] = (acc[h.category] || 0) + 1), acc), {});
  console.log(
    `held-items: ${held.length} (${byCat.booster} booster / ${byCat.berry} berry / ${byCat.gem} gem / ${byCat.utility} utility).`,
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
