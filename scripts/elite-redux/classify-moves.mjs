/*
 * SPDX-FileCopyrightText: 2025-2026 Pagefault Games
 * SPDX-FileContributor: Sisyphus
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * Elite Redux Phase C task C3: classify the 187 ER-custom moves into the
 * move-relevant archetype primitives.
 *
 * For each move with `archetype: "unknown"` in
 * `src/data/elite-redux/er-moves.ts`, this script runs the description
 * (description + longDescription joined) through an ordered list of
 * classifiers. The first matching classifier claims the entry; unmatched
 * entries fall through to the `bespoke` bucket.
 *
 * Move-relevant archetypes (most of the 23 ability archetypes are
 * ability-only — many moves are either pure flag-tagged moves or carry a
 * status-chance proc):
 *   - `flag-tagged-move`     — recognises an ER flag suffix in the desc
 *     ("Strong Jaw boost", "Mega Launcher boost", "Hammer-based", …). The
 *     boost itself is an *ability*-side multiplier; the move-side metadata
 *     is just the flag bit. Data-only — no new MoveAttr class needed.
 *   - `chance-status-on-hit` — `"N% chance to STATUS"`-style procs that
 *     vanilla `StatusEffectAttr` already covers; we surface the chance +
 *     status so wiring can pass it through.
 *   - `type-conversion`      — moves whose type changes contextually
 *     (e.g. "Fire or Ground based on effectiveness").
 *   - `conditional-damage`   — "x1.5 power vs statused foe", "double damage
 *     on Dragons", "deals 2x damage to sleeping foes", etc.
 *   - `recoil-or-drain`      — "33% recoil damage" / "Heals 50% of damage
 *     done" attached to a move.
 *   - `bespoke`              — the long tail of unique move mechanics.
 *
 * Emits `src/data/elite-redux/er-move-archetypes.ts` mapping
 * `erMoveId → { archetype, params }`. The actual wiring into `allMoves`
 * (configuring `Move` instances via archetype data) is deferred to a
 * follow-up task — C3 just builds the data table.
 *
 * Prints a per-archetype coverage report to stdout.
 */

import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { emitModule } from "./lib/emit.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "../..");
const MOVES_PATH = resolve(ROOT, "src/data/elite-redux/er-moves.ts");
const OUT_PATH = resolve(ROOT, "src/data/elite-redux/er-move-archetypes.ts");

// =============================================================================
// Domain vocabulary — mirror C2's tables. Moves use the same status/type/flag
// names but a smaller subset of the surface area.
// =============================================================================

const TYPE_NAMES = [
  "fire",
  "water",
  "grass",
  "electric",
  "elec",
  "ice",
  "fighting",
  "fight",
  "poison",
  "ground",
  "flying",
  "psychic",
  "bug",
  "rock",
  "ghost",
  "dragon",
  "dark",
  "steel",
  "fairy",
  "normal",
];
const TYPE_RE_SRC = TYPE_NAMES.join("|");

const STATUS_NAME_MAP = {
  burn: "BURN",
  burns: "BURN",
  burned: "BURN",
  burning: "BURN",
  paralyze: "PARALYSIS",
  paralyzes: "PARALYSIS",
  paralyzed: "PARALYSIS",
  paralysis: "PARALYSIS",
  paralyses: "PARALYSIS",
  "badly poison": "TOXIC",
  "badly poisoned": "TOXIC",
  "badly poisons": "TOXIC",
  toxic: "TOXIC",
  poison: "POISON",
  poisons: "POISON",
  poisoned: "POISON",
  poisoning: "POISON",
  sleep: "SLEEP",
  sleeps: "SLEEP",
  asleep: "SLEEP",
  sleeping: "SLEEP",
  freeze: "FREEZE",
  freezes: "FREEZE",
  frozen: "FREEZE",
  frostbite: "FROSTBITE",
  frostbites: "FROSTBITE",
  frostbitten: "FROSTBITE",
  confuse: "CONFUSION",
  confuses: "CONFUSION",
  confused: "CONFUSION",
  confusion: "CONFUSION",
  infatuate: "INFATUATION",
  infatuates: "INFATUATION",
  infatuated: "INFATUATION",
  infatuation: "INFATUATION",
  drowsy: "DROWSY",
  bleed: "BLEED",
  bleeds: "BLEED",
  bleeding: "BLEED",
  flinch: "FLINCH",
  flinches: "FLINCH",
  flinching: "FLINCH",
  fear: "FEAR",
  curse: "CURSE",
  drench: "DRENCH",
  "leech seed": "LEECH_SEED",
};

