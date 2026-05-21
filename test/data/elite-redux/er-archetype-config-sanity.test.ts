/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Elite Redux — Phase C Task C5: archetype-config sanity tests.
//
// What this exercises
// -------------------
//   1. **Per-archetype param shape**: every classifier-emitted row in
//      `ER_ABILITY_ARCHETYPES` and `ER_MOVE_ARCHETYPES` has a `params` object
//      whose shape matches the per-archetype validator. The validators encode
//      the contract the WIRE-UP layer (Phase D) will rely on — every wired
//      entry knows how to spell its params. `bespoke` rows are exempt
//      (they have `params: null` and need hand-written wiring).
//   2. **Cross-data referential integrity**: every ability id in the
//      archetype table maps to an entry in `ER_ABILITIES`; every move id maps
//      to an entry in `ER_MOVES`; every classifier-flag in a `flag-tagged-move`
//      row resolves via `ER_CLASSIFIER_FLAG_TO_MOVE_FLAG`; every ER id in the
//      archetype tables resolves through `ER_ID_MAP`.
//   3. **Sanity bounds**: archetype counts match the documented coverage
//      snapshot — a regression here means the classifier output drifted from
//      the coverage doc and one of the two needs updating.
//
// Why these tests exist
// ---------------------
//   The original Phase C plan called for a "golden replay" suite — 50
//   representative trainer battles replayed against the C0 battle harness
//   with turn-by-turn output diffs against a reference oracle. That requires
//   (a) the wire-up layer plugged into pokerogue's runtime battle flow and
//   (b) a reference oracle (ROM replay or hand-curated table). NEITHER
//   prerequisite is met at C5 time — the wire-up exists as data registries
//   (C2/C3/C4) but the runtime hooks are deferred to Phase D. A full replay
//   suite would also need weeks of integration work that doesn't add safety
//   on top of what the unit-test layer already locks in.
//
//   The REVISED scope (C5 in the task spec) is the invariant-check suite
//   below: we verify the data-shape consistency of what we have today and
//   defer the runtime-replay validation to Phase D. The audit script under
//   `scripts/elite-redux/audit-archetype-coverage.mjs` emits the canonical
//   bespoke-inventory + coverage docs that document the remaining hand-write
//   work.
// =============================================================================

import { ER_ABILITIES } from "#data/elite-redux/er-abilities";
import {
  ER_ABILITY_ARCHETYPES,
  type ErAbilityArchetypeEntry,
  type ErArchetypeKind,
} from "#data/elite-redux/er-ability-archetypes";
import { ER_CLASSIFIER_FLAG_TO_MOVE_FLAG } from "#data/elite-redux/er-flag-mapping";
import { ER_ID_MAP } from "#data/elite-redux/er-id-map";
import {
  ER_MOVE_ARCHETYPES,
  type ErMoveArchetypeEntry,
  type ErMoveArchetypeKind,
} from "#data/elite-redux/er-move-archetypes";
import { ER_MOVES } from "#data/elite-redux/er-moves";
import { describe, expect, it } from "vitest";

// =============================================================================
// Validator surface
// =============================================================================

/** Result shape returned by every per-archetype validator. */
interface ValidationResult {
  readonly valid: boolean;
  /** Missing required keys (e.g. `multiplier` not present). */
  readonly missing?: readonly string[];
  /** Keys present but failing their value check (e.g. `multiplier <= 0`). */
  readonly invalid?: readonly string[];
}

/** Helper to flag a single missing key. */
const missing = (...keys: string[]): ValidationResult => ({ valid: false, missing: keys });
/** Helper to flag a single invalid key. */
const invalid = (...keys: string[]): ValidationResult => ({ valid: false, invalid: keys });
/** Singleton success result. */
const OK: ValidationResult = { valid: true };

/**
 * Build a failure result with optional missing/invalid lists. Encapsulates
 * the `exactOptionalPropertyTypes: true` dance — never include a key whose
 * value would be `undefined` so the union stays compatible with
 * {@linkcode ValidationResult}.
 */
