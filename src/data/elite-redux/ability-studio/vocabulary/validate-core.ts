/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// PURE vocabulary file: no game imports. Validation of the V2 `composition` field, driven only by
// vocabulary data (so the editor worker can run it from the bundled vocabulary.json).
//
// THIS FILE IS THE WORKER-SAFE CORE: it takes the vocabulary as an argument and imports no registry, so
// bundling it (worker, AI container) does not drag the game-side tables along. validate-composition.ts
// wraps it with the live vocabulary as default.

import {
  type BlockRef,
  COMPOSITION_LIMITS,
  type ConditionNode,
  isBlockRef,
  isGroupAll,
  isGroupAny,
  isGroupNot,
} from "./composition-types";
import type { ConditionDef } from "./conditions";
import type { EffectDef } from "./effects";
import type { GuardDef } from "./guards";
import { type ParamValues, validateParamValues } from "./params";
import { missingSlots, SLOT_IDS, SLOTS, type SlotId } from "./slots";
import type { VocabularyJson, VocabularyWhen } from "./vocabulary-json";

/** The limits this validator enforces, for callers that only hold the bundled copy (the AI container prompt). */
export const VALIDATOR_LIMITS = COMPOSITION_LIMITS;

const RULE_KEYS = new Set(["key", "when", "if", "do", "chance"]);
const BLOCK_KEYS = new Set(["block", "params"]);
const KEY_PATTERN = /^[a-z0-9-]{2,48}$/;

/**
 * Atoms that draw random numbers or change memory when evaluated. A calc WHEN is evaluated for
 * damage previews and AI scoring too, where RNG draws and memory writes would corrupt the battle.
 */
export const STATEFUL_CONDITION_IDS: ReadonlySet<string> = new Set(["rng.chance", "time.once-per", "time.nth-use"]);

