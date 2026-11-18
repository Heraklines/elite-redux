/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// The independent oracle of the L3 compile matrix: from the PURE vocabulary data alone (slots, WHEN
// provides, atom and effect requires) it says whether a WHEN x IF x DO triple SHOULD compile and, when
// not, which block the plain-language message has to name. It deliberately does not call the validator.

import {
  CONDITION_REGISTRY,
  type ConditionDef,
  conditionRequires,
} from "#data/elite-redux/ability-studio/vocabulary/conditions";
import { EFFECT_REGISTRY, type EffectDef } from "#data/elite-redux/ability-studio/vocabulary/effects";
import { getGuard } from "#data/elite-redux/ability-studio/vocabulary/guards";
import type { ParamDef, ParamValues } from "#data/elite-redux/ability-studio/vocabulary/params";
import { missingSlots, SLOTS } from "#data/elite-redux/ability-studio/vocabulary/slots";
import { WHEN_REGISTRY, type WhenDef } from "#data/elite-redux/ability-studio/vocabulary/when-registry";

export interface Verdict {
  readonly ok: boolean;
  /** Texts of which at least one must appear in the failure message (empty when ok). */
  readonly mentions: readonly string[];
  readonly why: string;
}

export const STATEFUL_ATOMS: ReadonlySet<string> = new Set(["rng.chance", "time.once-per", "time.nth-use"]);

export function slotWord(slot: string): string {
  return SLOTS.find(def => def.id === slot)?.label.toLowerCase() ?? slot;
}

export function defaultsOf(defs: readonly ParamDef[], patch: ParamValues = {}): ParamValues {
  return { ...Object.fromEntries(defs.map(def => [def.id, def.default])), ...patch };
}

/** Every `who`-style variant of an atom (its whoParam options), or one default variant. */
export function conditionVariants(def: ConditionDef): ParamValues[] {
  if (def.whoParam === undefined) {
    return [defaultsOf(def.params)];
  }
  const who = def.params.find(param => param.id === def.whoParam);
  return (who?.options ?? [String(who?.default)]).map(option =>
    defaultsOf(def.params, { [def.whoParam as string]: option }),
  );
}

export function verdictFor(
  when: WhenDef,
  cond: ConditionDef | undefined,
  condParams: ParamValues,
  effect: EffectDef,
): Verdict {
  const fail = (why: string, ...mentions: string[]): Verdict => ({ ok: false, mentions, why });
  if (when.kind === "while-active") {
    return fail("always-on flag", when.label);
  }
  if (when.baseClassOnly === true) {
    return fail("legacy grouping", when.label);
  }
  if (when.composable !== true) {
    return fail("trigger not wired yet", when.label);
  }
  if (cond !== undefined) {
    if (cond.escapeHatch === true) {
      return fail("escape hatch", cond.id);
    }
    if (when.kind === "calc" && (!cond.pure || STATEFUL_ATOMS.has(cond.id))) {
      return fail("dice or memory while calculating", cond.id);
    }
    const missing = missingSlots(conditionRequires(cond, condParams), when.provides);
    if (missing.length > 0) {
      return fail(`condition needs ${missing.join("+")}`, cond.id, ...missing.map(slotWord));
    }
  }
  if (!effect.implemented) {
    return fail("effect planned", effect.id);
  }
  const missingEffect = missingSlots(effect.requires, when.provides);
  if (missingEffect.length > 0) {
    return fail(`effect needs ${missingEffect.join("+")}`, effect.id, ...missingEffect.map(slotWord));
  }
  for (const guardId of effect.guards ?? []) {
    const guardMissing = missingSlots(getGuard(guardId)?.requires ?? [], when.provides);
    if (guardMissing.length > 0) {
      return fail(`safety rule ${guardId} needs ${guardMissing.join("+")}`, guardId, ...guardMissing.map(slotWord));
    }
  }
  if (effect.kind === "calc") {
    if (when.kind !== "calc") {
      return fail("calc effect on an event", effect.id);
    }
    if (when.modifies !== effect.modifies) {
      return fail("calc effect changes another value", effect.id);
    }
  } else if (effect.kind === "event" && when.kind !== "event") {
    return fail("event effect on a calculation", effect.id);
  } else if (effect.kind === "package") {
    return { ok: true, mentions: [], why: "package effect" };
  }
  return { ok: true, mentions: [], why: "compatible" };
}

export const ALL_WHENS = WHEN_REGISTRY;
export const ALL_CONDITIONS = CONDITION_REGISTRY;
export const ALL_EFFECTS = EFFECT_REGISTRY;