function fail(miss: readonly string[], inv: readonly string[]): ValidationResult {
  if (miss.length > 0 && inv.length > 0) {
    return { valid: false, missing: miss, invalid: inv };
  }
  if (miss.length > 0) {
    return { valid: false, missing: miss };
  }
  if (inv.length > 0) {
    return { valid: false, invalid: inv };
  }
  return OK;
}

/** Type guards used across validators. */
const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const isPositiveNumber = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v) && v > 0;
const isNonNegativeInteger = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v) && v >= 0;
const isNonZeroInteger = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v) && v !== 0;
const isNonEmptyString = (v: unknown): v is string => typeof v === "string" && v.length > 0;
const isNonEmptyStringArray = (v: unknown): v is string[] =>
  Array.isArray(v) && v.length > 0 && v.every(isNonEmptyString);

/**
 * Per-archetype validators for the ABILITY classifier output. Keyed by
 * `ErArchetypeKind`. The validators mirror what
 * `scripts/elite-redux/classify-abilities.mjs` emits — see each `extract:`
 * branch in that script for the source of truth.
 */
const ABILITY_VALIDATORS: Record<ErArchetypeKind, (params: unknown) => ValidationResult> = {
  "type-damage-boost": p => {
    if (!isObject(p)) {
      return missing("(root object)");
    }
    const errs: string[] = [];
    const miss: string[] = [];
    if (typeof p.type !== "string" || p.type.length === 0) {
      miss.push("type");
    }
    if (!isPositiveNumber(p.multiplier)) {
      errs.push("multiplier");
    }
    if (p.lowHpMultiplier !== undefined && !isPositiveNumber(p.lowHpMultiplier)) {
      errs.push("lowHpMultiplier");
    }
    if (p.lowHpThreshold !== undefined && (!isPositiveNumber(p.lowHpThreshold) || (p.lowHpThreshold as number) > 1)) {
      errs.push("lowHpThreshold");
    }
    if (p.recoilPct !== undefined && (!isPositiveNumber(p.recoilPct) || (p.recoilPct as number) > 1)) {
      errs.push("recoilPct");
    }
    return fail(miss, errs);
  },

  "flag-damage-boost": p => {
    if (!isObject(p)) {
      return missing("(root object)");
    }
    const errs: string[] = [];
    const miss: string[] = [];
    if (typeof p.flag !== "string" || p.flag.length === 0) {
      miss.push("flag");
    }
    if (!isPositiveNumber(p.multiplier)) {
      errs.push("multiplier");
    }
    return fail(miss, errs);
  },

  "priority-modifier": p => {
    if (!isObject(p)) {
      return missing("(root object)");
    }
    const errs: string[] = [];
    if (!isNonZeroInteger(p.priority)) {
      errs.push("priority");
    }
    if (p.filter !== undefined && !isObject(p.filter)) {
      errs.push("filter");
    }
    if (p.condition !== undefined && !(isObject(p.condition) && isNonEmptyString(p.condition.kind))) {
      errs.push("condition");
    }
    return errs.length > 0 ? { valid: false, invalid: errs } : OK;
  },

  "entry-effect": p => {
    if (!isObject(p)) {
      return missing("(root object)");
    }
    if (!isObject(p.effect)) {
      return missing("effect");
    }
    if (!isNonEmptyString(p.effect.kind)) {
      return missing("effect.kind");
    }
    // The discriminated union has many kinds; we sanity-check the kind label
    // is in the documented set. New kinds added to the classifier should be
    // mirrored here so the validator catches typos at test time.
    const knownKinds = new Set([
      "set-weather",
      "set-terrain",
      "set-hazard",
      "set-screen-or-room",
      "add-self-type",
      "self-stat-boost",
      "first-move-priority",
      "scripted-move",
      "lower-foe-stat",
      "set-misc",
      "misc",
    ]);
    if (!knownKinds.has(p.effect.kind as string)) {
      return invalid("effect.kind");
    }
    return OK;
  },

  "chance-status-on-hit": p => {
    if (!isObject(p)) {
      return missing("(root object)");
    }
    const errs: string[] = [];
    const miss: string[] = [];
    if (typeof p.chance !== "number" || p.chance < 0 || p.chance > 100) {
      errs.push("chance");
    }
    if (typeof p.status !== "string" || p.status.length === 0) {
      miss.push("status");
    }
    if (p.onContactOnly !== undefined && typeof p.onContactOnly !== "boolean") {
      errs.push("onContactOnly");
    }
    if (p.filter !== undefined && !isObject(p.filter)) {
      errs.push("filter");
    }
    return fail(miss, errs);
  },

  "crit-mod": p => {
    if (!isObject(p)) {
      return missing("(root object)");
    }
    if (!isObject(p.mod)) {
      return missing("mod");
    }
    if (!isNonEmptyString(p.mod.kind)) {
      return missing("mod.kind");
    }
    const knownKinds = new Set(["immune", "rate-bonus", "post-crit-mult"]);
    if (!knownKinds.has(p.mod.kind as string)) {
      return invalid("mod.kind");
    }
    if (p.mod.kind === "rate-bonus" && !isNonNegativeInteger(p.mod.bonus)) {
      return invalid("mod.bonus");
    }
    if (p.mod.kind === "post-crit-mult" && !isPositiveNumber(p.mod.multiplier)) {
      return invalid("mod.multiplier");
    }
    return OK;
  },

  "damage-reduction-generic": p => {
    if (!isObject(p)) {
      return missing("(root object)");
    }
    const errs: string[] = [];
    if (!isObject(p.filter)) {
      return missing("filter");
    }
    if (!isNonEmptyString(p.filter.kind)) {
      return missing("filter.kind");
    }
    if (typeof p.reduction !== "number" || p.reduction <= 0 || p.reduction >= 1) {
      errs.push("reduction");
    }
    return errs.length > 0 ? { valid: false, invalid: errs } : OK;
  },

  "passive-recovery": p => {
    if (!isObject(p)) {
      return missing("(root object)");
    }
    if (typeof p.healFraction !== "number" || p.healFraction <= 0 || p.healFraction > 1) {
      return invalid("healFraction");
    }
    return OK;
  },

  lifesteal: p => {
    if (!isObject(p)) {
      return missing("(root object)");
    }
    const errs: string[] = [];
    const miss: string[] = [];
    if (!isNonEmptyString(p.trigger)) {
      miss.push("trigger");
    }
    if (typeof p.healFraction !== "number" || p.healFraction <= 0 || p.healFraction > 1) {
      errs.push("healFraction");
    }
    return fail(miss, errs);
  },

  "stat-trigger-on-event": p => {
    if (!isObject(p)) {
      return missing("(root object)");
    }
    if (!isNonEmptyString(p.trigger)) {
      return missing("trigger");
    }
    if (!Array.isArray(p.stats)) {
      return missing("stats");
    }
    // Note: the classifier emits `stats: []` for some ER abilities whose
    // text was ambiguous (e.g. ability 916 — "Narcissist" with empty stat
    // payload). We accept empty arrays at the data-shape layer because the
    // wire-up step is responsible for either filling them in or routing to a
    // bespoke implementation.
    for (let i = 0; i < (p.stats as unknown[]).length; i++) {
      const change = (p.stats as unknown[])[i];
      if (!isObject(change)) {
        return invalid(`stats[${i}]`);
      }
      if (!isNonEmptyString(change.stat)) {
        return missing(`stats[${i}].stat`);
      }
      // The classifier emits either { stages } or { percentBoost } or { multiplier }
      // depending on the source text. We accept any of those.
      if (change.stages === undefined && change.percentBoost === undefined && change.multiplier === undefined) {
        return missing(`stats[${i}].(stages|percentBoost|multiplier)`);
      }
    }
    return OK;
  },

  "type-conversion": p => {
    if (!isObject(p)) {
      return missing("(root object)");
    }
    const errs: string[] = [];
    const miss: string[] = [];
    if (!isNonEmptyString(p.sourceType)) {
      miss.push("sourceType");
    }
    if (!isNonEmptyString(p.targetType)) {
      miss.push("targetType");
    }
    if (p.multiplier !== undefined && !isPositiveNumber(p.multiplier)) {
      errs.push("multiplier");
    }
    if (p.flag !== undefined && !isNonEmptyString(p.flag)) {
      errs.push("flag");
    }
    return fail(miss, errs);
  },

  "type-resist-or-absorb": p => {
    if (!isObject(p)) {
      return missing("(root object)");
    }
    // `type` can be a string (single type) OR a string[] (multi-type).
    const t = p.type;
    if (typeof t !== "string" && !isNonEmptyStringArray(t)) {
      return missing("type");
    }
    if (!isObject(p.effect)) {
      return missing("effect");
    }
    if (!isNonEmptyString(p.effect.kind)) {
      return missing("effect.kind");
    }
    const knownEffectKinds = new Set(["resist", "absorb"]);
    if (!knownEffectKinds.has(p.effect.kind as string)) {
      return invalid("effect.kind");
    }
    if (p.effect.kind === "resist" && typeof p.effect.multiplier !== "number") {
      return invalid("effect.multiplier");
    }
    return OK;
  },

  "type-effectiveness-override": p => {
    // Reserved archetype kind — currently no entries in the classifier output.
    // Validator stays permissive until C-tier classification emits these.
    if (!isObject(p)) {
      return missing("(root object)");
    }
    return OK;
  },

  "composite-vanilla-mashup": p => {
    if (!isObject(p)) {
      return missing("(root object)");
    }
    if (!Array.isArray(p.parts) || p.parts.length === 0) {
      return missing("parts");
    }
    if (!(p.parts as unknown[]).every(part => typeof part === "string" && (part as string).length > 0)) {
      return invalid("parts");
    }
    return OK;
  },

  "weather-or-terrain-interaction": p => {
    if (!isObject(p)) {
      return missing("(root object)");
    }
    if (!isObject(p.condition)) {
      return missing("condition");
    }
    const cond = p.condition;
    if (typeof cond.weather !== "string" && typeof cond.terrain !== "string") {
      return missing("condition.weather|condition.terrain");
    }
    if (!isObject(p.effect)) {
      return missing("effect");
    }
    if (!isNonEmptyString(p.effect.kind)) {
      return missing("effect.kind");
    }
    return OK;
  },

  "multi-hit-override": p => {
    if (!isObject(p)) {
      return missing("(root object)");
    }
    if (!isObject(p.filter)) {
      return missing("filter");
    }
    if (!isNonEmptyString(p.filter.kind)) {
      return missing("filter.kind");
    }
    // `hits` is either a number (fixed) OR a [min, max] tuple (variable).
    if (typeof p.hits === "number") {
      if (!Number.isInteger(p.hits) || (p.hits as number) < 2) {
        return invalid("hits");
      }
    } else if (Array.isArray(p.hits)) {
      if (p.hits.length !== 2) {
        return invalid("hits");
      }
      const [lo, hi] = p.hits as unknown[];
      if (!Number.isInteger(lo) || !Number.isInteger(hi) || (lo as number) < 2 || (hi as number) < (lo as number)) {
        return invalid("hits");
      }
    } else {
      return missing("hits");
    }
    return OK;
  },

  "accuracy-mod": p => {
    if (!isObject(p)) {
      return missing("(root object)");
    }
    if (!isObject(p.filter)) {
      return missing("filter");
    }
    if (!isObject(p.override)) {
      return missing("override");
    }
    if (!isNonEmptyString(p.override.mode)) {
      return missing("override.mode");
    }
    const knownModes = new Set(["set", "delta"]);
    if (!knownModes.has(p.override.mode as string)) {
      return invalid("override.mode");
    }
    if (typeof p.override.value !== "number") {
      return invalid("override.value");
    }
    return OK;
  },

  "proc-followup-attack": p => {
    if (!isObject(p)) {
      return missing("(root object)");
    }
    if (!isNonEmptyString(p.followup)) {
      return missing("followup");
    }
    if (p.followupBp !== undefined && !isPositiveNumber(p.followupBp)) {
      return invalid("followupBp");
    }
    if (!isObject(p.trigger)) {
      return missing("trigger");
    }
    return OK;
  },

  "on-hit-counter-attack": p => {
    if (!isObject(p)) {
      return missing("(root object)");
    }
    if (!isNonEmptyString(p.counterMove)) {
      return missing("counterMove");
    }
    if (p.counterBp !== undefined && !isPositiveNumber(p.counterBp)) {
      return invalid("counterBp");
    }
    if (p.filter !== undefined && !isObject(p.filter)) {
      return invalid("filter");
    }
    return OK;
  },

  "status-immunity": p => {
    if (!isObject(p)) {
      return missing("(root object)");
    }
    if (!Array.isArray(p.statuses)) {
      return missing("statuses");
    }
    if (!(p.statuses as unknown[]).every(s => typeof s === "string")) {
      return invalid("statuses");
    }
    if (p.tags !== undefined && (!Array.isArray(p.tags) || !(p.tags as unknown[]).every(s => typeof s === "string"))) {
      return invalid("tags");
    }
    return OK;
  },

  "conditional-damage": p => {
    if (!isObject(p)) {
      return missing("(root object)");
    }
    if (!isObject(p.condition)) {
      return missing("condition");
    }
    if (!isNonEmptyString(p.condition.kind)) {
      return missing("condition.kind");
    }
    if (!isPositiveNumber(p.multiplier)) {
      return invalid("multiplier");
    }
    return OK;
  },

  "form-change": p => {
    if (!isObject(p)) {
      return missing("(root object)");
    }
    if (!isNonEmptyString(p.trigger)) {
      return missing("trigger");
    }
    return OK;
  },

  "move-replacement": p => {
    if (!isObject(p)) {
      return missing("(root object)");
    }
    if (!isNonEmptyString(p.mode)) {
      return missing("mode");
    }
    const knownModes = new Set(["all-moves", "single-move", "type-status-swap"]);
    if (!knownModes.has(p.mode as string)) {
      return invalid("mode");
    }
    if (p.mode === "single-move" && !isNonEmptyString(p.originalMove)) {
      return missing("originalMove");
    }
    if (p.mode === "type-status-swap") {
      if (!isNonEmptyString(p.type)) {
        return missing("type");
      }
      if (!isNonEmptyString(p.newStatus)) {
        return missing("newStatus");
      }
      if (!isNonEmptyString(p.oldStatus)) {
        return missing("oldStatus");
      }
    }
    return OK;
  },

  bespoke: () => OK, // bespoke entries have `params: null` and need no shape check
};

