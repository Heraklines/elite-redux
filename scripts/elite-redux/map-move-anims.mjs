/*
 * SPDX-FileCopyrightText: 2026 Pagefault Games
 * SPDX-FileContributor: Sisyphus
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * Elite Redux Phase D6 — fallback-mapping for ER custom move battle animations.
 *
 * Background
 * ----------
 * ER v2.65 has ~187 custom moves (pokerogue ids ≥ 5000, see `er-move-id.ts`).
 * Vanilla pokerogue loads animation JSON via
 *   `./battle-anims/${toKebabCase(MoveId[move])}.json`
 * which evaluates to `./battle-anims/undefined.json` for ER ids because
 * `MoveId` only contains the vanilla enum. The vanilla loader then falls
 * back to `MoveId.TACKLE` / `FOCUS_ENERGY` / `TAIL_WHIP` for every ER move,
 * regardless of type or theme — every Fire/Ghost/Water custom plays Tackle.
 *
 * The full ER ROM source (`data/battle_anim_scripts.h`) is not available in
 * the vendor data dump (`vendor/elite-redux/v2.65beta.json` only carries
 * stats/flags, no anim scripts). Until/unless we extract from ER's C source,
 * this fallback mapper picks a thematically-appropriate vanilla anim per
 * ER move based on `(PokemonType, MoveCategory)` and clones its JSON into
 * `assets/battle-anims-er/<slug>.json`. The cloned anim inherits the
 * vanilla SFX references (PRSFX-*.wav) automatically.
 *
 * The runtime loader patch (see `src/data/battle-anims.ts`) detects
 * `move >= 5000` and resolves the slug via `ErMoveId` reverse-lookup, then
 * fetches from the ER subdirectory.
 *
 * Idempotent: re-runs overwrite the JSON deterministically — change the
 * mapping table, re-run, get fresh anims. Outputs are kebab-case slugs
 * matching the loader's `toKebabCase(ErMoveId[move])` convention.
 *
 * Usage:
 *   pnpm run er:map-move-anims          # write JSON files
 *   pnpm run er:map-move-anims -- --dry # report mappings without writing
 */

import { existsSync } from "node:fs";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "../..");
const VENDOR_PATH = resolve(ROOT, "vendor/elite-redux/v2.65beta.json");
const VANILLA_ANIMS_DIR = resolve(ROOT, "assets/battle-anims");
const ER_ANIMS_DIR = resolve(ROOT, "assets/battle-anims-er");
const ER_ID_MAP_PATH = resolve(ROOT, "src/data/elite-redux/er-id-map.ts");
const ER_MOVE_ID_PATH = resolve(ROOT, "src/enums/er-move-id.ts");

/** Pokerogue PokemonType enum ordinal — mirrors src/enums/pokemon-type.ts. */
export const PokemonType = Object.freeze({
  NORMAL: 0,
  FIGHTING: 1,
  FLYING: 2,
  POISON: 3,
  GROUND: 4,
  ROCK: 5,
  BUG: 6,
  GHOST: 7,
  STEEL: 8,
  FIRE: 9,
  WATER: 10,
  GRASS: 11,
  ELECTRIC: 12,
  PSYCHIC: 13,
  ICE: 14,
  DRAGON: 15,
  DARK: 16,
  FAIRY: 17,
  STELLAR: 18,
});

/** Pokerogue MoveCategory enum ordinal — mirrors src/enums/move-category.ts. */
export const MoveCategory = Object.freeze({
  PHYSICAL: 0,
  SPECIAL: 1,
  STATUS: 2,
});

/**
 * Map ER's numeric type id (0..20 — see `ER_TYPE_NAMES`) to pokerogue's
 * `PokemonType` ordinal. Mirrors `mapType()` in init-elite-redux-custom-moves.ts.
 *
 * ER's "Mystery" (18) and "None" (19) fall through to NORMAL.
 *
 * @param {number} erTypeId
 * @returns {number}
 */
