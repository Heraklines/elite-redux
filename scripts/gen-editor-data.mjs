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
  for (let m = re.exec(t); m !== null; m = re.exec(t)) {
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
  const byCat = held.reduce((acc, h) => {
    acc[h.category] = (acc[h.category] || 0) + 1;
    return acc;
  }, {});
  console.log(
    `held-items: ${held.length} (${byCat.booster} booster / ${byCat.berry} berry / ${byCat.gem} gem / ${byCat.utility} utility).`,
  );
}

// Challenge VALUE option lists (editor/data/challenge-values.json): for each
// value-bearing challenge kind the Custom Trainers editor exposes, the human
// options mapped to the GAME's numeric value encoding (see challenge.ts). Keyed
// by the editor's ErCustomTrainerChallenge key. Where the game defines the label
// table (types / colors / the RDX gen constant) it is parsed STATICALLY; the
// small fixed numeric semantics (starter-cost/points/support/passives/fresh
// start, defined only by challenge.ts logic) carry generator-authored labels.
{
  const titleCase = key =>
    key
      .toLowerCase()
      .split("_")
      .filter(Boolean)
      .map(w => w.slice(0, 1).toUpperCase() + w.slice(1))
      .join(" ");

  // SINGLE_TYPE: value = PokemonType index + 1 (NORMAL..FAIRY = 1..18). Parse the
  // PokemonType enum in file order, drop UNKNOWN(-1), and take NORMAL..FAIRY.
  const typeSrc = read("src/enums/pokemon-type.ts");
  const typeBody = typeSrc.slice(typeSrc.indexOf("{") + 1, typeSrc.lastIndexOf("}"));
  const typeNames = [];
  for (const line of typeBody.split("\n")) {
    const m = line.match(/^\s*([A-Z][A-Z0-9_]+)\s*(?:=|,)/);
    if (m && m[1] !== "UNKNOWN") {
      typeNames.push(m[1]);
    }
  }
  // NORMAL is value 0, so index in this filtered list == PokemonType value;
  // challengeValue = value + 1. FAIRY (index 17) is the last selectable (max 18);
  // STELLAR and beyond are not part of the SINGLE_TYPE range.
  const monotype = typeNames.slice(0, 18).map((name, i) => ({ value: i + 1, label: titleCase(name) }));

  // MONO_COLOR: value = color index + 1 (ER_COLOR_NAMES order).
  const colorSrc = read("src/data/elite-redux/er-species-colors.ts");
  const colorMatch = colorSrc.match(/ER_COLOR_NAMES\s*=\s*\[([\s\S]*?)\]/);
  const colorNames = colorMatch ? [...colorMatch[1].matchAll(/"([^"]+)"/g)].map(x => x[1]) : [];
  const monocolor = colorNames.map((name, i) => ({ value: i + 1, label: titleCase(name) }));

  // SINGLE_GENERATION: value = the gen number directly (1..9), plus the ER pseudo-
  // gen RDX = ER_RDX_CHALLENGE_GEN (parsed from challenge.ts).
  const challSrc = read("src/data/challenge.ts");
  const rdxMatch = challSrc.match(/ER_RDX_CHALLENGE_GEN\s*=\s*(\d+)/);
  const rdxGen = rdxMatch ? Number(rdxMatch[1]) : 10;
  const monogen = [];
  for (let g = 1; g <= 9; g++) {
    monogen.push({ value: g, label: `Gen ${g}` });
  }
  monogen.push({ value: rdxGen, label: "RDX (Elite Redux)" });

  // USAGE_TIER: value = tier (1=UU, 2=RU, 3=PU, 4=NU; see challenge.ts / #384).
  const usagetier = [
    { value: 1, label: "UU" },
    { value: 2, label: "RU" },
    { value: 3, label: "PU" },
    { value: 4, label: "NU" },
  ];
  // LOWER_MAX_STARTER_COST / LOWER_STARTER_POINTS: value = amount subtracted from
  // the default 10; the run displays 10 - value. 1..9.
  const maxcost = [];
  const points = [];
  for (let v = 1; v <= 9; v++) {
    maxcost.push({ value: v, label: `Max cost ${10 - v}` });
    points.push({ value: v, label: `${10 - v} points` });
  }
  // LIMITED_SUPPORT / PASSIVES / FRESH_START: small fixed mode enums (challenge.ts).
  const limitedsupport = [
    { value: 1, label: "No healing (shop on)" },
    { value: 2, label: "No shop (healing on)" },
    { value: 3, label: "No support (neither)" },
  ];
  const passives = [
    { value: 1, label: "Trainers & final boss only" },
    { value: 2, label: "All Pokemon" },
  ];
  const freshstart = [
    { value: 1, label: "Classic" },
    { value: 2, label: "Elite Redux" },
  ];

  const challengeValues = {
    monotype,
    monogen,
    monocolor,
    maxcost,
    points,
    usagetier,
    limitedsupport,
    passives,
    freshstart,
  };
  if (monotype.length === 0 || monocolor.length === 0) {
    throw new Error("gen-editor-data: parsed 0 challenge types/colors — enum format changed?");
  }
  writeFileSync("editor/data/challenge-values.json", `${JSON.stringify(challengeValues, null, 2)}\n`);
  console.log(
    `challenge-values: ${monotype.length} types / ${monocolor.length} colors / ${monogen.length} gens (RDX=${rdxGen}) / ${Object.keys(challengeValues).length} kinds.`,
  );
}

