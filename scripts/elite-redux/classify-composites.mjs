/*
 * SPDX-FileCopyrightText: 2025-2026 Pagefault Games
 * SPDX-FileContributor: Sisyphus
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * Elite Redux Phase D task D3b: resolve the 196-odd
 * `composite-vanilla-mashup` rows into a side table whose part references
 * point at concrete AbAttr-bearing abilities (either a vanilla pokerogue
 * `AbilityId` or another ER `erAbilityId`).
 *
 * The classifier in `classify-abilities.mjs` only emitted the human-readable
 * part names (e.g. `parts: ["Unnerve", "Chilling Neigh"]`). At D3b we walk
 * those names back to ids:
 *   - First by exact name match against pokerogue's `AbilityId` enum
 *     (canonicalized: lowercase + underscores stripped).
 *   - Falling back to the ER ability name table (`ER_ABILITIES`).
 *   - Otherwise the part is recorded as `unresolved` so the dispatcher can
 *     skip it (and the diagnostic surface flags coverage gaps).
 *
 * Emits `src/data/elite-redux/er-composite-parts.ts` mapping
 * `erAbilityId → ErCompositeEntry` (parts + rider + unresolved-list).
 * Pure data file — the actual recursive AbAttr resolution lives in
 * `archetype-dispatcher.ts`, which reads the side table at init time.
 *
 * Prints a coverage report to stdout.
 */

import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { emitModule } from "./lib/emit.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "../..");
const ABILITIES_PATH = resolve(ROOT, "src/data/elite-redux/er-abilities.ts");
const ARCHETYPES_PATH = resolve(ROOT, "src/data/elite-redux/er-ability-archetypes.ts");
const ABILITY_ID_PATH = resolve(ROOT, "src/enums/ability-id.ts");
const OUT_PATH = resolve(ROOT, "src/data/elite-redux/er-composite-parts.ts");

// =============================================================================
// Source parsers
// =============================================================================

/**
 * Parse the `ER_ABILITIES` JSON-shaped array literal out of er-abilities.ts.
 * The body is regular JSON inside a `[...]` block so JSON.parse handles it.
 * @param {string} text - er-abilities.ts file contents
 * @returns {{ id: number, name: string, description: string, archetype: string }[]}
 */
function parseErAbilities(text) {
  const m = text.match(/export const ER_ABILITIES[^=]*=\s*(\[[\s\S]*?\])\s*as const;/);
  if (!m) {
    // Match without the `as const` tail (er-abilities.ts variant).
    const m2 = text.match(/export const ER_ABILITIES[^=]*=\s*(\[[\s\S]*?\]);/);
    if (!m2) {
      throw new Error("classify-composites: couldn't find ER_ABILITIES export");
    }
    return JSON.parse(m2[1]);
  }
  return JSON.parse(m[1]);
}

/**
 * Parse the `ER_ABILITY_ARCHETYPES` table from er-ability-archetypes.ts. The
 * lines are `<id>: { erAbilityId: <id>, archetype: "<slug>", params: <json|null> },`
 * — we lift each row via regex since the file as a whole is TS-only (not JSON).
 * @param {string} text
 * @returns {{ erAbilityId: number, archetype: string, params: unknown }[]}
 */
function parseErAbilityArchetypes(text) {
  const rowRe = /^\s*(\d+):\s*\{\s*erAbilityId:\s*\d+,\s*archetype:\s*"([^"]+)",\s*params:\s*(.+?)\s*\},?\s*$/gm;
  const rows = [];
  for (const m of text.matchAll(rowRe)) {
    const id = Number(m[1]);
    const archetype = m[2];
    const paramsRaw = m[3];
    let params = null;
    if (paramsRaw !== "null") {
      try {
        params = JSON.parse(paramsRaw);
      } catch (err) {
        throw new Error(
          `classify-composites: failed to parse params for erAbilityId ${id}: ${err.message}\nraw: ${paramsRaw}`,
        );
      }
    }
    rows.push({ erAbilityId: id, archetype, params });
  }
  return rows;
}