export function mapErTypeToPokerogue(erTypeId) {
  switch (erTypeId) {
    case 0:
      return PokemonType.NORMAL;
    case 1:
      return PokemonType.FIGHTING;
    case 2:
      return PokemonType.FIRE;
    case 3:
      return PokemonType.ICE;
    case 4:
      return PokemonType.ELECTRIC;
    case 5:
      return PokemonType.BUG;
    case 6:
      return PokemonType.FLYING;
    case 7:
      return PokemonType.STEEL;
    case 8:
      return PokemonType.GRASS;
    case 9:
      return PokemonType.GROUND;
    case 10:
      return PokemonType.POISON;
    case 11:
      return PokemonType.DARK;
    case 12:
      return PokemonType.WATER;
    case 13:
      return PokemonType.PSYCHIC;
    case 14:
      return PokemonType.ROCK;
    case 15:
      return PokemonType.DRAGON;
    case 16:
      return PokemonType.GHOST;
    case 17:
      return PokemonType.FAIRY;
    case 20:
      return PokemonType.STELLAR;
    default:
      return PokemonType.NORMAL;
  }
}

/**
 * Map ER's split enum to pokerogue's MoveCategory. Mirrors `mapSplit()` in
 * init-elite-redux-custom-moves.ts. The 4 ER-only splits (3..6 —
 * USE_HIGHEST_OFFENSE, HITS_DEF, USE_HIGHEST_DAMAGE, HITS_SPDEF) collapse
 * to PHYSICAL for now.
 *
 * @param {number} erSplit
 * @returns {number}
 */
export function mapErSplitToCategory(erSplit) {
  switch (erSplit) {
    case 0:
      return MoveCategory.PHYSICAL;
    case 1:
      return MoveCategory.SPECIAL;
    case 2:
      return MoveCategory.STATUS;
    default:
      return MoveCategory.PHYSICAL;
  }
}

/**
 * Canonical vanilla-anim slug per `(PokemonType, MoveCategory)` cell. Picked
 * by hand to be visually representative of the type+category combo and
 * confirmed present in `assets/battle-anims/`.
 *
 * Physical = beam-of-light/contact, Special = projectile/aoe, Status =
 * self-aura/non-damaging. Where the natural pick isn't available, a close
 * second is used (e.g. PSYCHIC physical → "zen-headbutt").
 *
 * The fallback for unknown combos is "tackle" / "swift" / "tail-whip".
 *
 * @type {Record<string, string>}
 */
export const ANIM_BY_TYPE_CATEGORY = Object.freeze({
  // Normal
  "0|0": "body-slam", // NORMAL physical
  "0|1": "hyper-beam", // NORMAL special
  "0|2": "tail-whip", // NORMAL status
  // Fighting
  "1|0": "close-combat",
  "1|1": "focus-blast",
  "1|2": "bulk-up",
  // Fire
  "9|0": "flare-blitz",
  "9|1": "flamethrower",
  "9|2": "sunny-day",
  // Ice
  "14|0": "ice-fang",
  "14|1": "ice-beam",
  "14|2": "hail",
  // Electric
  "12|0": "thunder-punch",
  "12|1": "thunderbolt",
  "12|2": "charge",
  // Bug
  "6|0": "x-scissor",
  "6|1": "bug-buzz",
  "6|2": "string-shot",
  // Flying
  "2|0": "aerial-ace",
  "2|1": "air-slash",
  "2|2": "tailwind",
  // Steel
  "8|0": "iron-head",
  "8|1": "flash-cannon",
  "8|2": "iron-defense",
  // Grass
  "11|0": "leaf-blade",
  "11|1": "energy-ball",
  "11|2": "leech-seed",
  // Ground
  "4|0": "earthquake",
  "4|1": "earth-power",
  "4|2": "mud-sport",
  // Poison
  "3|0": "poison-jab",
  "3|1": "sludge-bomb",
  "3|2": "toxic",
  // Dark
  "16|0": "crunch",
  "16|1": "dark-pulse",
  "16|2": "taunt",
  // Water
  "10|0": "aqua-tail",
  "10|1": "hydro-pump",
  "10|2": "rain-dance",
  // Psychic
  "13|0": "zen-headbutt",
  "13|1": "psychic",
  "13|2": "calm-mind",
  // Rock
  "5|0": "stone-edge",
  "5|1": "power-gem",
  "5|2": "rock-polish",
  // Dragon
  "15|0": "outrage",
  "15|1": "draco-meteor",
  "15|2": "dragon-dance",
  // Ghost
  "7|0": "shadow-claw",
  "7|1": "shadow-ball",
  "7|2": "confuse-ray",
  // Fairy
  "17|0": "play-rough",
  "17|1": "moonblast",
  "17|2": "moonlight",
  // Stellar — no Tera Starstorm vanilla anim present; reuse cosmic/astral
  "18|0": "judgment",
  "18|1": "astral-barrage",
  "18|2": "cosmic-power",
});