/**
 * Per-archetype validators for the MOVE classifier output. Keyed by
 * `ErMoveArchetypeKind`. The kinds are a subset of the ability kinds — moves
 * have a tighter set of shapes the classifier emits.
 */
const MOVE_VALIDATORS: Record<ErMoveArchetypeKind, (params: unknown) => ValidationResult> = {
  "flag-tagged-move": p => {
    if (!isObject(p)) {
      return missing("(root object)");
    }
    if (!Array.isArray(p.flags) || p.flags.length === 0) {
      return missing("flags");
    }
    if (!(p.flags as unknown[]).every(f => typeof f === "string" && (f as string).length > 0)) {
      return invalid("flags");
    }
    if (p.statusChance !== undefined) {
      if (!isObject(p.statusChance)) {
        return invalid("statusChance");
      }
      if (typeof p.statusChance.chance !== "number") {
        return invalid("statusChance.chance");
      }
      if (!isNonEmptyString(p.statusChance.status)) {
        return invalid("statusChance.status");
      }
    }
    return OK;
  },

  "chance-status-on-hit": p => {
    if (!isObject(p)) {
      return missing("(root object)");
    }
    const errs: string[] = [];
    const miss: string[] = [];
    if (typeof p.chance !== "number" || p.chance < 0 || p.chance > 100) {
      errs.push("chance");
    }
    if (!isNonEmptyString(p.status)) {
      miss.push("status");
    }
    return fail(miss, errs);
  },

  "type-conversion": p => {
    if (!isObject(p)) {
      return missing("(root object)");
    }
    if (!isNonEmptyString(p.mode)) {
      return missing("mode");
    }
    if (!isNonEmptyStringArray(p.types)) {
      return missing("types");
    }
    if (p.statusChance !== undefined) {
      if (!isObject(p.statusChance)) {
        return invalid("statusChance");
      }
      if (typeof p.statusChance.chance !== "number") {
        return invalid("statusChance.chance");
      }
      if (!isNonEmptyString(p.statusChance.status)) {
        return invalid("statusChance.status");
      }
    }
    return OK;
  },

  "conditional-damage": p => {
    if (!isObject(p)) {
      return missing("(root object)");
    }
    if (!isObject(p.condition)) {
      return missing("condition");
    }
    if (!isNonEmptyString(p.condition.kind)) {
      return missing("condition.kind");
    }
    if (!isPositiveNumber(p.multiplier)) {
      return invalid("multiplier");
    }
    return OK;
  },

  "recoil-or-drain": p => {
    if (!isObject(p)) {
      return missing("(root object)");
    }
    if (!isNonEmptyString(p.mode)) {
      return missing("mode");
    }
    if (p.mode === "recoil") {
      if (!isPositiveNumber(p.recoilPct) || (p.recoilPct as number) > 1) {
        return invalid("recoilPct");
      }
    } else if (p.mode === "drain") {
      if (!isPositiveNumber(p.drainPct) || (p.drainPct as number) > 1) {
        return invalid("drainPct");
      }
    } else {
      return invalid("mode");
    }
    return OK;
  },

  bespoke: () => OK,
};

