/*
 * SPDX-FileCopyrightText: 2025-2026 Pagefault Games
 * SPDX-FileContributor: Sisyphus
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * Elite Redux Phase C task C4: audit and emit the ER-flag-name → pokerogue
 * `MoveFlags` mapping.
 *
 * Inputs
 * ------
 *   - `src/enums/move-flags.ts`  → existing pokerogue `MoveFlags` bitmask enum.
 *   - `src/data/elite-redux/er-move-tables.ts`         → `ER_FLAG_NAMES` (the
 *     18 raw ER flag NAMES surfaced by the A7 fixture extractor).
 *   - `src/data/elite-redux/er-move-archetypes.ts`     → C3 archetype rows;
 *     `flag-tagged-move` entries carry a `params.flags: string[]` field whose
 *     members are the *classifier-keyed* CAPS form ("STRONG_JAW", "ARROW",
 *     "HAMMER_BASED", …) — see `scripts/elite-redux/classify-moves.mjs`.
 *
 * Outputs
 * -------
 *   - `src/data/elite-redux/er-flag-mapping.ts`        → emitted module with:
 *       - `ER_FLAG_TO_MOVE_FLAG` — the text-form `ER_FLAG_NAMES → MoveFlags`
 *         mapping (per the task spec example).
 *       - `ER_CLASSIFIER_FLAG_TO_MOVE_FLAG` — the CAPS-form
 *         `classifier-flag-name → MoveFlags` mapping. Used by the wire-up
 *         layer when consuming C3's archetype params.
 *       - `resolveErFlag()` — helper that resolves a flag string in either
 *         form to a `MoveFlags` value (or `null` if unmapped, e.g.
 *         "Always Crits" which is encoded as a {@linkcode CritOnlyAttr} in
 *         pokerogue rather than a flag bit).
 *   - stdout coverage report (which ER flags exist as MoveFlags, which were
 *     added by this script, which are deliberately non-flag mechanics).
 *
 * Idempotency: re-running with no upstream changes produces an identical
 * output file (deterministic key ordering + JSON-stable values).
 */

import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { emitModule } from "./lib/emit.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "../..");
const MOVE_FLAGS_PATH = resolve(ROOT, "src/enums/move-flags.ts");
const ER_MOVE_TABLES_PATH = resolve(ROOT, "src/data/elite-redux/er-move-tables.ts");
const ER_MOVE_ARCHETYPES_PATH = resolve(ROOT, "src/data/elite-redux/er-move-archetypes.ts");
const OUT_PATH = resolve(ROOT, "src/data/elite-redux/er-flag-mapping.ts");

// =============================================================================
// Pokerogue MoveFlags enum parser
// =============================================================================

/**
 * Parse the `MoveFlags` enum from move-flags.ts. The file is hand-edited so we
 * can't JSON.parse it, but the lines have a consistent `KEY = 1 << N,` shape
 * (with `NONE = 0`) that's easy to regex-extract.
 *
 * @param {string} text
 * @returns {{ keys: string[], maxBit: number, none: boolean }}
 */