/** The slots a condition atom needs for a given set of param values (same rule as conditions.ts). */
function conditionRequires(def: ConditionDef, values: ParamValues): SlotId[] {
  const slots = new Set<SlotId>(def.requires);
  if (def.whoParam !== undefined) {
    const who = values[def.whoParam] ?? def.params.find(param => param.id === def.whoParam)?.default;
    if (who === "holder" || who === "other" || who === "ally") {
      slots.add(who);
    }
  }
  return [...slots];
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function slotLabel(slot: SlotId): string {
  return SLOTS.find(def => def.id === slot)?.label.toLowerCase() ?? slot;
}

function describeMissing(block: string, when: VocabularyWhen, missing: readonly SlotId[]): string {
  const wanted = missing.map(slotLabel).join(" and ");
  return `"${block}" needs ${wanted}, but the trigger "${when.label}" does not provide ${missing.length > 1 ? "them" : "it"}`;
}

interface Context {
  readonly vocabulary: VocabularyJson;
  readonly conditions: ReadonlyMap<string, ConditionDef>;
  readonly effects: ReadonlyMap<string, EffectDef>;
  readonly whens: ReadonlyMap<string, VocabularyWhen>;
  readonly guards: ReadonlyMap<string, GuardDef>;
  readonly errors: string[];
  /** Bindings only: an empty `all` is "no condition" (the original closure is `() => true`). */
  readonly allowEmptyAll?: boolean;
}

function checkRefShape(ref: unknown, path: string, errors: string[]): ref is BlockRef {
  if (!isObject(ref)) {
    errors.push(`${path} must be an object with a "block"`);
    return false;
  }
  for (const key of Object.keys(ref)) {
    if (!BLOCK_KEYS.has(key)) {
      errors.push(`${path} has an unknown field "${key}"`);
    }
  }
  if (typeof ref.block !== "string" || ref.block.length === 0) {
    errors.push(`${path} needs a "block" id`);
    return false;
  }
  if (ref.params !== undefined && !isObject(ref.params)) {
    errors.push(`${path}.params must be an object`);
    return false;
  }
  return true;
}

function validateCondition(node: unknown, path: string, when: VocabularyWhen, depth: number, context: Context): void {
  const { errors } = context;
  if (!isObject(node)) {
    errors.push(`${path} must be an object`);
    return;
  }
  const groupKeys = ["all", "any", "not"].filter(key => key in node);
  if (groupKeys.length > 0) {
    if (groupKeys.length > 1 || Object.keys(node).length > 1) {
      errors.push(`${path} mixes group operators; use one of all, any or not`);
      return;
    }
    if (depth >= COMPOSITION_LIMITS.groupDepth) {
      errors.push(`${path} nests groups more than ${COMPOSITION_LIMITS.groupDepth} levels deep`);
      return;
    }
    const typed = node as unknown as ConditionNode;
    if (isGroupNot(typed)) {
      validateCondition(typed.not, `${path}.not`, when, depth + 1, context);
      return;
    }
    const list = isGroupAll(typed) ? typed.all : isGroupAny(typed) ? typed.any : [];
    if (isGroupAll(typed) && context.allowEmptyAll === true && Array.isArray(list) && list.length === 0) {
      return;
    }
    if (!Array.isArray(list) || list.length === 0 || list.length > COMPOSITION_LIMITS.conditionsPerRule) {
      errors.push(`${path} groups need between 1 and ${COMPOSITION_LIMITS.conditionsPerRule} conditions`);
      return;
    }
    list.forEach((child, index) =>
      validateCondition(child, `${path}.${groupKeys[0]}[${index}]`, when, depth + 1, context),
    );
    return;
  }
  if (!checkRefShape(node, path, errors) || !isBlockRef(node as unknown as ConditionNode)) {
    return;
  }
  const ref = node as unknown as BlockRef;
  const def = context.conditions.get(ref.block);
  if (def === undefined) {
    errors.push(`${path}: there is no condition called "${ref.block}"`);
    return;
  }
  if (def.escapeHatch === true) {
    errors.push(`${path}: "${def.id}" cannot be added by hand; it only appears on abilities that already use it`);
    return;
  }
  if (when.kind === "calc" && (!def.pure || STATEFUL_CONDITION_IDS.has(def.id))) {
    errors.push(
      `${path}: "${def.id}" rolls dice or remembers things, so it cannot be used while the game is only calculating ("${when.label}"); use a "something happens" trigger`,
    );
    return;
  }
  const paramErrors = validateParamValues(def.id, def.params, ref.params as ParamValues | undefined);
  if (paramErrors.length > 0) {
    errors.push(...paramErrors.map(message => `${path}: ${message}`));
    return;
  }
  const values: ParamValues = {
    ...Object.fromEntries(def.params.map(param => [param.id, param.default])),
    ...(ref.params ?? {}),
  };
  const missing = missingSlots(conditionRequires(def, values), when.provides);
  if (missing.length > 0) {
    errors.push(`${path}: ${describeMissing(def.id, when, missing)}`);
  }
}

function validateEffect(ref: unknown, path: string, when: VocabularyWhen, context: Context): void {
  const { errors } = context;
  if (!checkRefShape(ref, path, errors)) {
    return;
  }
  const def = context.effects.get(ref.block);
  if (def === undefined) {
    errors.push(`${path}: there is no effect called "${ref.block}"`);
    return;
  }
  if (!def.implemented) {
    errors.push(
      `${path}: "${def.id}" cannot run yet. It is listed so it can be planned, but it is not wired to the game code`,
    );
    return;
  }
  const paramErrors = validateParamValues(def.id, def.params, ref.params as ParamValues | undefined);
  if (paramErrors.length > 0) {
    errors.push(...paramErrors.map(message => `${path}: ${message}`));
    return;
  }
  const missing = missingSlots(def.requires, when.provides);
  if (missing.length > 0) {
    errors.push(`${path}: ${describeMissing(def.id, when, missing)}`);
  }
  for (const guardId of def.guards ?? []) {
    const guard = context.guards.get(guardId);
    const guardMissing = guard === undefined ? [] : missingSlots(guard.requires, when.provides);
    if (guardMissing.length > 0) {
      errors.push(
        `${path}: its safety rule "${guardId}" needs ${guardMissing.map(slotLabel).join(" and ")}, but the trigger "${when.label}" does not provide ${guardMissing.length > 1 ? "them" : "it"}`,
      );
    }
  }
  if (def.kind === "calc") {
    if (when.kind !== "calc") {
      errors.push(
        `${path}: "${def.id}" changes a value the game is calculating, but "${when.label}" is an event; pick a "while the game calculates" trigger`,
      );
    } else if (when.modifies !== def.modifies) {
      errors.push(`${path}: "${def.id}" changes ${def.modifies}, but "${when.label}" lets you change ${when.modifies}`);
    }
  } else if (def.kind === "event" && when.kind !== "event") {
    errors.push(
      `${path}: "${def.id}" is something that happens, but "${when.label}" is a calculation moment; pick a "something happens" trigger`,
    );
  }
}

/** Plain-language problems with a `composition` array; empty when valid. */
export function validateCompositionWith(rules: unknown, vocabulary: VocabularyJson, path = "composition"): string[] {
  const errors: string[] = [];
  if (!Array.isArray(rules)) {
    return [`${path} must be an array`];
  }
  if (rules.length > COMPOSITION_LIMITS.rules) {
    errors.push(`${path} must contain at most ${COMPOSITION_LIMITS.rules} rules`);
  }
  const context: Context = {
    vocabulary,
    conditions: new Map(vocabulary.conditions.map(def => [def.id, def])),
    effects: new Map(vocabulary.effects.map(def => [def.id, def])),
    whens: new Map(vocabulary.whens.map(def => [def.id, def])),
    guards: new Map(vocabulary.guards.map(def => [def.id, def])),
    errors,
  };
  const keys = new Set<string>();
  rules.forEach((rule, index) => {
    const rulePath = `${path}[${index}]`;
    if (!isObject(rule)) {
      errors.push(`${rulePath} must be an object`);
      return;
    }
    for (const key of Object.keys(rule)) {
      if (!RULE_KEYS.has(key)) {
        errors.push(`${rulePath} has an unknown field "${key}"`);
      }
    }
    if (typeof rule.key !== "string" || !KEY_PATTERN.test(rule.key)) {
      errors.push(`${rulePath}.key must use 2-48 lowercase letters, digits and hyphens`);
    } else if (keys.has(rule.key)) {
      errors.push(`${path} has duplicate key ${rule.key}`);
    } else {
      keys.add(rule.key);
    }
    if (!Number.isInteger(rule.chance) || (rule.chance as number) < 1 || (rule.chance as number) > 100) {
      errors.push(`${rulePath}.chance must be a whole number from 1 to 100`);
    }
    if (!checkRefShape(rule.when, `${rulePath}.when`, errors)) {
      return;
    }
    const when = context.whens.get(rule.when.block);
    if (when === undefined) {
      errors.push(`${rulePath}.when: there is no trigger called "${rule.when.block}"`);
      return;
    }
    if (when.kind === "while-active") {
      errors.push(`${rulePath}.when: "${when.label}" is an always-on flag, not a moment a rule can react to`);
      return;
    }
    if (when.baseClassOnly === true) {
      errors.push(
        `${rulePath}.when: "${when.label}" is a legacy grouping that the game never fires on its own; pick a specific trigger`,
      );
      return;
    }
    if (when.composable !== true) {
      errors.push(
        `${rulePath}.when: "${when.label}" cannot be used in a rule yet. It is listed so it can be planned, but the game wiring for it is not verified`,
      );
      return;
    }
    if (when.kind === "calc" && typeof rule.chance === "number" && rule.chance < 100) {
      errors.push(
        `${rulePath}.chance must be 100 for "${when.label}": a random roll cannot happen while the game is only calculating`,
      );
    }
    if (rule.when.params !== undefined && Object.keys(rule.when.params).length > 0) {
      errors.push(`${rulePath}.when: triggers take no settings`);
    }
    if (rule.if !== undefined) {
      if (!Array.isArray(rule.if) || rule.if.length > COMPOSITION_LIMITS.conditionsPerRule) {
        errors.push(`${rulePath}.if must be a list of at most ${COMPOSITION_LIMITS.conditionsPerRule} conditions`);
      } else {
        rule.if.forEach((node, nodeIndex) => validateCondition(node, `${rulePath}.if[${nodeIndex}]`, when, 0, context));
      }
    }
    if (!Array.isArray(rule.do) || rule.do.length === 0 || rule.do.length > COMPOSITION_LIMITS.effectsPerRule) {
      errors.push(`${rulePath}.do must list between 1 and ${COMPOSITION_LIMITS.effectsPerRule} effects`);
    } else {
      rule.do.forEach((effect, effectIndex) => validateEffect(effect, `${rulePath}.do[${effectIndex}]`, when, context));
    }
  });
  return errors;
}

/**
 * Validates a bare IF tree (used for instance bindings) against a pretend moment that provides every
 * slot, so only unknown ids, bad params and impossible groups are reported, never missing slots.
 */
export function validateConditionSpecWith(node: unknown, vocabulary: VocabularyJson, path = "condition"): string[] {
  const errors: string[] = [];
  const anyMoment: VocabularyWhen = {
    id: "binding.any-moment",
    kind: "event",
    dispatchKey: null,
    provides: SLOT_IDS,
    label: "any moment",
    group: "Bindings",
  };
  validateCondition(node, path, anyMoment, 0, {
    vocabulary,
    conditions: new Map(vocabulary.conditions.map(def => [def.id, def])),
    effects: new Map(vocabulary.effects.map(def => [def.id, def])),
    whens: new Map(vocabulary.whens.map(def => [def.id, def])),
    guards: new Map(vocabulary.guards.map(def => [def.id, def])),
    errors,
    allowEmptyAll: true,
  });
  return errors;
}