// ER-specific move-flag suffixes ("X boost"/"X-based") used to mark moves
// that benefit from a sibling ability multiplier. Mirrors C2's FLAG_NAME_MAP
// but is move-side: these are the SHAPES we look for in descriptions, not
// the abilities themselves.
const MOVE_FLAG_MAP = {
  "strong jaw": "STRONG_JAW",
  "keen edge": "KEEN_EDGE",
  "mega launcher": "MEGA_LAUNCHER",
  "iron fist": "IRON_FIST",
  "mighty horn": "MIGHTY_HORN",
  "might horn": "MIGHTY_HORN", // "Might Horn boost" — Elite Redux typo in Fire Glaive
  archer: "ARROW",
  arrow: "ARROW",
  striker: "STRIKER",
  "super slammer": "HAMMER_BASED",
  "hammer-based": "HAMMER_BASED",
  "hammer based": "HAMMER_BASED",
  "sound-based": "SOUND_BASED",
  "sound based": "SOUND_BASED",
  "bone-based": "BONE_BASED",
  "bone based": "BONE_BASED",
  "air-based": "AIR_BASED",
  "air based": "AIR_BASED",
  "horn-based": "MIGHTY_HORN",
  "dance move": "DANCE_MOVE",
  "wind move": "WIND_MOVE",
};

// =============================================================================
// Token-extraction helpers
// =============================================================================

/** @param {string} s */
function normalizeType(s) {
  const key = (s ?? "").toLowerCase().replace(/\.$/, "").trim();
  if (key === "elec" || key === "elec.") {
    return "ELECTRIC";
  }
  if (key === "fight") {
    return "FIGHTING";
  }
  return key.toUpperCase();
}

/** @param {string} s */
function normalizeStatus(s) {
  return STATUS_NAME_MAP[(s ?? "").toLowerCase().trim()] ?? null;
}

/** Parse a 'N%' string into a 0-1 fraction. */
function parsePercent(s) {
  const m = String(s).match(/^([\d.]+)\s*%?$/);
  if (!m) {
    return null;
  }
  const v = Number(m[1]);
  return Number.isFinite(v) ? v / 100 : null;
}

/**
 * Build the searchable description for a move. We prefer `longDescription`
 * because it usually carries the flag suffix (description is truncated in
 * the UI), but fall back to `description` when longDescription is empty.
 * @param {ErMoveDraft} move
 */
function getDesc(move) {
  const long = (move.longDescription ?? "").trim();
  const short = (move.description ?? "").trim();
  if (long.length === 0) {
    return short;
  }
  if (short.length === 0) {
    return long;
  }
  // Some ER moves use the long description as a strict superset; others
  // carry distinct info in each. Concatenate to ensure both surfaces are
  // searchable, with a separator that doesn't accidentally form new tokens.
  return `${short} || ${long}`;
}

// =============================================================================
// Classifiers — ordered list. First matching wins. Each `test` runs against
// the description; if it returns truthy, `extract` builds the params object.
// `extract` returning null/undefined still claims the entry but marks it as
// `paramsParseFailed` so the report flags it for review.
// =============================================================================

/**
 * @typedef {Object} ErMoveDraft
 * @property {number} id
 * @property {string} name
 * @property {string} description
 * @property {string} longDescription
 * @property {readonly number[]} flags
 * @property {"vanilla"|"unknown"} archetype
 */

/**
 * @typedef {Object} Classifier
 * @property {string} archetype
 * @property {(desc: string, move: ErMoveDraft) => boolean} test
 * @property {(desc: string, move: ErMoveDraft) => Record<string, unknown> | null} extract
 */