export function parseMoveFlags(text) {
  const keys = [];
  let maxBit = -1;
  let hasNone = false;

  // Locate `export enum MoveFlags {` and scan forward, tracking balanced
  // braces so JSDoc-embedded `{ @linkcode … }` doesn't terminate the enum
  // early. The first `}` at depth-0 is the enum's closing brace.
  const head = text.match(/export\s+enum\s+MoveFlags\s*\{/);
  if (!head) {
    throw new Error(`audit-flag-mapping: couldn't find 'export enum MoveFlags' in ${MOVE_FLAGS_PATH}`);
  }
  const bodyStart = head.index + head[0].length;
  let depth = 1;
  let inLineComment = false;
  let inBlockComment = false;
  let inString = false;
  let stringQuote = "";
  let escaping = false;
  let i = bodyStart;
  while (i < text.length && depth > 0) {
    const ch = text[i];
    const next = text[i + 1];
    if (inLineComment) {
      if (ch === "\n") {
        inLineComment = false;
      }
    } else if (inBlockComment) {
      if (ch === "*" && next === "/") {
        inBlockComment = false;
        i++;
      }
    } else if (inString) {
      if (escaping) {
        escaping = false;
      } else if (ch === "\\") {
        escaping = true;
      } else if (ch === stringQuote) {
        inString = false;
      }
    } else if (ch === "/" && next === "/") {
      inLineComment = true;
      i++;
    } else if (ch === "/" && next === "*") {
      inBlockComment = true;
      i++;
    } else if (ch === '"' || ch === "'" || ch === "`") {
      inString = true;
      stringQuote = ch;
    } else if (ch === "{") {
      depth++;
    } else if (ch === "}") {
      depth--;
      if (depth === 0) {
        break;
      }
    }
    i++;
  }
  if (depth !== 0) {
    throw new Error("audit-flag-mapping: couldn't locate MoveFlags closing brace");
  }
  const body = text.slice(bodyStart, i);

  const lineRe = /^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(?:0|1\s*<<\s*(\d+))\s*,?\s*$/gm;
  let m;
  while ((m = lineRe.exec(body)) !== null) {
    const name = m[1];
    if (name === "NONE") {
      hasNone = true;
      keys.push(name);
      continue;
    }
    const bit = Number(m[2]);
    if (!Number.isFinite(bit) || bit < 0) {
      throw new Error(`audit-flag-mapping: invalid bit position for ${name}`);
    }
    if (bit > maxBit) {
      maxBit = bit;
    }
    keys.push(name);
  }
  if (keys.length === 0) {
    throw new Error("audit-flag-mapping: parsed zero MoveFlags entries — regex change needed?");
  }
  return { keys, maxBit, none: hasNone };
}

// =============================================================================
// ER_FLAG_NAMES parser
// =============================================================================

/**
 * Extract the `ER_FLAG_NAMES` array literal from er-move-tables.ts.
 * @param {string} text
 * @returns {string[]}
 */
export function parseErFlagNames(text) {
  const m = text.match(/export\s+const\s+ER_FLAG_NAMES\s*:[^=]*=\s*(\[[\s\S]*?\])\s*as const;/);
  if (!m) {
    throw new Error(`audit-flag-mapping: couldn't find ER_FLAG_NAMES in ${ER_MOVE_TABLES_PATH}`);
  }
  return JSON.parse(m[1]);
}

// =============================================================================
// ER_MOVE_ARCHETYPES classifier-flag extraction
// =============================================================================

/**
 * Extract the set of classifier-emitted CAPS flag names from the
 * `flag-tagged-move` entries of ER_MOVE_ARCHETYPES. Returns a Map of
 * `flagName → list of erMoveIds that carry it` so the report can show
 * coverage / spot orphans.
 *
 * The archetypes file is auto-generated TS; the body literally contains
 * JSON-shaped `params: {"flags":["STRONG_JAW", …]}` clauses we can extract
 * with a regex without parsing TS.
 *
 * @param {string} text
 * @returns {Map<string, number[]>}
 */
export function parseClassifierFlags(text) {
  const out = new Map();
  // Locate the start of each flag-tagged-move row, then scan forward with a
  // balanced-brace tracker to extract its params object. JSON.parse handles
  // the rest (the params object is JSON-safe per emitArchetypesBody).
  const headRe = /(\d+):\s*\{\s*erMoveId:\s*\d+,\s*archetype:\s*"flag-tagged-move",\s*params:\s*\{/g;
  let m;
  while ((m = headRe.exec(text)) !== null) {
    const erMoveId = Number(m[1]);
    const paramsStart = headRe.lastIndex - 1; // position of the opening `{`
    let depth = 1;
    let inString = false;
    let escaping = false;
    let i = paramsStart + 1;
    while (i < text.length && depth > 0) {
      const ch = text[i];
      if (inString) {
        if (escaping) {
          escaping = false;
        } else if (ch === "\\") {
          escaping = true;
        } else if (ch === '"') {
          inString = false;
        }
      } else if (ch === '"') {
        inString = true;
      } else if (ch === "{") {
        depth++;
      } else if (ch === "}") {
        depth--;
      }
      i++;
    }
    if (depth !== 0) {
      throw new Error(`audit-flag-mapping: unbalanced params braces for erMoveId ${erMoveId}`);
    }
    const paramsJson = text.slice(paramsStart, i);
    let params;
    try {
      params = JSON.parse(paramsJson);
    } catch (err) {
      throw new Error(`audit-flag-mapping: failed to parse params for erMoveId ${erMoveId}: ${err.message}`);
    }
    const flags = Array.isArray(params?.flags) ? params.flags : [];
    for (const flag of flags) {
      if (!out.has(flag)) {
        out.set(flag, []);
      }
      out.get(flag).push(erMoveId);
    }
  }
  return out;
}

// =============================================================================
// Canonical mappings
// =============================================================================

/**
 * Text-form ER_FLAG_NAMES → pokerogue MoveFlags key. Mechanics that pokerogue
 * expresses as MoveAttrs (HighCritAttr, CritOnlyAttr, RecoilAttr) are mapped
 * to `null` — they don't get a flag bit. The wire-up layer routes those via
 * the corresponding attr instead.
 *
 * Order matches A7's `ER_FLAG_NAMES` export.
 */
export const ER_FLAG_TEXT_TO_FLAG_KEY = Object.freeze({
  "Makes Contact": "MAKES_CONTACT",
  "High Crit Rate": null, // → HighCritAttr (move attr, not a flag bit)
  "Air/Wing Based": "AIR_BASED",
  "Dance Move": "DANCE_MOVE",
  "Always Crits": null, // → CritOnlyAttr
  "Field Based": "FIELD_BASED",
  "Hammer Based": "HAMMER_BASED",
  "Kick Based": "KICKING_MOVE",
  "Causes Recoil": null, // → RecoilAttr (recoil pct already extracted by C3)
  "Horn Based": "HORN_BASED",
  "Drill Based": "DRILL_BASED",
  "Sound Based": "SOUND_BASED",
  "Bullet Move": "BALLBOMB_MOVE", // alias — pokerogue's BALLBOMB == ER's "Bullet"
  "Weather Based": "WEATHER_BASED",
  "Throw Based": "THROW_BASED",
  "Bone Based": "BONE_BASED",
  "Lunar Move": "LUNAR_MOVE",
  "Arrow Based": "ARROW_BASED",
});

/**
 * Classifier-form (CAPS) → pokerogue MoveFlags key. The classifier emits
 * ability-keyed names ("STRONG_JAW") which target the *vanilla* flag bit
 * the ability gates on (BITING_MOVE). For ER-original flags ("HAMMER_BASED",
 * "ARROW") the classifier key matches the new ER flag key directly.
 *
 * Keep this list in sync with `MOVE_FLAG_MAP` in
 * scripts/elite-redux/classify-moves.mjs.
 */
export const ER_CLASSIFIER_TO_FLAG_KEY = Object.freeze({
  STRONG_JAW: "BITING_MOVE",
  KEEN_EDGE: "SLICING_MOVE",
  MEGA_LAUNCHER: "PULSE_MOVE",
  IRON_FIST: "PUNCHING_MOVE",
  MIGHTY_HORN: "HORN_BASED",
  ARROW: "ARROW_BASED",
  STRIKER: "KICKING_MOVE",
  HAMMER_BASED: "HAMMER_BASED",
  SOUND_BASED: "SOUND_BASED",
  BONE_BASED: "BONE_BASED",
  AIR_BASED: "AIR_BASED",
  DANCE_MOVE: "DANCE_MOVE",
  WIND_MOVE: "WIND_MOVE",
});

// =============================================================================
// Audit driver
// =============================================================================

/**
 * Compute the audit report.
 * @param {{ keys: string[], maxBit: number }} flagsEnum
 * @param {string[]} erFlagNames
 * @param {Map<string, number[]>} classifierFlags
 */
export function audit(flagsEnum, erFlagNames, classifierFlags) {
  const existing = new Set(flagsEnum.keys);

  /** Distinct MoveFlags keys we need to ADD to the enum. */
  const needAdding = new Set();
  /** Per-ER-name resolution: { erName, flagKey, status, erMoveIds? } */
  const erNameResolution = [];
  for (const erName of erFlagNames) {
    const flagKey = ER_FLAG_TEXT_TO_FLAG_KEY[erName] ?? null;
    if (flagKey === null) {
      erNameResolution.push({ erName, flagKey: null, status: "non-flag-attr" });
      continue;
    }
    if (existing.has(flagKey)) {
      erNameResolution.push({ erName, flagKey, status: "exists" });
    } else {
      needAdding.add(flagKey);
      erNameResolution.push({ erName, flagKey, status: "needs-add" });
    }
  }

  /** Classifier-name resolution: { classifierName, flagKey, status, erMoveIds } */
  const classifierResolution = [];
  for (const [classifierName, erMoveIds] of classifierFlags) {
    const flagKey = ER_CLASSIFIER_TO_FLAG_KEY[classifierName] ?? null;
    if (flagKey === null) {
      classifierResolution.push({ classifierName, flagKey: null, status: "unmapped", erMoveIds });
      continue;
    }
    if (existing.has(flagKey)) {
      classifierResolution.push({ classifierName, flagKey, status: "exists", erMoveIds });
    } else {
      needAdding.add(flagKey);
      classifierResolution.push({ classifierName, flagKey, status: "needs-add", erMoveIds });
    }
  }

  // Assign bit positions to the new entries deterministically (alpha order).
  const newFlagAssignments = [];
  let nextBit = flagsEnum.maxBit + 1;
  const orderedNew = [...needAdding].sort();
  for (const key of orderedNew) {
    newFlagAssignments.push({ key, bit: nextBit });
    nextBit++;
  }

  return {
    erNameResolution,
    classifierResolution,
    newFlagAssignments,
    existingMaxBit: flagsEnum.maxBit,
  };
}

// =============================================================================
// MoveFlags enum extension (in-place edit)
// =============================================================================

/**
 * Locate the position of the `MoveFlags` enum's closing brace using the same
 * balanced-brace scanner as {@linkcode parseMoveFlags}. Returns the offset of
 * the `}` character.
 * @param {string} text
 * @returns {number}
 */
function findMoveFlagsClosingBrace(text) {
  const head = text.match(/export\s+enum\s+MoveFlags\s*\{/);
  if (!head) {
    throw new Error("findMoveFlagsClosingBrace: couldn't find 'export enum MoveFlags'");
  }
  const bodyStart = head.index + head[0].length;
  let depth = 1;
  let inLineComment = false;
  let inBlockComment = false;
  let inString = false;
  let stringQuote = "";
  let escaping = false;
  let i = bodyStart;
  while (i < text.length && depth > 0) {
    const ch = text[i];
    const next = text[i + 1];
    if (inLineComment) {
      if (ch === "\n") {
        inLineComment = false;
      }
    } else if (inBlockComment) {
      if (ch === "*" && next === "/") {
        inBlockComment = false;
        i++;
      }
    } else if (inString) {
      if (escaping) {
        escaping = false;
      } else if (ch === "\\") {
        escaping = true;
      } else if (ch === stringQuote) {
        inString = false;
      }
    } else if (ch === "/" && next === "/") {
      inLineComment = true;
      i++;
    } else if (ch === "/" && next === "*") {
      inBlockComment = true;
      i++;
    } else if (ch === '"' || ch === "'" || ch === "`") {
      inString = true;
      stringQuote = ch;
    } else if (ch === "{") {
      depth++;
    } else if (ch === "}") {
      depth--;
      if (depth === 0) {
        return i;
      }
    }
    i++;
  }
  throw new Error("findMoveFlagsClosingBrace: unbalanced braces");
}

/**
 * Insert the new flag entries into the MoveFlags enum body, preserving the
 * existing entries. Returns the new file text. Idempotent — re-running adds
 * each new flag only once (we check for existing keys before inserting).
 *
 * @param {string} text     current move-flags.ts contents
 * @param {{ key: string, bit: number }[]} additions
 * @returns {string}
 */
export function extendMoveFlagsEnum(text, additions) {
  if (additions.length === 0) {
    return text;
  }
  const out = text;
  // Build all insertions, then splice them in once at the (re-computed)
  // closing-brace position. Idempotent: if any addition's key already exists
  // in the enum body, we skip it.
  const existing = new Set();
  // Re-parse to know what's already there.
  const parsed = parseMoveFlags(out);
  for (const k of parsed.keys) {
    existing.add(k);
  }
  const insertions = [];
  for (const { key, bit } of additions) {
    if (existing.has(key)) {
      continue;
    }
    insertions.push(`${describeNewFlag(key)}  ${key} = 1 << ${bit},\n`);
    existing.add(key);
  }
  if (insertions.length === 0) {
    return out;
  }
  const closeIdx = findMoveFlagsClosingBrace(out);
  return `${out.slice(0, closeIdx)}${insertions.join("")}${out.slice(closeIdx)}`;
}

/** Per-new-flag JSDoc block. Returns a string ending with newline. */
function describeNewFlag(key) {
  /** @type {Record<string, string>} */
  const descs = {
    AIR_BASED:
      "  /**\n   * Elite Redux: air- or wing-based moves. Boosted by ER abilities such as\n   * `Giant Wings`. No vanilla pokerogue analog.\n   */\n",
    HAMMER_BASED:
      "  /**\n   * Elite Redux: hammer-based moves. Boosted by ER's `Super Slammer` ability.\n   * No vanilla pokerogue analog.\n   */\n",
    KICKING_MOVE:
      "  /**\n   * Elite Redux: kicking moves. Boosted by ER's `Striker` ability (the\n   * kick-flavoured Iron Fist analog). No vanilla pokerogue analog.\n   */\n",
    HORN_BASED:
      "  /**\n   * Elite Redux: horn-based moves. Boosted by ER's `Mighty Horn` ability\n   * (and its drill-flavoured composite). No vanilla pokerogue analog.\n   */\n",
    DRILL_BASED:
      "  /**\n   * Elite Redux: drill-based moves. Often shares boosters with\n   * {@linkcode HORN_BASED} via composite ER abilities. No vanilla pokerogue analog.\n   */\n",
    BONE_BASED:
      "  /**\n   * Elite Redux: bone-based moves. Boosted by ER's `Calcium Bones` ability\n   * (sourced from Marowak-family moves). No vanilla pokerogue analog.\n   */\n",
    ARROW_BASED:
      "  /**\n   * Elite Redux: arrow-based moves. Boosted by ER's `Archer` ability.\n   * No vanilla pokerogue analog.\n   */\n",
    LUNAR_MOVE:
      "  /**\n   * Elite Redux: lunar-themed moves (e.g. moon-flavoured attacks). Used by\n   * ER's lunar-themed forms for stat-boost interactions. No vanilla pokerogue analog.\n   */\n",
    WEATHER_BASED:
      "  /**\n   * Elite Redux: moves whose mechanics interact with the active weather.\n   * Used by ER weather-syncing abilities. No vanilla pokerogue analog.\n   */\n",
    THROW_BASED:
      "  /**\n   * Elite Redux: throw-flavoured moves (Beat Up, Bonemerang lineage). Used by\n   * ER throw-boost abilities. No vanilla pokerogue analog.\n   */\n",
    FIELD_BASED:
      "  /**\n   * Elite Redux: terrain/field-interaction moves. Triggers ER abilities\n   * that key on field manipulation. No vanilla pokerogue analog.\n   */\n",
  };
  return descs[key] ?? `  /** Elite Redux ${key.toLowerCase().replace(/_/g, " ")} flag. */\n`;
}

// =============================================================================
// er-flag-mapping.ts emitter
// =============================================================================

/**
 * Build the body of `src/data/elite-redux/er-flag-mapping.ts`.
 * @param {{
 *   erNameResolution: { erName: string, flagKey: string | null }[],
 *   classifierResolution: { classifierName: string, flagKey: string | null }[],
 * }} report
 */
export function emitMappingBody(report) {
  const textEntries = report.erNameResolution
    .map(({ erName, flagKey }) => {
      const value = flagKey === null ? "null" : `MoveFlags.${flagKey}`;
      return `  ${JSON.stringify(erName)}: ${value},`;
    })
    .join("\n");

  // Stable alpha-sort the classifier table for readability.
  const sortedClassifier = [...report.classifierResolution].sort((a, b) =>
    a.classifierName.localeCompare(b.classifierName),
  );
  const classifierEntries = sortedClassifier
    .map(({ classifierName, flagKey }) => {
      const value = flagKey === null ? "null" : `MoveFlags.${flagKey}`;
      return `  ${classifierName}: ${value},`;
    })
    .join("\n");

  return `// Phase C task C4: maps Elite Redux flag names to pokerogue \`MoveFlags\` bits.
//
// Two surfaces:
//
//   1. \`ER_FLAG_TO_MOVE_FLAG\` — keyed by the human-readable names from
//      \`ER_FLAG_NAMES\` (A7's fixture-side decoder table). The wire-up layer
//      uses this when consuming ER's raw move-flag arrays.
//   2. \`ER_CLASSIFIER_FLAG_TO_MOVE_FLAG\` — keyed by the CAPS names emitted by
//      C3's \`classify-moves\` script (e.g. \`"STRONG_JAW"\`, \`"ARROW"\`).
//      Mirrors \`MOVE_FLAG_MAP\` in scripts/elite-redux/classify-moves.mjs.
//      The wire-up layer uses this when consuming C3 archetype params.
//
// Both tables resolve to either a \`MoveFlags\` bit OR \`null\` — \`null\` indicates
// the ER concept is encoded as a \`MoveAttr\` in pokerogue (e.g. "High Crit Rate"
// → \`HighCritAttr\`) rather than a flag bit.
//
// Regenerate with: \`pnpm run er:audit-flag-mapping\`.

import { MoveFlags } from "#enums/move-flags";

/** Text-form ER flag names (from \`ER_FLAG_NAMES\`) → \`MoveFlags\` bit (or \`null\`). */
export const ER_FLAG_TO_MOVE_FLAG: Readonly<Record<string, MoveFlags | null>> = {
${textEntries}
};

/** Classifier-form (CAPS) flag names (from C3 archetype params) → \`MoveFlags\` bit (or \`null\`). */
export const ER_CLASSIFIER_FLAG_TO_MOVE_FLAG: Readonly<Record<string, MoveFlags | null>> = {
${classifierEntries}
};

/** Ordered list of ER text flag names — preserves the A7 declaration order. */
export const ER_FLAG_NAMES_LIST: readonly string[] = Object.keys(ER_FLAG_TO_MOVE_FLAG);

/** Ordered list of classifier-emitted flag names (alpha-sorted). */
export const ER_CLASSIFIER_FLAG_NAMES_LIST: readonly string[] = Object.keys(ER_CLASSIFIER_FLAG_TO_MOVE_FLAG);

/**
 * Resolve an ER flag identifier (text or CAPS form) to its \`MoveFlags\` bit.
 *
 * @param name  Either a text-form name from \`ER_FLAG_NAMES\` ("Hammer Based")
 *              or a classifier-form CAPS name from C3 archetype params ("HAMMER_BASED").
 * @returns     The matching \`MoveFlags\` bit, or \`null\` if the ER concept is
 *              expressed as a \`MoveAttr\` in pokerogue, or \`undefined\` if
 *              the name is unrecognised.
 */
export function resolveErFlag(name: string): MoveFlags | null | undefined {
  if (Object.hasOwn(ER_FLAG_TO_MOVE_FLAG, name)) {
    return ER_FLAG_TO_MOVE_FLAG[name];
  }
  if (Object.hasOwn(ER_CLASSIFIER_FLAG_TO_MOVE_FLAG, name)) {
    return ER_CLASSIFIER_FLAG_TO_MOVE_FLAG[name];
  }
  return undefined;
}
`;
}

// =============================================================================
// Main
// =============================================================================

async function main() {
  const [moveFlagsText, erMoveTablesText, erArchetypesText] = await Promise.all([
    readFile(MOVE_FLAGS_PATH, "utf8"),
    readFile(ER_MOVE_TABLES_PATH, "utf8"),
    readFile(ER_MOVE_ARCHETYPES_PATH, "utf8"),
  ]);

  const flagsEnum = parseMoveFlags(moveFlagsText);
  const erFlagNames = parseErFlagNames(erMoveTablesText);
  const classifierFlags = parseClassifierFlags(erArchetypesText);

  const report = audit(flagsEnum, erFlagNames, classifierFlags);

  // -- Stdout report ----------------------------------------------------------
  console.log("# C4 flag-mapping audit");
  console.log(`Current MoveFlags max bit position: ${flagsEnum.maxBit} (next free: ${flagsEnum.maxBit + 1})`);
  console.log();
  console.log(`## ER_FLAG_NAMES (${erFlagNames.length} entries) → pokerogue MoveFlags`);
  for (const r of report.erNameResolution) {
    const status =
      r.status === "non-flag-attr"
        ? "→ non-flag MoveAttr (skip enum)"
        : r.status === "exists"
          ? `→ MoveFlags.${r.flagKey} (existing)`
          : `→ MoveFlags.${r.flagKey} (NEW)`;
    console.log(`  ${r.erName.padEnd(16)} ${status}`);
  }
  console.log();
  console.log(
    `## Classifier flag-tagged-move flags (${report.classifierResolution.length} distinct) → pokerogue MoveFlags`,
  );
  for (const r of [...report.classifierResolution].sort((a, b) => a.classifierName.localeCompare(b.classifierName))) {
    const status =
      r.status === "unmapped"
        ? "→ UNMAPPED"
        : r.status === "exists"
          ? `→ MoveFlags.${r.flagKey} (existing)`
          : `→ MoveFlags.${r.flagKey} (NEW)`;
    console.log(`  ${r.classifierName.padEnd(16)} ${status}   (${r.erMoveIds.length} moves)`);
  }
  console.log();
  console.log(`## New MoveFlags bits to add (${report.newFlagAssignments.length})`);
  for (const a of report.newFlagAssignments) {
    console.log(`  MoveFlags.${a.key} = 1 << ${a.bit}`);
  }
  console.log();

  // -- Extend MoveFlags enum --------------------------------------------------
  const extendedFlagsText = extendMoveFlagsEnum(moveFlagsText, report.newFlagAssignments);
  if (extendedFlagsText === moveFlagsText) {
    console.log("[er:audit-flag-mapping] MoveFlags enum already up-to-date — no changes");
  } else {
    const { writeFile } = await import("node:fs/promises");
    await writeFile(MOVE_FLAGS_PATH, extendedFlagsText, "utf8");
    console.log(`[er:audit-flag-mapping] updated ${MOVE_FLAGS_PATH} with ${report.newFlagAssignments.length} new bits`);
  }

  // -- Emit mapping module ----------------------------------------------------
  const body = emitMappingBody(report);
  await emitModule(OUT_PATH, body);

  // -- Coverage check ---------------------------------------------------------
  const totalClassifierMoves = report.classifierResolution.reduce((acc, r) => acc + r.erMoveIds.length, 0);
  const unmapped = report.classifierResolution.filter(r => r.status === "unmapped");
  const unmappedMoves = unmapped.reduce((acc, r) => acc + r.erMoveIds.length, 0);
  const resolved = totalClassifierMoves - unmappedMoves;
  const coveragePct = totalClassifierMoves === 0 ? 0 : (resolved / totalClassifierMoves) * 100;
  console.log();
  console.log("## Coverage");
  console.log(`Total flag-tagged-move flag references: ${totalClassifierMoves}`);
  console.log(`Resolved to MoveFlags: ${resolved} (${coveragePct.toFixed(1)}%)`);
  console.log(`Unmapped: ${unmappedMoves}`);
  if (unmapped.length > 0) {
    console.warn("\n[er:audit-flag-mapping] WARNING: unmapped classifier flags:");
    for (const r of unmapped) {
      console.warn(`  ${r.classifierName} (${r.erMoveIds.length} moves: ${r.erMoveIds.slice(0, 5).join(", ")}...)`);
    }
    process.exit(1);
  }
}

const ENTRY = resolve(process.argv[1] ?? "");
const SELF = fileURLToPath(import.meta.url);
if (ENTRY === SELF) {
  main().catch(err => {
    console.error(err);
    process.exit(1);
  });
}