/**
 * Format a `ValidationResult` failure for use in test error messages.
 * Keeps the messages compact + grep-friendly so a single failing row tells
 * you exactly which key tripped it.
 */
function formatFailure(result: ValidationResult): string {
  const parts: string[] = [];
  if (result.missing && result.missing.length > 0) {
    parts.push(`missing=[${result.missing.join(",")}]`);
  }
  if (result.invalid && result.invalid.length > 0) {
    parts.push(`invalid=[${result.invalid.join(",")}]`);
  }
  return parts.join(" ");
}

// =============================================================================
// 1. Archetype-config sanity tests
// =============================================================================

describe("ER archetype-config sanity (C5)", () => {
  describe("ABILITY archetype rows", () => {
    it("every row has a known archetype kind", () => {
      const knownKinds = new Set<string>(Object.keys(ABILITY_VALIDATORS));
      const offenders: { id: number; archetype: string }[] = [];
      for (const entry of Object.values(ER_ABILITY_ARCHETYPES) as ErAbilityArchetypeEntry[]) {
        if (!knownKinds.has(entry.archetype)) {
          offenders.push({ id: entry.erAbilityId, archetype: entry.archetype });
        }
      }
      expect(offenders, `unknown ability archetype kinds: ${JSON.stringify(offenders)}`).toEqual([]);
    });

    it("every classified (non-bespoke) row has non-null params with the right shape", () => {
      const failures: { id: number; archetype: ErArchetypeKind; reason: string }[] = [];
      for (const entry of Object.values(ER_ABILITY_ARCHETYPES) as ErAbilityArchetypeEntry[]) {
        if (entry.archetype === "bespoke") {
          continue;
        }
        if (entry.params === null) {
          failures.push({ id: entry.erAbilityId, archetype: entry.archetype, reason: "params === null" });
          continue;
        }
        const validator = ABILITY_VALIDATORS[entry.archetype];
        const result = validator(entry.params);
        if (!result.valid) {
          failures.push({
            id: entry.erAbilityId,
            archetype: entry.archetype,
            reason: formatFailure(result),
          });
        }
      }
      // Surfacing the first failure in the assertion message keeps the
      // signal-to-noise high; CI will show the entire list in the diff.
      expect(failures, `${failures.length} ability archetype rows failed shape validation`).toEqual([]);
    });

    it("every bespoke row has params: null (the explicit signal for hand-write)", () => {
      const offenders: number[] = [];
      for (const entry of Object.values(ER_ABILITY_ARCHETYPES) as ErAbilityArchetypeEntry[]) {
        if (entry.archetype === "bespoke" && entry.params !== null) {
          offenders.push(entry.erAbilityId);
        }
      }
      expect(offenders, `bespoke entries should carry null params; got ${offenders.length} exceptions`).toEqual([]);
    });
  });

  describe("MOVE archetype rows", () => {
    it("every row has a known archetype kind", () => {
      const knownKinds = new Set<string>(Object.keys(MOVE_VALIDATORS));
      const offenders: { id: number; archetype: string }[] = [];
      for (const entry of Object.values(ER_MOVE_ARCHETYPES) as ErMoveArchetypeEntry[]) {
        if (!knownKinds.has(entry.archetype)) {
          offenders.push({ id: entry.erMoveId, archetype: entry.archetype });
        }
      }
      expect(offenders, `unknown move archetype kinds: ${JSON.stringify(offenders)}`).toEqual([]);
    });

    it("every classified (non-bespoke) row has non-null params with the right shape", () => {
      const failures: { id: number; archetype: ErMoveArchetypeKind; reason: string }[] = [];
      for (const entry of Object.values(ER_MOVE_ARCHETYPES) as ErMoveArchetypeEntry[]) {
        if (entry.archetype === "bespoke") {
          continue;
        }
        if (entry.params === null) {
          failures.push({ id: entry.erMoveId, archetype: entry.archetype, reason: "params === null" });
          continue;
        }
        const validator = MOVE_VALIDATORS[entry.archetype];
        const result = validator(entry.params);
        if (!result.valid) {
          failures.push({
            id: entry.erMoveId,
            archetype: entry.archetype,
            reason: formatFailure(result),
          });
        }
      }
      expect(failures, `${failures.length} move archetype rows failed shape validation`).toEqual([]);
    });

    it("every bespoke row has params: null", () => {
      const offenders: number[] = [];
      for (const entry of Object.values(ER_MOVE_ARCHETYPES) as ErMoveArchetypeEntry[]) {
        if (entry.archetype === "bespoke" && entry.params !== null) {
          offenders.push(entry.erMoveId);
        }
      }
      expect(offenders, `bespoke entries should carry null params; got ${offenders.length} exceptions`).toEqual([]);
    });
  });
});