/** Regex source covering every ER flag-suffix variant we recognise. */
const FLAG_SUFFIX_RE_SRC = Object.keys(MOVE_FLAG_MAP)
  // Sort longest-first so "mega launcher" wins over "launcher"-like prefixes
  // and "hammer-based" wins before bare "based".
  .sort((a, b) => b.length - a.length)
  .map(k => k.replace(/[-/\\^$*+?.()|[\]{}]/g, "\\$&"))
  .join("|");
const FLAG_SUFFIX_RE = new RegExp(`\\b(${FLAG_SUFFIX_RE_SRC})\\b(?:\\s+boost(?:ed)?)?`, "i");

/** Detect a status-chance proc shared across many ER moves. */
const STATUS_CHANCE_RE_SRC =
  "(burn|burns|paraly[sz]\\w*|poison\\w*|sleep|asleep|freezes?|frozen|frostbit\\w*|confus\\w+|infatuat\\w+|drowsy|bleed\\w*|flinch\\w*|fear|drench|smack\\s*down|curse|leech\\s*seed)";

/** @type {Classifier[]} */
const CLASSIFIERS = [
  // ── 1. flag-tagged-move ───────────────────────────────────────────────
  // Highest priority — the dominant ER move shape. Any move whose desc or
  // longDesc carries one of the known flag suffixes is reclassified as a
  // flag-tagged move. The boost itself is wired ability-side; here we just
  // surface the recognised flag(s).
  {
    archetype: "flag-tagged-move",
    test: desc => FLAG_SUFFIX_RE.test(desc),
    extract: desc => {
      const flags = [];
      const re = new RegExp(`\\b(${FLAG_SUFFIX_RE_SRC})\\b(?:\\s+boost(?:ed)?)?`, "gi");
      let m;
      while ((m = re.exec(desc)) !== null) {
        const key = m[1].toLowerCase().replace(/\s+/g, " ");
        const flag = MOVE_FLAG_MAP[key];
        if (flag && !flags.includes(flag)) {
          flags.push(flag);
        }
      }
      if (flags.length === 0) {
        return null;
      }
      // Common rider: an N% status proc embedded alongside the flag suffix.
      // Surface it so the wiring step can configure StatusEffectAttr without
      // re-parsing.
      const statusM = desc.match(
        new RegExp(`(\\d+)\\s*%\\s+(?:chance\\s+(?:to|for)\\s+)?${STATUS_CHANCE_RE_SRC}`, "i"),
      );
      const out = { flags };
      if (statusM) {
        const status = normalizeStatus(statusM[2]) ?? statusM[2].toUpperCase().replace(/\s+/g, "_");
        out.statusChance = { chance: Number(statusM[1]), status };
      }
      // Recoil rider (e.g. Star Crash / Zephyr Rush — flag + recoil)
      const recoilM = desc.match(/(\d+)\s*%\s+recoil/i);
      if (recoilM) {
        const r = parsePercent(recoilM[1]);
        if (r !== null) {
          out.recoilPct = r;
        }
      }
      return out;
    },
  },

  // ── 2. type-conversion (contextual move type — placed BEFORE
  // chance-status-on-hit so that "Fire or Ground based on effectiveness. Has
  // 10% burn chance." is correctly recognised as a type-conversion move
  // rather than a generic burn-proc — the chance is surfaced inside the
  // params as a secondary effect when needed).
  {
    archetype: "type-conversion",
    test: desc =>
      new RegExp(`(${TYPE_RE_SRC})\\s+or\\s+(${TYPE_RE_SRC})\\s+based\\s+on\\s+effectiveness`, "i").test(desc)
      || new RegExp(`Uses\\s+(${TYPE_RE_SRC})\\.?\\s+or\\s+(${TYPE_RE_SRC})\\s+based\\s+on\\s+effectiveness`, "i").test(
        desc,
      ),
    extract: desc => {
      const m =
        desc.match(new RegExp(`(${TYPE_RE_SRC})\\s+or\\s+(${TYPE_RE_SRC})\\s+based\\s+on\\s+effectiveness`, "i"))
        ?? desc.match(
          new RegExp(`Uses\\s+(${TYPE_RE_SRC})\\.?\\s+or\\s+(${TYPE_RE_SRC})\\s+based\\s+on\\s+effectiveness`, "i"),
        );
      if (!m) {
        return null;
      }
      const out = {
        mode: "best-effectiveness",
        types: [normalizeType(m[1]), normalizeType(m[2])],
      };
      // Surface a status-chance rider for the wiring step
      const statusM = desc.match(
        new RegExp(`(\\d+)\\s*%\\s+(?:chance\\s+(?:to|for)\\s+)?${STATUS_CHANCE_RE_SRC}`, "i"),
      );
      if (statusM) {
        const status = normalizeStatus(statusM[2]) ?? statusM[2].toUpperCase().replace(/\s+/g, "_");
        out.statusChance = { chance: Number(statusM[1]), status };
      }
      return out;
    },
  },

  // ── 3. chance-status-on-hit ───────────────────────────────────────────
  // "N% chance to STATUS [the foe]" / "N% STATUS chance" / "10% poison" /
  // "Always paralyzes" (rendered as 100% from a phrasing variant).
  {
    archetype: "chance-status-on-hit",
    test: desc =>
      new RegExp(
        `(\\d+)\\s*%\\s+(?:chance\\s+(?:to|for)\\s+(?:inflict|cause|apply\\s+)?)?\\s*${STATUS_CHANCE_RE_SRC}`,
        "i",
      ).test(desc)
      || /\bAlways\s+(?:paraly[sz]|poison|burn|freezes?|frostbit|confus|infatuat|bleed|flinch|curse)/i.test(desc)
      || /\bBadly\s+poisons?\s+the\s+target/i.test(desc),
    extract: desc => {
      // Pattern A: "N% [chance to] STATUS [...]"
      const a = desc.match(
        new RegExp(
          `(\\d+)\\s*%\\s+(?:chance\\s+(?:to|for)\\s+(?:inflict|cause|apply\\s+)?)?\\s*${STATUS_CHANCE_RE_SRC}`,
          "i",
        ),
      );
      if (a) {
        const chance = Number(a[1]);
        const statusRaw = a[2].toLowerCase().replace(/\s+/g, " ").trim();
        const status = normalizeStatus(statusRaw) ?? statusRaw.toUpperCase().replace(/\s+/g, "_");
        return { chance, status };
      }
      // Pattern B: "Always STATUS [...]"  → 100% chance.
      const b = desc.match(
        /\bAlways\s+(paraly[sz]\w*|poison\w*|burn\w*|freezes?|frostbit\w*|confus\w+|infatuat\w+|bleed\w*|flinch\w*|curse)/i,
      );
      if (b) {
        const statusRaw = b[1].toLowerCase().trim();
        const status = normalizeStatus(statusRaw) ?? statusRaw.toUpperCase().replace(/\s+/g, "_");
        return { chance: 100, status };
      }
      // Pattern C: "Badly poisons the target"
      const c = desc.match(/Badly\s+poisons?\s+the\s+target/i);
      if (c) {
        return { chance: 100, status: "TOXIC" };
      }
      return null;
    },
  },

  // ── 4. conditional-damage ─────────────────────────────────────────────
  // "Double damage on X" / "Deals 2x damage to sleeping foes" / "N% more
  // damage if the foe is bleeding" / "Boosted if user is burned/poisoned"
  // (move-side analog of C2's ability-side classifier).
  {
    archetype: "conditional-damage",
    test: desc =>
      /(?:Double\s+damage|Deals?\s+[\d.]+x\s+damage)\s+(?:on|to|against|vs)\b/i.test(desc)
      || /(\d+)\s*%\s+more\s+damage\s+(?:if|when|on)\b/i.test(desc)
      || /boosted\s+if\s+(?:user|self)\s+is\s+(burned|poisoned|paralyzed|frozen|asleep)/i.test(desc),
    extract: desc => {
      // Pattern A: "Double damage on X" / "Deals 2x damage to sleeping foes"
      const a = desc.match(/(?:Double\s+damage|Deals?\s+([\d.]+)x\s+damage)\s+(?:on|to|against|vs)\s+([^.]+)/i);
      if (a) {
        const multiplier = a[1] ? Number(a[1]) : 2;
        const rest = (a[2] ?? "").toLowerCase().trim();
        return { condition: classifyTargetCondition(rest), multiplier };
      }
      // Pattern B: "N% more damage if [...]"
      const b = desc.match(/(\d+)\s*%\s+more\s+damage\s+(?:if|when|on)\s+([^.]+)/i);
      if (b) {
        const multiplier = 1 + Number(b[1]) / 100;
        const rest = (b[2] ?? "").toLowerCase().trim();
        return { condition: classifyTargetCondition(rest), multiplier };
      }
      // Pattern C: user-statused booster (Bravado)
      const c = desc.match(/boosted\s+if\s+(?:user|self)\s+is\s+([\w,\s]+)/i);
      if (c) {
        const statuses = c[1]
          .toLowerCase()
          .split(/\s*(?:,|or|and)\s*/)
          .map(s => normalizeStatus(s.trim()))
          .filter(Boolean);
        return {
          condition: { kind: "self-statused", statuses },
          // ER doesn't quote the multiplier for Bravado in-line; default to 1.5x
          // which is the most common ER "boosted" value.
          multiplier: 1.5,
        };
      }
      return null;
    },
  },

  // ── 5. recoil-or-drain ────────────────────────────────────────────────
  // "33% recoil damage" / "50% recoil damage" / "Heals N% of damage done".
  {
    archetype: "recoil-or-drain",
    test: desc => /(\d+)\s*%\s+recoil\s+damage/i.test(desc) || /Heals?\s+\d+\s*%\s+of\s+(?:the\s+)?damage/i.test(desc),
    extract: desc => {
      const recoilM = desc.match(/(\d+)\s*%\s+recoil\s+damage/i);
      if (recoilM) {
        const pct = parsePercent(recoilM[1]);
        return { mode: "recoil", recoilPct: pct ?? Number(recoilM[1]) / 100 };
      }
      const drainM = desc.match(/Heals?\s+(\d+)\s*%\s+of\s+(?:the\s+)?damage/i);
      if (drainM) {
        const pct = parsePercent(drainM[1]);
        return { mode: "drain", drainPct: pct ?? Number(drainM[1]) / 100 };
      }
      return null;
    },
  },
];