/**
 * Parse pokerogue's AbilityId enum from src/enums/ability-id.ts. We capture
 * the order of members; the i-th member (after `NONE`) is `i` since the enum
 * is auto-numbered starting at 0. Returns a map of canonical name → numeric id.
 * @param {string} text
 * @returns {Map<string, number>} normalized name → AbilityId number
 */
function parseAbilityIdEnum(text) {
  // Block-comment-stripped member captures: lines that look like `  IDENT,`
  // outside the export wrapper. We assume positional ordering (no `=` overrides).
  const enumBodyMatch = text.match(/export enum AbilityId\s*\{([\s\S]*?)\n\}/);
  if (!enumBodyMatch) {
    throw new Error("classify-composites: couldn't find AbilityId enum body");
  }
  const body = enumBodyMatch[1];
  // Strip block comments so they don't confuse the per-line pattern.
  const stripped = body.replace(/\/\*[\s\S]*?\*\//g, "");
  const memberRe = /^\s+([A-Z][A-Z0-9_]*)\s*,?\s*$/gm;
  const out = new Map();
  let idx = 0;
  for (const m of stripped.matchAll(memberRe)) {
    const enumKey = m[1];
    const canon = canonicalizeName(enumKey);
    if (!out.has(canon)) {
      out.set(canon, idx);
    }
    idx++;
  }
  return out;
}

// =============================================================================
// Name normalisation
// =============================================================================

/**
 * Canonicalize an ability name for lookup. We collapse the name to lowercase
 * letters + digits only — that lets "Chilling Neigh" / "CHILLING_NEIGH" /
 * "chilling-neigh" all map to `chillingneigh`. The enum side feeds in
 * `CHILLING_NEIGH` (so we strip underscores too).
 *
 * @param {string} name
 * @returns {string} lowercase alphanumerics-only form
 */
function canonicalizeName(name) {
  return String(name)
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

// =============================================================================
// Part-name resolution
// =============================================================================

/**
 * Heuristic: an entry in the `parts` array is a real composite part name when
 * it's short and looks like Title Case (an ability name) — not a free-text
 * effect description like "deals 1.5x more damage to Grass-types".
 *
 * Returns `true` if the part should attempt name resolution; `false` if it's
 * a free-text rider that should fall through to the rider bucket.
 *
 * @param {string} part
 */
function looksLikeAbilityName(part) {
  // Real ability names in ER are <= 24 chars (Chlorophyll, Tipping Point,
  // Embody Aspect, Multi-Headed, Strong Jaw, …). Free-text riders are longer.
  if (part.length > 28) {
    return false;
  }
  // Reject parts containing %, digits with units, or obvious mid-sentence verbs.
  if (/%/.test(part)) {
    return false;
  }
  if (
    /\b(?:more|less|extra|chance|damage|moves?|hits?|attacks?|deals?|takes?|by|with|on|of|in|to|when|under|while|after|every)\b/i.test(
      part,
    )
  ) {
    return false;
  }
  // Reject "all <something>" / "blocks <something>" / "Resists" / etc.
  if (/^(?:all|blocks|sets|deals|halves?|adds|absorbs|attacks|heals?|boosts)\b/i.test(part)) {
    return false;
  }
  return true;
}

/**
 * Resolve a single part name against the pokerogue `AbilityId` enum and the
 * ER ability name index. Returns:
 *   - `{ kind: "pokerogue", abilityId }` if matched against the enum
 *   - `{ kind: "er", erAbilityId }` if matched against ER_ABILITIES
 *   - `null` if no match
 *
 * @param {string} part - raw part name (e.g. "Chilling Neigh")
 * @param {Map<string, number>} pokerogueAbilities - canonical name → AbilityId
 * @param {Map<string, number>} erAbilitiesByName - canonical name → erAbilityId
 */
function resolvePartName(part, pokerogueAbilities, erAbilitiesByName) {
  if (!looksLikeAbilityName(part)) {
    return null;
  }
  const canon = canonicalizeName(part);
  // Prefer vanilla pokerogue — they have proper AbAttr wiring already.
  if (pokerogueAbilities.has(canon)) {
    return { kind: "pokerogue", abilityId: pokerogueAbilities.get(canon) };
  }
  if (erAbilitiesByName.has(canon)) {
    return { kind: "er", erAbilityId: erAbilitiesByName.get(canon) };
  }
  return null;
}

// =============================================================================
// Resolution driver
// =============================================================================

/**
 * @typedef {Object} ResolvedPart
 * @property {"pokerogue" | "er"} kind
 * @property {number} [abilityId]
 * @property {number} [erAbilityId]
 */

/**
 * @typedef {Object} ResolvedComposite
 * @property {number} erAbilityId
 * @property {ResolvedPart[]} parts
 * @property {string[]} unresolvedParts
 * @property {boolean} hasRider
 * @property {string} [riderText]
 */

/**
 * Walk every `composite-vanilla-mashup` row, resolve each `parts[i]` name to
 * an `AbilityId` (vanilla) or `erAbilityId` (ER ability), and bucket the rest
 * as unresolved (free-text riders OR ability names we couldn't find).
 *
 * @param {{ erAbilityId: number, archetype: string, params: any }[]} archetypeRows
 * @param {Map<string, number>} pokerogueAbilities
 * @param {Map<string, number>} erAbilitiesByName
 * @returns {ResolvedComposite[]}
 */
function resolveAllComposites(archetypeRows, pokerogueAbilities, erAbilitiesByName) {
  /** @type {ResolvedComposite[]} */
  const out = [];
  for (const row of archetypeRows) {
    if (row.archetype !== "composite-vanilla-mashup") {
      continue;
    }
    out.push(resolveOneComposite(row, pokerogueAbilities, erAbilitiesByName));
  }
  return out;
}

/**
 * Resolve a single composite row's parts list into a `ResolvedComposite`.
 * Pure — caller batches the result. Split out so `resolveAllComposites`
 * stays within biome's cognitive-complexity budget.
 *
 * @param {{ erAbilityId: number, archetype: string, params: any }} row
 * @param {Map<string, number>} pokerogueAbilities
 * @param {Map<string, number>} erAbilitiesByName
 * @returns {ResolvedComposite}
 */
function resolveOneComposite(row, pokerogueAbilities, erAbilitiesByName) {
  const params = row.params ?? {};
  const rawParts = Array.isArray(params.parts) ? params.parts : [];
  /** @type {ResolvedPart[]} */
  const resolved = [];
  /** @type {string[]} */
  const unresolved = [];
  for (const part of rawParts) {
    if (typeof part !== "string") {
      continue;
    }
    const ref = resolvePartName(part, pokerogueAbilities, erAbilitiesByName);
    if (ref === null) {
      unresolved.push(part);
    } else {
      resolved.push(ref);
    }
  }
  const riderText = typeof params.rider === "string" ? params.rider : null;
  /** @type {ResolvedComposite} */
  const entry = {
    erAbilityId: row.erAbilityId,
    parts: resolved,
    unresolvedParts: unresolved,
    hasRider: riderText !== null || unresolved.length > 0,
  };
  if (riderText !== null) {
    entry.riderText = riderText;
  }
  return entry;
}

// =============================================================================
// Emitter
// =============================================================================

/**
 * Render a single resolved-part reference as a TypeScript object literal.
 * @param {ResolvedPart} ref
 * @returns {string}
 */
function renderPart(ref) {
  if (ref.kind === "pokerogue") {
    return `{ kind: "pokerogue", abilityId: ${ref.abilityId} }`;
  }
  return `{ kind: "er", erAbilityId: ${ref.erAbilityId} }`;
}

/**
 * Emit the body of `er-composite-parts.ts`. Pure — no IO — so tests can
 * exercise it with synthetic input.
 * @param {ResolvedComposite[]} resolved
 */
export function emitCompositePartsBody(resolved) {
  const sorted = [...resolved].sort((a, b) => a.erAbilityId - b.erAbilityId);
  const lines = [];
  for (const entry of sorted) {
    const partsBody = entry.parts.map(renderPart).join(", ");
    const unresolvedBody = entry.unresolvedParts.map(s => JSON.stringify(s)).join(", ");
    const fields = [`erAbilityId: ${entry.erAbilityId}`, `parts: [${partsBody}]`];
    if (entry.unresolvedParts.length > 0) {
      fields.push(`unresolvedParts: [${unresolvedBody}]`);
    }
    fields.push(`hasRider: ${entry.hasRider}`);
    if (entry.riderText !== undefined) {
      fields.push(`riderText: ${JSON.stringify(entry.riderText)}`);
    }
    lines.push(`  ${entry.erAbilityId}: { ${fields.join(", ")} },`);
  }
  return `// Phase D task D3b: per-composite resolved part references.
//
// For each ER ability whose archetype is \`composite-vanilla-mashup\`, this
// table records the constructable parts — either a vanilla pokerogue
// \`AbilityId\` (whose AbAttrs the dispatcher copies verbatim) or another
// ER \`erAbilityId\` (which the dispatcher recursively resolves through its
// own archetype row). Free-text riders ("triggers hail when hit") and ability
// names we couldn't match against the lookup tables surface in
// \`unresolvedParts\` for diagnostic surface.
//
// Regenerate with: \`pnpm run er:classify-composites\`.

/**
 * A single resolved part within a composite ability.
 *
 * Tagged-union shape: \`kind: "pokerogue"\` references a vanilla pokerogue
 * ability whose AbAttrs the dispatcher copies; \`kind: "er"\` references
 * another ER ability whose archetype row the dispatcher recursively
 * dispatches.
 */
export type ErCompositePartRef =
  | { readonly kind: "pokerogue"; readonly abilityId: number }
  | { readonly kind: "er"; readonly erAbilityId: number };

/**
 * One composite ability's resolved parts + diagnostic metadata.
 */
export interface ErCompositeEntry {
  /** ER ability id (the key under which this entry is registered). */
  readonly erAbilityId: number;
  /** Resolved part references. Each contributes its own AbAttrs to the composite. */
  readonly parts: readonly ErCompositePartRef[];
  /**
   * Part names from the classifier's \`parts\` array that we couldn't resolve
   * to either a pokerogue or ER ability. Usually free-text effect riders
   * ("triggers hail when hit"). The dispatcher logs these for triage; the
   * composite still wires up the resolved subset.
   */
  readonly unresolvedParts?: readonly string[];
  /** True when the composite has either a typed rider or any unresolved part. */
  readonly hasRider: boolean;
  /** The classifier-emitted rider sentence, if any. */
  readonly riderText?: string;
}

export const ER_COMPOSITE_PARTS: Readonly<Record<number, ErCompositeEntry>> = {
${lines.join("\n")}
};
`;
}

// =============================================================================
// Stats / reporting
// =============================================================================

/**
 * @param {ResolvedComposite[]} resolved
 */
function summarize(resolved) {
  const total = resolved.length;
  const fullyResolved = resolved.filter(r => r.unresolvedParts.length === 0 && r.parts.length >= 2).length;
  const partial = resolved.filter(
    r => r.parts.length > 0 && (r.unresolvedParts.length > 0 || r.parts.length < 2),
  ).length;
  const noParts = resolved.filter(r => r.parts.length === 0).length;
  const partsCounts = resolved.map(r => r.parts.length);
  const totalResolvedParts = partsCounts.reduce((a, b) => a + b, 0);
  const avgParts = total === 0 ? 0 : totalResolvedParts / total;
  const vanillaPartCount = resolved.reduce((acc, r) => acc + r.parts.filter(p => p.kind === "pokerogue").length, 0);
  const erPartCount = resolved.reduce((acc, r) => acc + r.parts.filter(p => p.kind === "er").length, 0);
  return { total, fullyResolved, partial, noParts, totalResolvedParts, avgParts, vanillaPartCount, erPartCount };
}

// =============================================================================
// Main
// =============================================================================

async function main() {
  const [abilitiesText, archetypesText, abilityIdText] = await Promise.all([
    readFile(ABILITIES_PATH, "utf8"),
    readFile(ARCHETYPES_PATH, "utf8"),
    readFile(ABILITY_ID_PATH, "utf8"),
  ]);

  const erAbilities = parseErAbilities(abilitiesText);
  const archetypeRows = parseErAbilityArchetypes(archetypesText);
  const pokerogueAbilities = parseAbilityIdEnum(abilityIdText);

  // Build the ER name → erAbilityId index. Use the same canonical-name
  // collapsing as for pokerogue so "Chilling Neigh" matches case-insensitively.
  /** @type {Map<string, number>} */
  const erAbilitiesByName = new Map();
  for (const a of erAbilities) {
    const canon = canonicalizeName(a.name);
    if (canon === "" || canon === "-------" || canon === "emptyabilityslot") {
      continue;
    }
    // Earliest id wins on collision (rare; happens for "-------" placeholders).
    if (!erAbilitiesByName.has(canon)) {
      erAbilitiesByName.set(canon, a.id);
    }
  }

  const resolved = resolveAllComposites(archetypeRows, pokerogueAbilities, erAbilitiesByName);
  const stats = summarize(resolved);

  // Build a per-unresolved-name frequency table for triage.
  const unresolvedCounts = new Map();
  for (const r of resolved) {
    for (const u of r.unresolvedParts) {
      unresolvedCounts.set(u, (unresolvedCounts.get(u) ?? 0) + 1);
    }
  }
  const topUnresolved = [...unresolvedCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12);

  console.log("# D3b composite classification report");
  console.log(`Total composites:                 ${stats.total}`);
  console.log(`Fully resolved (>= 2 parts):      ${stats.fullyResolved}`);
  console.log(`Partial (>= 1 part with rider):   ${stats.partial}`);
  console.log(`Unresolved (0 parts matched):     ${stats.noParts}`);
  console.log(`Total resolved part references:   ${stats.totalResolvedParts}`);
  console.log(`Avg parts per composite:          ${stats.avgParts.toFixed(2)}`);
  console.log(`  → vanilla pokerogue:            ${stats.vanillaPartCount}`);
  console.log(`  → ER recursive:                 ${stats.erPartCount}`);
  if (topUnresolved.length > 0) {
    console.log();
    console.log("Top unresolved part names (riders + unknown abilities):");
    for (const [name, count] of topUnresolved) {
      console.log(`  ${count}× ${name}`);
    }
  }

  const body = emitCompositePartsBody(resolved);
  await emitModule(OUT_PATH, body);
  console.log();
  console.log(`Wrote ${resolved.length} composite entries → ${OUT_PATH}`);
}

// =============================================================================
// Test surface
// =============================================================================

// Exposed for unit tests / future inspection without IO.
export {
  canonicalizeName,
  looksLikeAbilityName,
  parseAbilityIdEnum,
  parseErAbilities,
  parseErAbilityArchetypes,
  resolveAllComposites,
  resolvePartName,
};

const ENTRY = resolve(process.argv[1] ?? "");
const SELF = fileURLToPath(import.meta.url);
if (ENTRY === SELF) {
  main().catch(err => {
    console.error(err);
    process.exit(1);
  });
}