// Named challenge PRESETS (editor/data/challenge-presets.json): named challenge
// configurations {name, challenge, challengeValue} extracted from the ACHIEVEMENT
// catalog. Only achievements defined by a SINGLE {challenge kind, value} config
// are derivable (a `ChallengeAchv` whose predicate is `c instanceof <Single*
// Challenge> && c.value === N`) - the themed mono-type / mono-gen runs. Multi-
// challenge STACKS (e.g. Monochrome Requiem = Monocolor + Nuzlocke, the apex
// Inferno/Cocytus stacks = SingleType + Doubles + Ghost) carry no single value and
// are SKIPPED (reported in the console count). The human name is the achievement's
// localized display name (locales/en/achv.json[<key>].name). Static parse only.
{
  const achvSrc = read("src/system/achv.ts");
  const achvNames = JSON.parse(read("locales/en/achv.json"));
  // The ER mono-gen "RDX" pseudo-generation constant (value used by the RDX achv).
  const rdxMatch = achvSrc.match(/ER_RDX_CHALLENGE_GEN\s*=\s*(\d+)/);
  const rdxGen = rdxMatch ? Number(rdxMatch[1]) : 10;
  const CLASS_TO_KIND = { SingleTypeChallenge: "monotype", SingleGenerationChallenge: "monogen" };
  const presets = [];
  // Each `new ChallengeAchv("<localeKey>", ... c => ... c instanceof <Class> &&
  // c.value === <N|ER_RDX_CHALLENGE_GEN> ...)` yields ONE {name, challenge, value}.
  // The `(?!new ChallengeAchv\()` guard stops the gap from crossing INTO the next
  // constructor, so a non-mono achv's name can't grab a later mono achv's predicate
  // (which would shift every name by one).
  const re =
    /new ChallengeAchv\(\s*"([^"]+)"(?:(?!new ChallengeAchv\()[\s\S])*?c instanceof (SingleTypeChallenge|SingleGenerationChallenge)\s*&&\s*c\.value === (\w+)/g;
  for (let m = re.exec(achvSrc); m !== null; m = re.exec(achvSrc)) {
    const [, localeKey, className, rawValue] = m;
    const kind = CLASS_TO_KIND[className];
    if (!kind) {
      continue;
    }
    const value = rawValue === "ER_RDX_CHALLENGE_GEN" ? rdxGen : Number(rawValue);
    if (!Number.isInteger(value) || value < 1) {
      continue;
    }
    const name = achvNames[localeKey]?.name ? achvNames[localeKey].name : localeKey;
    presets.push({ name, challenge: kind, challengeValue: value });
  }
  // Stable order: by challenge kind, then value.
  presets.sort((a, b) => a.challenge.localeCompare(b.challenge) || a.challengeValue - b.challengeValue);
  if (presets.length === 0) {
    throw new Error("gen-editor-data: parsed 0 challenge presets — ChallengeAchv format changed?");
  }
  writeFileSync("editor/data/challenge-presets.json", `${JSON.stringify(presets, null, 2)}\n`);
  const monoType = presets.filter(p => p.challenge === "monotype").length;
  const monoGen = presets.filter(p => p.challenge === "monogen").length;
  console.log(
    `challenge-presets: ${presets.length} (${monoType} mono-type / ${monoGen} mono-gen incl. RDX). Skipped multi-challenge stacks (Monochrome Requiem, apex Inferno/Cocytus/Giudecca) - no single {kind,value}.`,
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
// keeps any source/license metadata already authored in editor/data/bgm.json;
// scanning only adds missing files and removes catalog rows whose MP3 disappeared.
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
    let existing = [];
    if (existsSync("editor/data/bgm.json")) {
      try {
        existing = JSON.parse(read("editor/data/bgm.json"));
      } catch {
        console.warn("bgm: existing catalog is invalid JSON; rebuilding basic entries.");
      }
    }
    const existingByKey = new Map(
      existing.filter(entry => entry && typeof entry.key === "string").map(entry => [entry.key, entry]),
    );
    const bgm = keys.map(key => ({ ...existingByKey.get(key), key, battle: key.startsWith("battle_") }));
    writeFileSync("editor/data/bgm.json", `${JSON.stringify(bgm, null, 2)}\n`);
    const battleCount = bgm.filter(b => b.battle).length;
    console.log(`bgm: ${bgm.length} tracks (${battleCount} battle themes).`);
  } else {
    console.log("bgm: SKIPPED — er-assets audio/bgm dir not found (set ER_ASSETS_DIR).");
  }
}