/**
 * Map an unstructured "condition" clause from a conditional-damage match
 * into the same discriminated shape C2 uses on the ability side.
 * @param {string} rest
 * @returns {Record<string, unknown>}
 */
function classifyTargetCondition(rest) {
  if (/sleeping|asleep/.test(rest)) {
    return { kind: "target-asleep" };
  }
  if (/confused|enraged/.test(rest)) {
    return { kind: "target-confused" };
  }
  if (/bleed\w*/.test(rest)) {
    return { kind: "target-bleeding" };
  }
  if (/status(?:\s+problems?)?\b|statused/.test(rest)) {
    return { kind: "target-statused" };
  }
  if (/low\s+hp/.test(rest)) {
    return { kind: "target-low-hp" };
  }
  // "Dragons", "Dragon-types"
  const typeM = rest.match(new RegExp(`(${TYPE_RE_SRC})(?:s|-?type)`, "i"));
  if (typeM) {
    return { kind: "target-type", type: normalizeType(typeM[1]) };
  }
  return { kind: "other", note: rest.slice(0, 60).trim() };
}

// =============================================================================
// Classify driver
// =============================================================================

/**
 * @param {ErMoveDraft} move
 * @returns {{ archetype: string, params: Record<string, unknown> | null, paramsParseFailed: boolean }}
 */
