/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Showdown teambuilder - SEARCH OPERATORS for the move dropdown (P3).
//
// Extends the plain typeahead with Showdown-style metadata filters typed straight into the same
// search field: `type:fire`, `cat:phys`, `bp>90`, `acc=100`, `pp<=10`. An operator token filters
// the move pane by that move's metadata; any REMAINING plain text still ranks the survivors by name
// through the existing `rankByFilter` pipeline. Multiple operators AND together ("type:fire bp>90").
//
// 🔴 BYTE-IDENTICAL GUARANTEE (maintainer requirement): a query containing NO recognized operator
// token parses to `{ operators: [], residual: <the original string> }`, so the caller takes the
// EXACT pre-existing `rankByFilter(list, name, filter)` path unchanged. Operators are strictly
// additive - the plain-prefix search a player already relies on is untouched.
//
// PURE (no engine / Phaser imports beyond the two lightweight enums) so it unit-tests with no boot;
// the handler supplies each move's {@linkcode MoveSearchMeta} extracted from `allMoves`.
// =============================================================================

import { MoveCategory } from "#enums/move-category";
import { PokemonType } from "#enums/pokemon-type";

/** The per-move metadata the operator predicates read (the handler maps a `Move` onto this). */
export interface MoveSearchMeta {
  /** The move's fielded type (a {@linkcode PokemonType}). */
  type: PokemonType;
  /** Base power; 0 for a status move, a variable-power move reports its table value. */
  power: number;
  /** Accuracy percentage; a never-miss move is <= 0 in the balance data (excluded from `acc>N`). */
  accuracy: number;
  /** {@linkcode MoveCategory} - PHYSICAL / SPECIAL / STATUS. */
  category: MoveCategory;
  /** Base PP. */
  pp: number;
}

/** A single parsed operator - a predicate over one move's metadata. */
export interface MoveSearchOperator {
  test(meta: MoveSearchMeta): boolean;
}

/** The result of parsing a raw filter string. `operators` empty => no operator present (plain path). */
export interface ParsedMoveSearch {
  operators: MoveSearchOperator[];
  /** The residual plain text (whitespace-joined non-operator tokens) for name ranking. */
  residual: string;
}

type NumericComparator = ">" | ">=" | "<" | "<=" | "=";

/** PokemonType NAME (lowercased) -> enum value, built once from the enum's reverse map. */
const TYPE_BY_NAME: ReadonlyMap<string, PokemonType> = (() => {
  const m = new Map<string, PokemonType>();
  for (const key of Object.keys(PokemonType)) {
    const val = (PokemonType as Record<string, unknown>)[key];
    if (typeof val === "number") {
      m.set(key.toLowerCase(), val as PokemonType);
    }
  }
  return m;
})();

/** Category token synonyms -> enum. */
function categoryFromToken(value: string): MoveCategory | null {
  switch (value.toLowerCase()) {
    case "phys":
    case "physical":
      return MoveCategory.PHYSICAL;
    case "spec":
    case "special":
    case "spatk":
      return MoveCategory.SPECIAL;
    case "status":
    case "stat":
      return MoveCategory.STATUS;
    default:
      return null;
  }
}

/** Read the numeric field an operator key targets, or null for a non-numeric key. */
function numericField(key: string): ((meta: MoveSearchMeta) => number) | null {
  switch (key) {
    case "bp":
    case "power":
    case "basepower":
      return m => m.power;
    case "acc":
    case "accuracy":
      return m => m.accuracy;
    case "pp":
      return m => m.pp;
    default:
      return null;
  }
}

/** Apply a comparator between a move's field value and the query number. */
function compareNumeric(actual: number, comparator: NumericComparator, target: number): boolean {
  switch (comparator) {
    case ">":
      return actual > target;
    case ">=":
      return actual >= target;
    case "<":
      return actual < target;
    case "<=":
      return actual <= target;
    case "=":
      return actual === target;
  }
}

// One token -> operator regex: a key, a comparator/separator, and a value. `:` is the categorical
// separator AND (for a numeric key) an alias for `=`.
const TOKEN_RE = /^([a-z]+)(>=|<=|>|<|=|:)(.+)$/i;

/**
 * Parse ONE whitespace-delimited token into an operator, or null when it is not a recognized operator
 * (in which case the caller keeps it as residual plain text). Recognizing an operator requires BOTH a
 * known key AND a resolvable value/comparator; a typo like `foo:bar` or `type>fire` is not an operator.
 */
function parseToken(token: string): MoveSearchOperator | null {
  const m = TOKEN_RE.exec(token);
  if (m == null) {
    return null;
  }
  const key = m[1].toLowerCase();
  const sep = m[2] as NumericComparator | ":";
  const value = m[3];

  // Categorical keys (type / category): only `:` or `=` make sense.
  if (key === "type") {
    if (sep !== ":" && sep !== "=") {
      return null;
    }
    const type = TYPE_BY_NAME.get(value.toLowerCase());
    if (type == null) {
      return null;
    }
    return { test: meta => meta.type === type };
  }
  if (key === "cat" || key === "category") {
    if (sep !== ":" && sep !== "=") {
      return null;
    }
    const cat = categoryFromToken(value);
    if (cat == null) {
      return null;
    }
    return { test: meta => meta.category === cat };
  }

  // Numeric keys (bp / acc / pp): any comparator, plus `:` as an alias for `=`.
  const field = numericField(key);
  if (field == null) {
    return null;
  }
  const target = Number(value);
  if (!Number.isFinite(target)) {
    return null;
  }
  const comparator: NumericComparator = sep === ":" ? "=" : sep;
  return { test: meta => compareNumeric(field(meta), comparator, target) };
}

/**
 * Parse a raw filter string into its operators + residual plain text. No recognized operator token
 * yields `{ operators: [], residual: filter }` (the byte-identical plain path).
 */
export function parseMoveSearch(filter: string): ParsedMoveSearch {
  const trimmed = filter.trim();
  if (trimmed.length === 0) {
    return { operators: [], residual: "" };
  }
  const operators: MoveSearchOperator[] = [];
  const residualTokens: string[] = [];
  for (const token of trimmed.split(/\s+/)) {
    const op = parseToken(token);
    if (op == null) {
      residualTokens.push(token);
    } else {
      operators.push(op);
    }
  }
  // No operator: hand back the ORIGINAL string so the caller's plain path is byte-identical.
  if (operators.length === 0) {
    return { operators: [], residual: filter };
  }
  return { operators, residual: residualTokens.join(" ") };
}

/** True when a move's metadata satisfies EVERY parsed operator (ANDed). */
export function matchesMoveSearch(meta: MoveSearchMeta, parsed: ParsedMoveSearch): boolean {
  return parsed.operators.every(op => op.test(meta));
}
