/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Elite Redux — editor-managed BALANCE TUNING (er-balance-tuning.json).
//
// Read-time getters over the knob registry (er-balance-knobs.ts). Overrides are
// ADDITIVE: an absent key keeps the registry default. Every override is
// VALIDATED against the knob's constraints (range, integer, length, ordering)
// and anything invalid is IGNORED with a console warning — a bad committed
// value can never break the game, it just falls back to the default.
//
// Consumers call the typed getter matching the knob's kind:
//   erBalanceNum("er.shiny.multHell")          → number
//   erBalanceArr("vanilla.eggs.rareEggMoveRates") → readonly number[]
//   erBalancePairs("er.elite.bstCaps")          → readonly [number, number][]
//   erBalanceMap("er.items.resistBerryPct")     → Readonly<Record<string, number>>
// Map overrides merge PER KEY over the default map (unknown keys are dropped).
// =============================================================================

import { ER_BALANCE_KNOB_BY_KEY, type ErBalanceKnob } from "#data/elite-redux/er-balance-knobs";
import balanceTuningJson from "./er-balance-tuning.json";

let activeTuning: Record<string, unknown> = balanceTuningJson as Record<string, unknown>;

/** Resolved-value cache; cleared when the tuning table is swapped (tests). */
let cache = new Map<string, unknown>();
const warned = new Set<string>();

/** Test hook: replace (or with `undefined` restore) the active tuning table. */
export function setErBalanceTuningForTesting(tuning?: Record<string, unknown>): void {
  activeTuning = tuning ?? (balanceTuningJson as Record<string, unknown>);
  cache = new Map();
  warned.clear();
}

function warnOnce(key: string, reason: string): void {
  if (!warned.has(key)) {
    warned.add(key);
    console.warn(`[er-balance-tuning] ignoring invalid override for "${key}": ${reason} — using the default`);
  }
}

function knobOf(key: string): ErBalanceKnob {
  const knob = ER_BALANCE_KNOB_BY_KEY.get(key);
  if (knob === undefined) {
    throw new Error(`[er-balance-tuning] unknown balance knob "${key}" — add it to er-balance-knobs.ts`);
  }
  return knob;
}

function isValidNumber(v: unknown, knob: ErBalanceKnob): v is number {
  return (
    typeof v === "number"
    && Number.isFinite(v)
    && v >= knob.min
    && v <= knob.max
    && (!knob.integer || Number.isInteger(v))
  );
}

function orderingOk(values: readonly number[], ordering: "asc" | "desc" | undefined): boolean {
  if (ordering === undefined) {
    return true;
  }
  for (let i = 1; i < values.length; i++) {
    if (ordering === "asc" ? values[i] < values[i - 1] : values[i] > values[i - 1]) {
      return false;
    }
  }
  return true;
}

function resolve(key: string): unknown {
  if (cache.has(key)) {
    return cache.get(key);
  }
  const knob = knobOf(key);
  const raw = activeTuning[key];
  let value: unknown = knob.default;

  if (raw !== undefined && raw !== null) {
    switch (knob.kind) {
      case "scalar":
        if (isValidNumber(raw, knob)) {
          value = raw;
        } else {
          warnOnce(key, `expected a number in [${knob.min}, ${knob.max}]${knob.integer ? " (integer)" : ""}`);
        }
        break;
      case "array":
        if (
          Array.isArray(raw)
          && (knob.length === undefined || raw.length === knob.length)
          && raw.every(v => isValidNumber(v, knob))
          && orderingOk(raw as number[], knob.ordering)
        ) {
          value = raw;
        } else {
          warnOnce(
            key,
            `expected ${knob.length ?? "N"} numbers in [${knob.min}, ${knob.max}]${knob.ordering ? ` in ${knob.ordering} order` : ""}`,
          );
        }
        break;
      case "pairs":
        if (
          Array.isArray(raw)
          && raw.length >= 1
          && (knob.length === undefined || raw.length <= knob.length)
          && raw.every(
            p => Array.isArray(p) && p.length === 2 && isValidNumber(p[0], knob) && isValidNumber(p[1], knob),
          )
          && orderingOk(
            (raw as [number, number][]).map(p => p[0]),
            "asc",
          )
          && orderingOk(
            (raw as [number, number][]).map(p => p[1]),
            "asc",
          )
        ) {
          value = raw;
        } else {
          warnOnce(key, `expected 1-${knob.length ?? "N"} [a, b] pairs with both columns increasing`);
        }
        break;
      case "map":
        if (typeof raw === "object" && !Array.isArray(raw)) {
          const defaults = knob.default as Readonly<Record<string, number>>;
          const merged: Record<string, number> = { ...defaults };
          for (const [mapKey, mapValue] of Object.entries(raw as Record<string, unknown>)) {
            if (!Object.hasOwn(defaults, mapKey)) {
              warnOnce(`${key}.${mapKey}`, "unknown map key");
            } else if (isValidNumber(mapValue, knob)) {
              merged[mapKey] = mapValue;
            } else {
              warnOnce(`${key}.${mapKey}`, `expected a number in [${knob.min}, ${knob.max}]`);
            }
          }
          value = merged;
        } else {
          warnOnce(key, "expected an object of named numbers");
        }
        break;
    }
  }

  cache.set(key, value);
  return value;
}

/** Scalar knob value (the override when valid, else the registry default). */
export function erBalanceNum(key: string): number {
  return resolve(key) as number;
}

/** Array knob value. */
export function erBalanceArr(key: string): readonly number[] {
  return resolve(key) as readonly number[];
}

/** Pairs knob value ([a, b] rows, both columns ascending). */
export function erBalancePairs(key: string): ReadonlyArray<readonly [number, number]> {
  return resolve(key) as ReadonlyArray<readonly [number, number]>;
}

/** Map knob value (default map with valid per-key overrides applied). */
export function erBalanceMap(key: string): Readonly<Record<string, number>> {
  return resolve(key) as Readonly<Record<string, number>>;
}