export function classify(move) {
  if (!move) {
    return { archetype: "bespoke", params: null, paramsParseFailed: false };
  }
  const desc = getDesc(move);
  // Skip the empty "-------" slot and placeholders
  if (move.name === "-" || desc.length === 0) {
    return { archetype: "bespoke", params: null, paramsParseFailed: false };
  }
  for (const c of CLASSIFIERS) {
    if (c.test(desc, move)) {
      const params = c.extract(desc, move);
      return { archetype: c.archetype, params, paramsParseFailed: params === null };
    }
  }
  return { archetype: "bespoke", params: null, paramsParseFailed: false };
}

/** All move-archetype slugs the wiring step recognises. */
const ARCHETYPE_SLUGS = [
  "flag-tagged-move",
  "chance-status-on-hit",
  "type-conversion",
  "conditional-damage",
  "recoil-or-drain",
  "bespoke",
];

/**
 * Parse the `ER_MOVES` array literal out of er-moves.ts. The auto-generated
 * body is JSON-safe so we can JSON.parse the `[...]` block directly.
 */
export function parseErMoves(text) {
  const m = text.match(/export const ER_MOVES[^=]*=\s*(\[[\s\S]*?\])\s*as const;/);
  if (!m) {
    throw new Error("classify-moves: couldn't find ER_MOVES export in er-moves.ts");
  }
  return JSON.parse(m[1]);
}