// =============================================================================
// 2. Cross-data referential integrity
// =============================================================================

describe("ER archetype cross-data integrity (C5)", () => {
  it("every ability id in ER_ABILITY_ARCHETYPES exists in ER_ABILITIES", () => {
    const abilityIds = new Set<number>(ER_ABILITIES.map(a => a.id));
    const orphans: number[] = [];
    for (const entry of Object.values(ER_ABILITY_ARCHETYPES) as ErAbilityArchetypeEntry[]) {
      if (!abilityIds.has(entry.erAbilityId)) {
        orphans.push(entry.erAbilityId);
      }
    }
    expect(orphans, `archetype rows reference ${orphans.length} unknown ability ids`).toEqual([]);
  });

  it("every move id in ER_MOVE_ARCHETYPES exists in ER_MOVES", () => {
    const moveIds = new Set<number>(ER_MOVES.map(m => m.id));
    const orphans: number[] = [];
    for (const entry of Object.values(ER_MOVE_ARCHETYPES) as ErMoveArchetypeEntry[]) {
      if (!moveIds.has(entry.erMoveId)) {
        orphans.push(entry.erMoveId);
      }
    }
    expect(orphans, `archetype rows reference ${orphans.length} unknown move ids`).toEqual([]);
  });

  it("every ability id in ER_ABILITY_ARCHETYPES is mapped via ER_ID_MAP.abilities", () => {
    const orphans: number[] = [];
    for (const entry of Object.values(ER_ABILITY_ARCHETYPES) as ErAbilityArchetypeEntry[]) {
      if (!Object.hasOwn(ER_ID_MAP.abilities, entry.erAbilityId)) {
        orphans.push(entry.erAbilityId);
      }
    }
    expect(orphans, `${orphans.length} archetype ability ids missing from ER_ID_MAP.abilities`).toEqual([]);
  });

  it("every move id in ER_MOVE_ARCHETYPES is mapped via ER_ID_MAP.moves", () => {
    const orphans: number[] = [];
    for (const entry of Object.values(ER_MOVE_ARCHETYPES) as ErMoveArchetypeEntry[]) {
      if (!Object.hasOwn(ER_ID_MAP.moves, entry.erMoveId)) {
        orphans.push(entry.erMoveId);
      }
    }
    expect(orphans, `${orphans.length} archetype move ids missing from ER_ID_MAP.moves`).toEqual([]);
  });

  it("every flag in a flag-tagged-move entry resolves via ER_CLASSIFIER_FLAG_TO_MOVE_FLAG", () => {
    const unmapped: { erMoveId: number; flag: string }[] = [];
    for (const entry of Object.values(ER_MOVE_ARCHETYPES) as ErMoveArchetypeEntry[]) {
      if (entry.archetype !== "flag-tagged-move") {
        continue;
      }
      const flags = (entry.params as { flags?: readonly string[] } | null)?.flags ?? [];
      for (const flag of flags) {
        if (!Object.hasOwn(ER_CLASSIFIER_FLAG_TO_MOVE_FLAG, flag)) {
          unmapped.push({ erMoveId: entry.erMoveId, flag });
        }
      }
    }
    expect(unmapped, `${unmapped.length} flag-tagged-move flag refs are unmapped`).toEqual([]);
  });
});