/**
 * Hue rotation (0..360) per ER type — applied via the anim JSON's top-level
 * `hue` field so a Fire-type custom borrowing the Flamethrower frames doesn't
 * look identical to the source. Mostly a no-op (0) when the source vanilla
 * anim is already the right type, but useful for mismatched fallbacks.
 *
 * For now: hue = 0 across the board. Hue shifting can be wired per-type
 * later by inspecting source vs. target type and applying a delta.
 *
 * @type {Record<number, number>}
 */
export const TYPE_HUE_SHIFT = Object.freeze({
  // Keep at 0 — the AnimConfig.hue field shifts every frame's tint, which
  // is good for visual variety but bad for SFX/timing fidelity. Leaving
  // 0 as default; opt-in per-move tweaks happen in MANUAL_OVERRIDES below.
});

/**
 * Per-ER-move manual overrides — used when the (type, category) fallback
 * picks something obviously wrong. Maps `ErMoveId` enum key → vanilla anim
 * slug. Empty for now; extend as we audit individual moves.
 *
 * @type {Record<string, string>}
 */
export const MANUAL_OVERRIDES = Object.freeze({
  // Drain Brain (Psychic STATUS, draining) — vanilla psychic-status anim
  // is "calm-mind" which is self-buff. Use "dream-eater" which is the
  // closest Psychic "siphoning" anim.
  DRAIN_BRAIN: "dream-eater",
  // Eerie Fog (Ghost STATUS) — confuse-ray is the canonical Ghost status
  // anim and already in the table; no override.
  // Plasma Pulse (Electric SPECIAL) — thunderbolt is fine; keep.
  // Outburst (Normal SPECIAL, self-faint) — vanilla "explosion" is a
  // better match than hyper-beam.
  OUTBURST: "explosion",
  // Atomic Fire (Fire SPECIAL) — overheat conveys "all-in" better than
  // flamethrower.
  ATOMIC_FIRE: "overheat",
  // Plasma Pulse — keep thunderbolt; works.
});

/**
 * @typedef {object} ErMoveDump
 * @property {number} id        ER move id (0..1031)
 * @property {string} NAME      ER constant, e.g. "MOVE_OUTBURST"
 * @property {string} name      Display name
 * @property {number[]} types
 * @property {number} pwr
 * @property {number} acc
 * @property {number} split
 */

/**
 * Parse the ER move id enum from `src/enums/er-move-id.ts`. Returns a map
 * of `EnumKey → pokerogue id` for all entries (ids ≥ 5000).
 *
 * @param {string} source
 * @returns {Record<string, number>}
 */
export function parseErMoveIdEnum(source) {
  /** @type {Record<string, number>} */
  const out = {};
  const re = /^\s*([A-Z][A-Z0-9_]*):\s*(\d+)\s*,?\s*$/gm;
  let m;
  while ((m = re.exec(source)) !== null) {
    out[m[1]] = Number.parseInt(m[2], 10);
  }
  return out;
}

/**
 * Parse the ER id-map from `src/data/elite-redux/er-id-map.ts` and return
 * just the moves section as a `Record<erId, pokerogueId>`.
 *
 * @param {string} source
 * @returns {Record<number, number>}
 */
export function parseErIdMapMoves(source) {
  // Find the `"moves":` key and capture until the matching closing brace.
  const start = source.indexOf('"moves":');
  if (start < 0) {
    throw new Error('could not locate "moves": block in er-id-map.ts');
  }
  // The block is `"moves": { ... },` — walk braces.
  const openBrace = source.indexOf("{", start);
  let depth = 0;
  let end = -1;
  for (let i = openBrace; i < source.length; i++) {
    const ch = source[i];
    if (ch === "{") {
      depth++;
    } else if (ch === "}") {
      depth--;
      if (depth === 0) {
        end = i;
        break;
      }
    }
  }
  if (end < 0) {
    throw new Error("moves block in er-id-map.ts is unbalanced");
  }
  const block = source.slice(openBrace + 1, end);
  /** @type {Record<number, number>} */
  const out = {};
  const re = /"(\d+)":\s*(\d+)/g;
  let m;
  while ((m = re.exec(block)) !== null) {
    out[Number.parseInt(m[1], 10)] = Number.parseInt(m[2], 10);
  }
  return out;
}

