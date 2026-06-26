/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Co-op ER DATA-TABLE FINGERPRINT (#633, diagnostics). A deterministic per-section
// 64-bit hash of the ER data tables that BOTH clients build at boot (the move id-map,
// the live move table, the species level-up movesets, the ability table). Two browsers
// that booted the SAME build are supposed to produce byte-identical tables; when they
// DON'T (the "host remapped 67 / guest remapped 1 / 598 dropped" divergence), the
// per-turn checksum then diverges and a resync reports "still-diverged". This module
// makes the ROOT data drift directly observable: each client computes its fingerprint
// once at connect, logs it, sends it over the wire, and the peer diffs section-by-section
// so we learn EXACTLY which table drifted (and by how much) BEFORE any battle runs.
//
// Reuses the SAME stable hash core as the per-turn checksum (`canonicalize` + `fnv1a64`
// from coop-battle-checksum.ts) so there is one determinism contract. NO Math.random /
// Date - the hash must be reproducible across clients. Engine-light (it reads the data
// registries, not `globalScene`), and every public function is wrapped so a read failure
// degrades to a zero/empty result instead of throwing into the co-op handshake.
// =============================================================================

import { pokemonSpeciesLevelMoves } from "#balance/pokemon-level-moves";
import { allAbilities, allMoves } from "#data/data-lists";
import { canonicalize, fnv1a64 } from "#data/elite-redux/coop/coop-battle-checksum";
import { coopLog } from "#data/elite-redux/coop/coop-debug";
import { ER_ID_MAP } from "#data/elite-redux/er-id-map";

/** One data table's section: the entry count + the stable hash over its sorted entries. */
export interface ErDataFingerprintSection {
  n: number;
  hash: string;
}

/**
 * A deterministic fingerprint of the four ER data tables that must be identical across
 * both co-op clients. Each section is an entry count + a 64-bit hex hash over the table's
 * entries iterated in SORTED order (so iteration order can never make two equal tables
 * hash differently).
 */
export interface ErDataFingerprint {
  /** `ER_ID_MAP.moves` (the ER move id -> pokerogue MoveId remap that the boot remap mutates). */
  moveMap: ErDataFingerprintSection;
  /**
   * The live `allMoves` table's DATA fields (`[id, power, type, category, accuracy, pp, priority]`,
   * NAME EXCLUDED). Split out from {@linkcode movesName} (#633 diagnostic) so a residual mismatch
   * proves whether the moves actually DRIFTED (this section differs -> real drift to chase) or only
   * their localized `name` differs (this section MATCHES, `movesName` differs -> cosmetic only).
   */
  movesData: ErDataFingerprintSection;
  /** The live `allMoves` table's NAME mapping (`[id, name]` per move) - the cosmetic half. */
  movesName: ErDataFingerprintSection;
  /** The per-species level-up movesets registry (`pokemonSpeciesLevelMoves`). */
  movesets: ErDataFingerprintSection;
  /**
   * The live `allAbilities` table's DATA fields (`[id, generation, postSummonPriority]` - the public
   * non-name fields the table carries). Split from {@linkcode abilitiesName} (#633 diagnostic) so a
   * residual mismatch separates real ability drift (this section differs) from a localized-name-only
   * difference (this section MATCHES, `abilitiesName` differs). Also pins the id-set + count.
   */
  abilitiesData: ErDataFingerprintSection;
  /** The live `allAbilities` table's NAME mapping (`[id, name]` per ability) - the cosmetic half. */
  abilitiesName: ErDataFingerprintSection;
}

/** An all-zeros section used when a table read fails (so the fingerprint never throws). */
const ZERO_SECTION: ErDataFingerprintSection = { n: 0, hash: fnv1a64("") };

/** A fully-zeroed fingerprint (every section the read-failure sentinel). */
const ZERO_FINGERPRINT: ErDataFingerprint = {
  moveMap: ZERO_SECTION,
  movesData: ZERO_SECTION,
  movesName: ZERO_SECTION,
  movesets: ZERO_SECTION,
  abilitiesData: ZERO_SECTION,
  abilitiesName: ZERO_SECTION,
};

/** Hash a value through the shared canonical stringifier + FNV core. */
function hashOf(value: unknown): string {
  return fnv1a64(canonicalize(value));
}

/** Fingerprint `ER_ID_MAP.moves`: sorted by numeric draft key -> `[draftId, mappedId]` pairs. */
function fingerprintMoveMap(): ErDataFingerprintSection {
  try {
    const map = ER_ID_MAP.moves as Record<number, number>;
    const pairs = Object.keys(map)
      .map(k => Number(k))
      .sort((a, b) => a - b)
      .map(id => [id, map[id]] as [number, number]);
    return { n: pairs.length, hash: hashOf(pairs) };
  } catch {
    return ZERO_SECTION;
  }
}

/**
 * Fingerprint `allMoves` DATA fields: real moves only, sorted by id -> `[id, power, type,
 * category, accuracy, pp, priority]` (NAME EXCLUDED). This is the "did the moves actually drift?"
 * half - a difference here is a REAL mechanic divergence, not a locale skin (#633 diagnostic).
 */
function fingerprintMovesData(): ErDataFingerprintSection {
  try {
    const rows = allMoves
      .filter(mv => mv != null)
      .map(mv => [mv.id, mv.power, mv.type, mv.category, mv.accuracy, mv.pp, mv.priority] as const)
      .sort((a, b) => a[0] - b[0]);
    return { n: rows.length, hash: hashOf(rows) };
  } catch {
    return ZERO_SECTION;
  }
}

/** Fingerprint `allMoves` NAMES: real moves only, sorted by id -> `[id, name]` (the cosmetic half). */
function fingerprintMovesName(): ErDataFingerprintSection {
  try {
    const rows = allMoves
      .filter(mv => mv != null)
      .map(mv => [mv.id, mv.name ?? ""] as const)
      .sort((a, b) => a[0] - b[0]);
    return { n: rows.length, hash: hashOf(rows) };
  } catch {
    return ZERO_SECTION;
  }
}

/** Fingerprint the species level-up movesets: sorted by speciesId -> `[speciesId, [[level,moveId]...]]`. */
function fingerprintMovesets(): ErDataFingerprintSection {
  try {
    const table = pokemonSpeciesLevelMoves as Record<number, [number, number][]>;
    const rows = Object.keys(table)
      .map(k => Number(k))
      .sort((a, b) => a - b)
      .map(speciesId => [speciesId, (table[speciesId] ?? []).map(([level, moveId]) => [level, moveId])] as const);
    return { n: rows.length, hash: hashOf(rows) };
  } catch {
    return ZERO_SECTION;
  }
}

/**
 * Fingerprint `allAbilities` DATA fields: real abilities only, sorted by id -> `[id, generation,
 * postSummonPriority]` (the public non-name fields the table carries; NAME EXCLUDED). This + its
 * count is the "did the abilities actually drift / id-set differ?" half (#633 diagnostic).
 */
function fingerprintAbilitiesData(): ErDataFingerprintSection {
  try {
    const rows = allAbilities
      .filter(ab => ab != null)
      .map(ab => [ab.id, ab.generation, ab.postSummonPriority] as const)
      .sort((a, b) => a[0] - b[0]);
    return { n: rows.length, hash: hashOf(rows) };
  } catch {
    return ZERO_SECTION;
  }
}

/** Fingerprint `allAbilities` NAMES: real abilities only, sorted by id -> `[id, name]` (cosmetic half). */
function fingerprintAbilitiesName(): ErDataFingerprintSection {
  try {
    const rows = allAbilities
      .filter(ab => ab != null)
      .map(ab => [ab.id, ab.name ?? ""] as const)
      .sort((a, b) => a[0] - b[0]);
    return { n: rows.length, hash: hashOf(rows) };
  } catch {
    return ZERO_SECTION;
  }
}

/**
 * Compute the local client's ER data-table fingerprint. Never throws: a read failure on
 * any section degrades that section to zeros so the co-op handshake is never broken by a
 * diagnostic. Iterates every table in SORTED order for cross-client stability.
 */
export function computeErDataFingerprint(): ErDataFingerprint {
  try {
    const fp: ErDataFingerprint = {
      moveMap: fingerprintMoveMap(),
      movesData: fingerprintMovesData(),
      movesName: fingerprintMovesName(),
      movesets: fingerprintMovesets(),
      abilitiesData: fingerprintAbilitiesData(),
      abilitiesName: fingerprintAbilitiesName(),
    };
    // Compute trace (#633): one grep-able line of the per-section counts so a reader can see
    // BOTH clients computed the fingerprint and how big each table is BEFORE any wire diff.
    coopLog(
      "checksum",
      `dataFingerprint compute moveMap=${fp.moveMap.hash}(${fp.moveMap.n}) movesData=${fp.movesData.hash}(${fp.movesData.n}) `
        + `movesName=${fp.movesName.hash}(${fp.movesName.n}) movesets=${fp.movesets.hash}(${fp.movesets.n}) `
        + `abilitiesData=${fp.abilitiesData.hash}(${fp.abilitiesData.n}) abilitiesName=${fp.abilitiesName.hash}(${fp.abilitiesName.n})`,
    );
    return fp;
  } catch {
    return { ...ZERO_FINGERPRINT };
  }
}

/** The six section names in a stable order (for diffing + logging). */
const FINGERPRINT_SECTIONS = [
  "moveMap",
  "movesData",
  "movesName",
  "movesets",
  "abilitiesData",
  "abilitiesName",
] as const;

/**
 * The names of the sections whose `{n,hash}` differ between two fingerprints (e.g.
 * `["moveMap","moves","movesets"]`). An empty array means the two clients' ER data tables
 * are identical.
 */
export function diffErDataFingerprint(a: ErDataFingerprint, b: ErDataFingerprint): string[] {
  const diff: string[] = [];
  for (const name of FINGERPRINT_SECTIONS) {
    const sa = a[name];
    const sb = b[name];
    if (sa.n !== sb.n || sa.hash !== sb.hash) {
      diff.push(name);
    }
  }
  return diff;
}

/** Log one client's full fingerprint, one line, grep-able under the `[coop-fp]` tag. */
export function logErDataFingerprint(tag: string, fp: ErDataFingerprint): void {
  console.info(
    `[coop-fp] ${tag} moveMap=${fp.moveMap.hash}(${fp.moveMap.n})`
      + ` movesData=${fp.movesData.hash}(${fp.movesData.n}) movesName=${fp.movesName.hash}(${fp.movesName.n})`
      + ` movesets=${fp.movesets.hash}(${fp.movesets.n})`
      + ` abilitiesData=${fp.abilitiesData.hash}(${fp.abilitiesData.n})`
      + ` abilitiesName=${fp.abilitiesName.hash}(${fp.abilitiesName.n})`,
  );
}

// =============================================================================
// Canonical deep-diff (#633, diagnostics) - the leaf-level "which FIELD diverged"
// reporter shared by the per-turn checksum pre-image diff and the resync still-diverged
// diff. Both sides hold the SAME canonical state object (the host streams its pre-image
// string; the guest recomputes its own), so once the opaque hashes disagree this walks
// the two JSON-parsed objects in lockstep and prints the differing LEAF paths - the exact
// field(s) that drifted. Never throws; capped so a wholesale divergence can't flood logs.
// =============================================================================

/** Max differing leaf paths to print before truncating (keeps a big divergence readable). */
const MAX_DIFF_LEAVES = 25;

/** Format a leaf value compactly for the diff log (objects/arrays via canonicalize). */
function formatLeaf(value: unknown): string {
  if (value === undefined) {
    return "<absent>";
  }
  if (value === null || typeof value === "number" || typeof value === "boolean" || typeof value === "string") {
    return String(value);
  }
  try {
    return canonicalize(value);
  } catch {
    return "<unprintable>";
  }
}

/** True for a non-null object/array we should recurse INTO rather than compare as a leaf. */
function isWalkable(value: unknown): value is Record<string, unknown> | unknown[] {
  return value !== null && typeof value === "object";
}

/**
 * Recursively collect the leaf paths where `host` and `guest` differ, appending
 * `  <path>: host=<v> guest=<v>` lines to `out` (capped at {@linkcode MAX_DIFF_LEAVES}).
 * Walks objects + arrays in a deterministic key order so the report is stable.
 */
function collectLeafDiffs(host: unknown, guest: unknown, path: string, out: string[]): void {
  if (out.length >= MAX_DIFF_LEAVES) {
    return;
  }
  if (isWalkable(host) && isWalkable(guest)) {
    const keys = new Set<string>([...Object.keys(host), ...Object.keys(guest)]);
    for (const key of [...keys].sort()) {
      if (out.length >= MAX_DIFF_LEAVES) {
        return;
      }
      const childPath = path === "" ? key : `${path}.${key}`;
      collectLeafDiffs((host as Record<string, unknown>)[key], (guest as Record<string, unknown>)[key], childPath, out);
    }
    return;
  }
  // One side is a leaf (or the two sides disagree on shape): compare via the canonical form.
  if (formatLeaf(host) !== formatLeaf(guest)) {
    out.push(`  ${path === "" ? "(root)" : path}: host=${formatLeaf(host)} guest=${formatLeaf(guest)}`);
  }
}

/**
 * Re-key a parsed canonical state's `field` array by battler index (#633, coop-me-authoritative
 * diagnostic). The hashed state's `field` is POSITION-indexed (an array sorted by `bi`), so a single
 * composition gap (a dropped switch/faint) shifts every later entry and RENUMBERS the whole array -
 * the diff then reports "25+ differing fields" for what is really ONE missing mon. Rekeying `field`
 * to an object keyed by `bi#<n>` aligns the two sides by battler index instead of array slot, so a
 * present-on-one-side bi shows as a single `<absent>` leaf that points straight at the real gap.
 * DIAGNOSTIC-ONLY: this transforms a COPY for the diff walk and NEVER touches the hashed state, so
 * the checksum is unaffected. A non-state shape (no `field` array) is returned unchanged. Never throws.
 */
function rekeyFieldByBi(state: unknown): unknown {
  try {
    if (!isWalkable(state) || Array.isArray(state)) {
      return state;
    }
    const obj = state as Record<string, unknown>;
    const field = obj.field;
    if (!Array.isArray(field)) {
      return state;
    }
    const byBi: Record<string, unknown> = {};
    field.forEach((mon, i) => {
      // Key by the mon's own battler index when present; fall back to the array slot so a malformed
      // entry without a `bi` still appears (never silently dropped from the diagnostic).
      const bi =
        isWalkable(mon) && typeof (mon as Record<string, unknown>).bi === "number"
          ? (mon as Record<string, unknown>).bi
          : `pos${i}`;
      byBi[`bi#${bi}`] = mon;
    });
    return { ...obj, field: byBi };
  } catch {
    return state;
  }
}

/**
 * Log up to ~25 differing LEAF paths between two JSON-parsed canonical state objects under
 * `tag` (e.g. `"[coop-cs] turn=3"`). Prints the `tag` header then one indented line per
 * differing leaf (`  <path>: host=<v> guest=<v>`), or a "no leaf differences" note when the
 * walk finds none (the divergence was structural / already healed). The `field` array is
 * re-keyed by battler index first (#633), so a single composition gap points at the real
 * missing bi (`field.bi#1: host=... guest=<absent>`) instead of renumbering every entry.
 * Never throws.
 */
export function logCanonicalDiff(tag: string, host: unknown, guest: unknown): void {
  try {
    const out: string[] = [];
    collectLeafDiffs(rekeyFieldByBi(host), rekeyFieldByBi(guest), "", out);
    if (out.length === 0) {
      console.warn(`${tag} no leaf differences found (structural / already converged)`);
      return;
    }
    const truncated = out.length >= MAX_DIFF_LEAVES;
    console.warn(`${tag} ${out.length}${truncated ? "+" : ""} differing field(s):`);
    for (const line of out) {
      console.warn(line);
    }
  } catch {
    /* a diff-logging failure must never crash the guest's battle */
  }
}