/**
 * Emit the body of `er-move-archetypes.ts`. Pure — no IO — so tests can
 * exercise it with synthetic input.
 * @param {{ erMoveId: number, archetype: string, params: object | null }[]} entries
 */
export function emitArchetypesBody(entries) {
  // Sort by id ascending for stable output.
  const sorted = [...entries].sort((a, b) => a.erMoveId - b.erMoveId);
  const unionType = ARCHETYPE_SLUGS.map(s => `  | ${JSON.stringify(s)}`).join("\n");
  const tableEntries = sorted
    .map(e => {
      const params = e.params === null ? "null" : JSON.stringify(e.params);
      return `  ${e.erMoveId}: { erMoveId: ${e.erMoveId}, archetype: ${JSON.stringify(
        e.archetype,
      )}, params: ${params} },`;
    })
    .join("\n");
  return `// Phase C task C3: auto-classified ER moves → archetype primitives.
//
// This table maps each ER-custom move id to the archetype primitive that
// implements it, plus a JSON-serializable \`params\` object the wiring step
// will feed to the primitive's constructor. \`archetype: "bespoke"\` means
// the move didn't match any archetype shape and will need a hand-written
// implementation (the "long tail" per the taxonomy doc).
//
// Regenerate with: \`pnpm run er:classify-moves\`.

export type ErMoveArchetypeKind =
${unionType};

export interface ErMoveArchetypeEntry {
  readonly erMoveId: number;
  readonly archetype: ErMoveArchetypeKind;
  readonly params: Record<string, unknown> | null;
}

export const ER_MOVE_ARCHETYPES: Readonly<Record<number, ErMoveArchetypeEntry>> = {
${tableEntries}
};
`;
}

async function main() {
  const text = await readFile(MOVES_PATH, "utf8");
  const all = parseErMoves(text);
  // Only auto-classify the unknown-archetype entries. Vanilla moves aren't
  // included in the output table — they use pokerogue's existing implementations.
  const unknowns = all.filter(m => m.archetype === "unknown");

  const entries = [];
  const counts = Object.fromEntries(ARCHETYPE_SLUGS.map(s => [s, 0]));
  let parseFailed = 0;
  for (const m of unknowns) {
    const result = classify(m);
    counts[result.archetype] = (counts[result.archetype] ?? 0) + 1;
    if (result.paramsParseFailed) {
      parseFailed++;
    }
    entries.push({ erMoveId: m.id, archetype: result.archetype, params: result.params });
  }

  const total = unknowns.length;
  const bespokeCount = counts.bespoke ?? 0;
  const classified = total - bespokeCount;
  const pct = total === 0 ? 0 : (classified / total) * 100;

  console.log("# C3 classification report");
  console.log(`Total unknown moves scanned: ${total}`);
  console.log(`Auto-classified into archetypes: ${classified} (${pct.toFixed(1)}%)`);
  console.log(`Bespoke (no match):              ${bespokeCount}`);
  console.log(`Param-parse failures:            ${parseFailed}`);
  console.log();
  console.log("Per-archetype counts:");
  const sortedSlugs = ARCHETYPE_SLUGS.slice().sort((a, b) => counts[b] - counts[a]);
  for (const slug of sortedSlugs) {
    if (counts[slug] > 0) {
      console.log(`  ${slug}: ${counts[slug]}`);
    }
  }

  const body = emitArchetypesBody(entries);
  await emitModule(OUT_PATH, body);
  console.log();
  console.log(`Wrote ${entries.length} entries → ${OUT_PATH}`);
}

const ENTRY = resolve(process.argv[1] ?? "");
const SELF = fileURLToPath(import.meta.url);
if (ENTRY === SELF) {
  main().catch(err => {
    console.error(err);
    process.exit(1);
  });
}