/**
 * Convert a SCREAMING_SNAKE_CASE enum key to kebab-case. Matches the
 * runtime loader's `toKebabCase(MoveId[move])` output for vanilla moves.
 *
 * @param {string} key
 * @returns {string}
 */
export function toKebabCase(key) {
  return key.toLowerCase().replace(/_+/g, "-");
}

/**
 * Pick a vanilla anim slug for the given ER move draft. Order:
 *   1. MANUAL_OVERRIDES by ER enum key
 *   2. ANIM_BY_TYPE_CATEGORY by (pokerogue type, category)
 *   3. Generic fallback by category alone
 *
 * @param {{ erEnumKey: string, pokemonType: number, category: number }} input
 * @returns {{ slug: string, source: "manual" | "type-category" | "category-fallback" }}
 */
export function pickVanillaAnimSlug({ erEnumKey, pokemonType, category }) {
  if (MANUAL_OVERRIDES[erEnumKey]) {
    return { slug: MANUAL_OVERRIDES[erEnumKey], source: "manual" };
  }
  const tcKey = `${pokemonType}|${category}`;
  if (ANIM_BY_TYPE_CATEGORY[tcKey]) {
    return { slug: ANIM_BY_TYPE_CATEGORY[tcKey], source: "type-category" };
  }
  // Generic category fallback — should be very rare given the table covers
  // 0..17 × 0..2.
  const generic =
    category === MoveCategory.PHYSICAL ? "tackle" : category === MoveCategory.SPECIAL ? "swift" : "tail-whip";
  return { slug: generic, source: "category-fallback" };
}

/**
 * Load vanilla anim JSON and tweak it to be the ER move's clone. Returns
 * the modified anim object. The vanilla anim's `id` field is left intact —
 * pokerogue's AnimConfig doesn't index by it; it's informational.
 *
 * @param {string} vanillaSlug
 * @param {{ erEnumKey: string, erMoveName: string, hue: number }} ctx
 * @returns {Promise<unknown>}
 */
export async function buildAnimJsonFor(vanillaSlug, ctx) {
  const sourcePath = resolve(VANILLA_ANIMS_DIR, `${vanillaSlug}.json`);
  const raw = await readFile(sourcePath, "utf8");
  const parsed = JSON.parse(raw);

  // Vanilla anims are sometimes wrapped in an array (e.g. flamethrower.json)
  // for multi-target variants. Tag both halves with the override hue.
  if (Array.isArray(parsed)) {
    for (const a of parsed) {
      if (a && typeof a === "object" && ctx.hue !== 0) {
        a.hue = ctx.hue;
      }
    }
  } else if (parsed && typeof parsed === "object" && ctx.hue !== 0) {
    parsed.hue = ctx.hue;
  }
  return parsed;
}

/**
 * Discover available vanilla anim slugs by enumerating
 * `assets/battle-anims/*.json`. Used to validate that the mapping table
 * doesn't reference a missing source (e.g. a slug we typo'd).
 *
 * @returns {Promise<Set<string>>}
 */
async function listVanillaSlugs() {
  const files = await readdir(VANILLA_ANIMS_DIR);
  const out = new Set();
  for (const f of files) {
    if (f.endsWith(".json")) {
      out.add(f.slice(0, -5));
    }
  }
  return out;
}

/**
 * Driver. Reads ER moves dump + ER id-map + ER move id enum, picks vanilla
 * anims, writes JSON clones into `assets/battle-anims-er/`.
 *
 * @param {{ dryRun?: boolean }} [opts]
 * @returns {Promise<{
 *   written: number,
 *   skippedNoEnumKey: number,
 *   skippedNoVanillaAnim: number,
 *   byArchetype: Record<string, number>,
 *   samples: Array<{ erEnumKey: string, slug: string, source: string, vanilla: string }>,
 * }>}
 */