// =============================================================================
// 3. Coverage sanity bounds
// =============================================================================

describe("ER Phase C coverage sanity (C5)", () => {
  it("ability archetype counts match the documented coverage snapshot", () => {
    const counts: Record<string, number> = {};
    for (const entry of Object.values(ER_ABILITY_ARCHETYPES) as ErAbilityArchetypeEntry[]) {
      counts[entry.archetype] = (counts[entry.archetype] ?? 0) + 1;
    }
    const total = Object.values(counts).reduce((a, b) => a + b, 0);
    const bespoke = counts.bespoke ?? 0;
    const classified = total - bespoke;
    // Snapshot values are tracked in docs/plans/elite-redux-phase-c-coverage.md
    // — if either side drifts, the audit script regenerates the doc and this
    // test should be updated to match. We pin TOTAL but allow the per-bucket
    // distribution to grow as the classifier improves.
    expect(total, "total ability archetype rows").toBe(736);
    expect(bespoke).toBeGreaterThan(200);
    expect(bespoke).toBeLessThan(300);
    expect(classified).toBeGreaterThan(400);
    expect(classified).toBeLessThan(550);
  });

  it("move archetype counts match the documented coverage snapshot", () => {
    const counts: Record<string, number> = {};
    for (const entry of Object.values(ER_MOVE_ARCHETYPES) as ErMoveArchetypeEntry[]) {
      counts[entry.archetype] = (counts[entry.archetype] ?? 0) + 1;
    }
    const total = Object.values(counts).reduce((a, b) => a + b, 0);
    const bespoke = counts.bespoke ?? 0;
    const classified = total - bespoke;
    expect(total, "total move archetype rows").toBe(187);
    expect(bespoke).toBeGreaterThan(40);
    expect(bespoke).toBeLessThan(100);
    expect(classified).toBeGreaterThan(100);
    expect(classified).toBeLessThan(150);
  });
});