export async function mapMoveAnims(opts = {}) {
  const dryRun = !!opts.dryRun;
  const [vendorRaw, erIdMapSource, erMoveIdSource, vanillaSlugs] = await Promise.all([
    readFile(VENDOR_PATH, "utf8"),
    readFile(ER_ID_MAP_PATH, "utf8"),
    readFile(ER_MOVE_ID_PATH, "utf8"),
    listVanillaSlugs(),
  ]);
  const dump = JSON.parse(vendorRaw);
  const erMoveIdEnum = parseErMoveIdEnum(erMoveIdSource);
  const erMovesIdMap = parseErIdMapMoves(erIdMapSource);

  // pokerogueId → erEnumKey (for ER customs only)
  /** @type {Map<number, string>} */
  const pokerogueIdToEnumKey = new Map();
  for (const [key, id] of Object.entries(erMoveIdEnum)) {
    pokerogueIdToEnumKey.set(id, key);
  }

  // er-id → pokerogueId (ER customs only — id ≥ 5000)
  /** @type {Array<{ erId: number, pokerogueId: number }>} */
  const erCustoms = [];
  for (const [erIdStr, pokerogueId] of Object.entries(erMovesIdMap)) {
    if (pokerogueId >= 5000) {
      erCustoms.push({ erId: Number.parseInt(erIdStr, 10), pokerogueId });
    }
  }
  // Stable ordering by pokerogueId for deterministic output.
  erCustoms.sort((a, b) => a.pokerogueId - b.pokerogueId);

  if (!dryRun && !existsSync(ER_ANIMS_DIR)) {
    await mkdir(ER_ANIMS_DIR, { recursive: true });
  }

  const result = {
    written: 0,
    skippedNoEnumKey: 0,
    skippedNoVanillaAnim: 0,
    byArchetype: { manual: 0, "type-category": 0, "category-fallback": 0 },
    /** @type {Array<{ erEnumKey: string, slug: string, source: string, vanilla: string }>} */
    samples: [],
  };

  for (const { erId, pokerogueId } of erCustoms) {
    const enumKey = pokerogueIdToEnumKey.get(pokerogueId);
    if (!enumKey) {
      result.skippedNoEnumKey++;
      continue;
    }
    const draft = dump.moves.find(m => m.id === erId);
    if (!draft) {
      result.skippedNoEnumKey++;
      continue;
    }
    const pokemonType = mapErTypeToPokerogue(draft.types?.[0] ?? 0);
    const category = mapErSplitToCategory(draft.split ?? 0);

    const pick = pickVanillaAnimSlug({ erEnumKey: enumKey, pokemonType, category });

    if (!vanillaSlugs.has(pick.slug)) {
      // Table references something not on disk — warn and skip.
      console.warn(`[er:anims] skip ${enumKey}: vanilla anim "${pick.slug}.json" not found`);
      result.skippedNoVanillaAnim++;
      continue;
    }

    result.byArchetype[pick.source] = (result.byArchetype[pick.source] ?? 0) + 1;

    if (!dryRun) {
      const animJson = await buildAnimJsonFor(pick.slug, {
        erEnumKey: enumKey,
        erMoveName: draft.name,
        hue: TYPE_HUE_SHIFT[pokemonType] ?? 0,
      });
      const outPath = resolve(ER_ANIMS_DIR, `${toKebabCase(enumKey)}.json`);
      await writeFile(outPath, `${JSON.stringify(animJson, null, 2)}\n`, "utf8");
    }
    result.written++;

    if (result.samples.length < 12) {
      result.samples.push({
        erEnumKey: enumKey,
        slug: toKebabCase(enumKey),
        source: pick.source,
        vanilla: pick.slug,
      });
    }
  }

  return result;
}

/**
 * CLI entry. Parses `--dry` / `-n` flags.
 */
async function main() {
  const dryRun = process.argv.includes("--dry") || process.argv.includes("-n");
  console.log(`[er:anims] ${dryRun ? "DRY RUN — " : ""}mapping ER custom moves to vanilla anims…`);
  const result = await mapMoveAnims({ dryRun });
  console.log(`[er:anims] written: ${result.written}`);
  console.log(`[er:anims] skipped (no enum key): ${result.skippedNoEnumKey}`);
  console.log(`[er:anims] skipped (vanilla anim missing): ${result.skippedNoVanillaAnim}`);
  console.log(`[er:anims] by source: ${JSON.stringify(result.byArchetype)}`);
  console.log("[er:anims] samples:");
  for (const s of result.samples) {
    console.log(`  ${s.erEnumKey.padEnd(24)} → ${s.vanilla.padEnd(20)} [${s.source}]`);
  }
  if (!dryRun) {
    console.log(`[er:anims] output dir: ${ER_ANIMS_DIR}`);
  }
}

const isCliInvocation = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isCliInvocation) {
  main().catch(err => {
    console.error(err);
    process.exit(1);
  });
}
