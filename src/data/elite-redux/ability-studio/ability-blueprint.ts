/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import type {
  AbilityStudioRuntimeComponentRule,
  AbilityStudioRuntimeConditionReference,
  AbilityStudioRuntimeSource,
} from "./runtime-components";

export const ABILITY_STUDIO_SCHEMA_VERSION = 1;
export const ABILITY_STUDIO_ID_MIN = 20000;
export const ABILITY_STUDIO_ID_MAX = 29999;

export const ABILITY_STUDIO_TRIGGERS = [
  "on-entry",
  "after-attack",
  "after-hit",
  "after-ko",
  "end-turn",
  "after-faint",
] as const;

export const ABILITY_STUDIO_TARGETS = ["holder", "other", "holder-side", "opposing-side"] as const;

export const ABILITY_STUDIO_STATS = ["ATK", "DEF", "SPATK", "SPDEF", "SPD", "ACC", "EVA"] as const;

export const ABILITY_STUDIO_STAT_MULTIPLIER_STATS = ["ATK", "DEF", "SPATK", "SPDEF", "SPD"] as const;

export const ABILITY_STUDIO_STATUSES = ["POISON", "TOXIC", "PARALYSIS", "SLEEP", "FREEZE", "BURN"] as const;

export const ABILITY_STUDIO_TYPES = [
  "NORMAL",
  "FIGHTING",
  "FLYING",
  "POISON",
  "GROUND",
  "ROCK",
  "BUG",
  "GHOST",
  "STEEL",
  "FIRE",
  "WATER",
  "GRASS",
  "ELECTRIC",
  "PSYCHIC",
  "ICE",
  "DRAGON",
  "DARK",
  "FAIRY",
  "STELLAR",
] as const;

export const ABILITY_STUDIO_CATEGORIES = ["PHYSICAL", "SPECIAL", "STATUS"] as const;

export const ABILITY_STUDIO_MOVE_FLAGS = [
  "MAKES_CONTACT",
  "SOUND_BASED",
  "BITING_MOVE",
  "PULSE_MOVE",
  "PUNCHING_MOVE",
  "SLICING_MOVE",
  "RECKLESS_MOVE",
  "BALLBOMB_MOVE",
  "POWDER_MOVE",
  "DANCE_MOVE",
  "WIND_MOVE",
  "TRIAGE_MOVE",
  "AIR_BASED",
  "ARROW_BASED",
  "BONE_BASED",
  "DRILL_BASED",
  "FIELD_BASED",
  "HAMMER_BASED",
  "HORN_BASED",
  "KICKING_MOVE",
  "LUNAR_MOVE",
  "THROW_BASED",
  "WEATHER_BASED",
] as const;

export const ABILITY_STUDIO_WEATHERS = [
  "NONE",
  "SUNNY",
  "RAIN",
  "SANDSTORM",
  "HAIL",
  "SNOW",
  "FOG",
  "HEAVY_RAIN",
  "HARSH_SUN",
  "STRONG_WINDS",
  "TEMPEST_STORM",
  "SNOWY_WRATH",
  "EERIE_FOG",
] as const;

export const ABILITY_STUDIO_TERRAINS = ["NONE", "MISTY", "ELECTRIC", "GRASSY", "PSYCHIC", "TOXIC"] as const;

export type AbilityStudioTrigger = (typeof ABILITY_STUDIO_TRIGGERS)[number];
export type AbilityStudioTarget = (typeof ABILITY_STUDIO_TARGETS)[number];
export type AbilityStudioStat = (typeof ABILITY_STUDIO_STATS)[number];
export type AbilityStudioStatMultiplierStat = (typeof ABILITY_STUDIO_STAT_MULTIPLIER_STATS)[number];
export type AbilityStudioStatus = (typeof ABILITY_STUDIO_STATUSES)[number];
export type AbilityStudioType = (typeof ABILITY_STUDIO_TYPES)[number];
export type AbilityStudioCategory = (typeof ABILITY_STUDIO_CATEGORIES)[number];
export type AbilityStudioMoveFlag = (typeof ABILITY_STUDIO_MOVE_FLAGS)[number];
export type AbilityStudioWeather = (typeof ABILITY_STUDIO_WEATHERS)[number];
export type AbilityStudioTerrain = (typeof ABILITY_STUDIO_TERRAINS)[number];

export interface AbilityStudioMoveFilter {
  readonly type?: AbilityStudioType;
  readonly category?: AbilityStudioCategory;
  readonly flag?: AbilityStudioMoveFlag;
  readonly damaging?: boolean;
}

export type AbilityStudioCondition =
  | { readonly kind: "holder-hp"; readonly minPercent?: number; readonly maxPercent?: number }
  | { readonly kind: "holder-status"; readonly status: AbilityStudioStatus | "NONE" }
  | { readonly kind: "other-status"; readonly status: AbilityStudioStatus | "NONE" }
  | { readonly kind: "weather"; readonly weather: AbilityStudioWeather }
  | { readonly kind: "terrain"; readonly terrain: AbilityStudioTerrain }
  | { readonly kind: "move"; readonly filter: AbilityStudioMoveFilter };

export type AbilityStudioEffect =
  | {
      readonly kind: "stat-stage";
      readonly target: AbilityStudioTarget;
      readonly stat: AbilityStudioStat;
      readonly stages: number;
    }
  | {
      readonly kind: "status";
      readonly target: AbilityStudioTarget;
      readonly status: AbilityStudioStatus;
    }
  | {
      readonly kind: "heal-percent";
      readonly target: AbilityStudioTarget;
      readonly percent: number;
    }
  | {
      readonly kind: "cure-status";
      readonly target: AbilityStudioTarget;
      readonly status: AbilityStudioStatus | "ANY";
    }
  | { readonly kind: "set-weather"; readonly weather: AbilityStudioWeather }
  | { readonly kind: "set-terrain"; readonly terrain: AbilityStudioTerrain };

export interface AbilityStudioRule {
  readonly key: string;
  readonly trigger: AbilityStudioTrigger;
  readonly chance: number;
  readonly conditionLogic?: "all" | "any";
  readonly conditions: readonly AbilityStudioCondition[];
  readonly effects: readonly AbilityStudioEffect[];
}

export interface AbilityStudioMechanicReference {
  readonly abilityId: number;
  readonly attrIndex: number;
  readonly attrType: string;
}

export type AbilityStudioModifier =
  | {
      readonly kind: "move-power";
      readonly multiplier: number;
      readonly filter: AbilityStudioMoveFilter;
    }
  | {
      readonly kind: "received-damage";
      readonly multiplier: number;
      readonly filter: AbilityStudioMoveFilter;
    }
  | {
      readonly kind: "stat-multiplier";
      readonly stat: AbilityStudioStatMultiplierStat;
      readonly multiplier: number;
    }
  | {
      readonly kind: "priority";
      readonly amount: number;
      readonly filter: AbilityStudioMoveFilter;
    };

export interface AbilityStudioBlueprintV1 {
  readonly version: 1;
  readonly id: number;
  readonly name: string;
  readonly description: string;
  readonly generation: number;
  readonly includes: readonly number[];
  readonly mechanics?: readonly AbilityStudioMechanicReference[];
  readonly componentRules?: readonly AbilityStudioRuntimeComponentRule[];
  readonly rules: readonly AbilityStudioRule[];
  readonly modifiers: readonly AbilityStudioModifier[];
  readonly flags?: {
    readonly bypassFaint?: boolean;
    readonly ignorable?: boolean;
    readonly unsuppressable?: boolean;
    readonly uncopiable?: boolean;
    readonly unreplaceable?: boolean;
  };
}

export type AbilityStudioBlueprints = Readonly<Record<string, AbilityStudioBlueprintV1>>;

export interface AbilityStudioValidationResult {
  readonly blueprints: Record<string, AbilityStudioBlueprintV1>;
  readonly errors: string[];
}

const isObject = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);

const isNumberInRange = (value: unknown, min: number, max: number): value is number =>
  typeof value === "number" && Number.isFinite(value) && value >= min && value <= max;

const isMember = <T extends string>(values: readonly T[], value: unknown): value is T =>
  typeof value === "string" && values.includes(value as T);

function validateMoveFilter(value: unknown, path: string, errors: string[]): value is AbilityStudioMoveFilter {
  if (!isObject(value)) {
    errors.push(`${path} must be an object`);
    return false;
  }
  const keys = Object.keys(value);
  if (keys.length === 0 || keys.some(key => !["type", "category", "flag", "damaging"].includes(key))) {
    errors.push(`${path} must contain only supported move filters`);
    return false;
  }
  if (value.type !== undefined && !isMember(ABILITY_STUDIO_TYPES, value.type)) {
    errors.push(`${path}.type is invalid`);
  }
  if (value.category !== undefined && !isMember(ABILITY_STUDIO_CATEGORIES, value.category)) {
    errors.push(`${path}.category is invalid`);
  }
  if (value.flag !== undefined && !isMember(ABILITY_STUDIO_MOVE_FLAGS, value.flag)) {
    errors.push(`${path}.flag is invalid`);
  }
  if (value.damaging !== undefined && typeof value.damaging !== "boolean") {
    errors.push(`${path}.damaging must be boolean`);
  }
  return errors.length === 0;
}

function validateCondition(value: unknown, path: string, errors: string[]): value is AbilityStudioCondition {
  if (!isObject(value) || typeof value.kind !== "string") {
    errors.push(`${path} must be a condition object`);
    return false;
  }
  switch (value.kind) {
    case "holder-hp":
      if (value.minPercent !== undefined && !isNumberInRange(value.minPercent, 0, 100)) {
        errors.push(`${path}.minPercent must be 0-100`);
      }
      if (value.maxPercent !== undefined && !isNumberInRange(value.maxPercent, 0, 100)) {
        errors.push(`${path}.maxPercent must be 0-100`);
      }
      if (value.minPercent === undefined && value.maxPercent === undefined) {
        errors.push(`${path} needs a minimum or maximum`);
      }
      if (
        typeof value.minPercent === "number"
        && typeof value.maxPercent === "number"
        && value.minPercent > value.maxPercent
      ) {
        errors.push(`${path}.minPercent cannot exceed maxPercent`);
      }
      break;
    case "holder-status":
    case "other-status":
      if (value.status !== "NONE" && !isMember(ABILITY_STUDIO_STATUSES, value.status)) {
        errors.push(`${path}.status is invalid`);
      }
      break;
    case "weather":
      if (!isMember(ABILITY_STUDIO_WEATHERS, value.weather)) {
        errors.push(`${path}.weather is invalid`);
      }
      break;
    case "terrain":
      if (!isMember(ABILITY_STUDIO_TERRAINS, value.terrain)) {
        errors.push(`${path}.terrain is invalid`);
      }
      break;
    case "move":
      validateMoveFilter(value.filter, `${path}.filter`, errors);
      break;
    default:
      errors.push(`${path}.kind is invalid`);
  }
  return errors.length === 0;
}

function validateTarget(target: unknown, path: string, trigger: AbilityStudioTrigger, errors: string[]): void {
  if (!isMember(ABILITY_STUDIO_TARGETS, target)) {
    errors.push(`${path} is invalid`);
    return;
  }
  if (target === "other" && (trigger === "on-entry" || trigger === "end-turn")) {
    errors.push(`${path} cannot be other for ${trigger}`);
  }
}

function validateEffect(
  value: unknown,
  path: string,
  trigger: AbilityStudioTrigger,
  errors: string[],
): value is AbilityStudioEffect {
  if (!isObject(value) || typeof value.kind !== "string") {
    errors.push(`${path} must be an effect object`);
    return false;
  }
  switch (value.kind) {
    case "stat-stage":
      validateTarget(value.target, `${path}.target`, trigger, errors);
      if (!isMember(ABILITY_STUDIO_STATS, value.stat)) {
        errors.push(`${path}.stat is invalid`);
      }
      if (!Number.isInteger(value.stages) || !isNumberInRange(value.stages, -6, 6) || value.stages === 0) {
        errors.push(`${path}.stages must be a non-zero integer from -6 to 6`);
      }
      break;
    case "status":
      validateTarget(value.target, `${path}.target`, trigger, errors);
      if (!isMember(ABILITY_STUDIO_STATUSES, value.status)) {
        errors.push(`${path}.status is invalid`);
      }
      break;
    case "heal-percent":
      validateTarget(value.target, `${path}.target`, trigger, errors);
      if (!isNumberInRange(value.percent, 1, 100)) {
        errors.push(`${path}.percent must be 1-100`);
      }
      break;
    case "cure-status":
      validateTarget(value.target, `${path}.target`, trigger, errors);
      if (value.status !== "ANY" && !isMember(ABILITY_STUDIO_STATUSES, value.status)) {
        errors.push(`${path}.status is invalid`);
      }
      break;
    case "set-weather":
      if (!isMember(ABILITY_STUDIO_WEATHERS, value.weather)) {
        errors.push(`${path}.weather is invalid`);
      }
      break;
    case "set-terrain":
      if (!isMember(ABILITY_STUDIO_TERRAINS, value.terrain)) {
        errors.push(`${path}.terrain is invalid`);
      }
      break;
    default:
      errors.push(`${path}.kind is invalid`);
  }
  return errors.length === 0;
}

function validateRule(value: unknown, path: string, errors: string[]): value is AbilityStudioRule {
  if (!isObject(value)) {
    errors.push(`${path} must be an object`);
    return false;
  }
  const trigger = value.trigger;
  if (typeof value.key !== "string" || !/^[a-z0-9-]{1,40}$/.test(value.key)) {
    errors.push(`${path}.key is invalid`);
  }
  if (!isMember(ABILITY_STUDIO_TRIGGERS, trigger)) {
    errors.push(`${path}.trigger is invalid`);
    return false;
  }
  if (!isNumberInRange(value.chance, 1, 100)) {
    errors.push(`${path}.chance must be 1-100`);
  }
  if (value.conditionLogic !== undefined && !isMember(["all", "any"] as const, value.conditionLogic)) {
    errors.push(`${path}.conditionLogic is invalid`);
  }
  if (!Array.isArray(value.conditions) || value.conditions.length > 8) {
    errors.push(`${path}.conditions must be an array with at most 8 entries`);
  } else {
    value.conditions.forEach((condition, index) =>
      validateCondition(condition, `${path}.conditions[${index}]`, errors),
    );
  }
  if (!Array.isArray(value.effects) || value.effects.length === 0 || value.effects.length > 8) {
    errors.push(`${path}.effects must contain 1-8 entries`);
  } else {
    value.effects.forEach((effect, index) => validateEffect(effect, `${path}.effects[${index}]`, trigger, errors));
  }
  const conditions = Array.isArray(value.conditions) ? value.conditions : [];
  if (
    (trigger === "on-entry" || trigger === "after-ko" || trigger === "end-turn")
    && conditions.some(
      condition =>
        isObject(condition)
        && (condition.kind === "move"
          || ((trigger === "on-entry" || trigger === "end-turn") && condition.kind === "other-status")),
    )
  ) {
    errors.push(`${path} uses a condition on a trigger without that context`);
  }
  return errors.length === 0;
}

function validateModifier(value: unknown, path: string, errors: string[]): value is AbilityStudioModifier {
  if (!isObject(value) || typeof value.kind !== "string") {
    errors.push(`${path} must be a modifier object`);
    return false;
  }
  switch (value.kind) {
    case "move-power":
    case "received-damage":
      if (!isNumberInRange(value.multiplier, 0.1, 4)) {
        errors.push(`${path}.multiplier must be 0.1-4`);
      }
      validateMoveFilter(value.filter, `${path}.filter`, errors);
      break;
    case "stat-multiplier":
      if (!isMember(ABILITY_STUDIO_STAT_MULTIPLIER_STATS, value.stat)) {
        errors.push(`${path}.stat is invalid`);
      }
      if (!isNumberInRange(value.multiplier, 0.1, 4)) {
        errors.push(`${path}.multiplier must be 0.1-4`);
      }
      break;
    case "priority":
      if (!Number.isInteger(value.amount) || !isNumberInRange(value.amount, -7, 7) || value.amount === 0) {
        errors.push(`${path}.amount must be a non-zero integer from -7 to 7`);
      }
      validateMoveFilter(value.filter, `${path}.filter`, errors);
      break;
    default:
      errors.push(`${path}.kind is invalid`);
  }
  return errors.length === 0;
}

function validateRuntimeSource(value: unknown, path: string, errors: string[]): value is AbilityStudioRuntimeSource {
  if (
    !isObject(value)
    || !Number.isInteger(value.abilityId)
    || (value.abilityId as number) <= 0
    || !Number.isInteger(value.attrIndex)
    || !isNumberInRange(value.attrIndex, 0, 1023)
    || typeof value.attrType !== "string"
    || !/^[A-Za-z0-9_]{2,120}$/.test(value.attrType)
  ) {
    errors.push(`${path} is not a valid runtime component source`);
    return false;
  }
  return true;
}

function validateRuntimeConditionReference(
  value: unknown,
  path: string,
  errors: string[],
): value is AbilityStudioRuntimeConditionReference {
  if (!validateRuntimeSource(value, path, errors) || !isObject(value)) {
    return false;
  }
  if (!isMember(["ability", "holder", "event"] as const, value.kind)) {
    errors.push(`${path}.kind is invalid`);
  }
  if (
    value.kind === "ability"
    && (!Number.isInteger(value.conditionIndex) || !isNumberInRange(value.conditionIndex, 0, 63))
  ) {
    errors.push(`${path}.conditionIndex is invalid`);
  }
  return errors.length === 0;
}

function validateRuntimeComponentRule(
  value: unknown,
  path: string,
  errors: string[],
): value is AbilityStudioRuntimeComponentRule {
  if (!isObject(value)) {
    errors.push(`${path} must be an object`);
    return false;
  }
  if (typeof value.key !== "string" || !/^[a-z0-9-]{1,48}$/.test(value.key)) {
    errors.push(`${path}.key is invalid`);
  }
  if (!Array.isArray(value.prerequisiteHooks) && value.prerequisiteHooks !== undefined) {
    errors.push(`${path}.prerequisiteHooks must be an array`);
  } else if (Array.isArray(value.prerequisiteHooks)) {
    if (value.prerequisiteHooks.length > 7) {
      errors.push(`${path}.prerequisiteHooks must contain at most 7 entries`);
    }
    value.prerequisiteHooks.forEach((hook, index) =>
      validateRuntimeSource(hook, `${path}.prerequisiteHooks[${index}]`, errors),
    );
  }
  validateRuntimeSource(value.hook, `${path}.hook`, errors);
  if (!isNumberInRange(value.chance, 1, 100)) {
    errors.push(`${path}.chance must be 1-100`);
  }
  if (value.conditionLogic !== undefined && !isMember(["all", "any"] as const, value.conditionLogic)) {
    errors.push(`${path}.conditionLogic is invalid`);
  }
  if (!Array.isArray(value.conditions) || value.conditions.length > 16) {
    errors.push(`${path}.conditions must contain at most 16 entries`);
  } else {
    value.conditions.forEach((condition, index) => {
      if (isObject(condition) && "abilityId" in condition) {
        validateRuntimeConditionReference(condition, `${path}.conditions[${index}]`, errors);
      } else {
        validateCondition(condition, `${path}.conditions[${index}]`, errors);
      }
    });
  }
  if (!Array.isArray(value.effects) || value.effects.length === 0 || value.effects.length > 8) {
    errors.push(`${path}.effects must contain 1-8 entries`);
  } else {
    value.effects.forEach((effect, index) => {
      if (isObject(effect) && "abilityId" in effect) {
        validateRuntimeSource(effect, `${path}.effects[${index}]`, errors);
      } else {
        validateEffect(effect, `${path}.effects[${index}]`, "after-attack", errors);
      }
    });
  }
  return errors.length === 0;
}

function validateBlueprint(value: unknown, path: string, errors: string[]): value is AbilityStudioBlueprintV1 {
  if (!isObject(value)) {
    errors.push(`${path} must be an object`);
    return false;
  }
  if (value.version !== ABILITY_STUDIO_SCHEMA_VERSION) {
    errors.push(`${path}.version must be ${ABILITY_STUDIO_SCHEMA_VERSION}`);
  }
  if (!Number.isInteger(value.id) || !isNumberInRange(value.id, ABILITY_STUDIO_ID_MIN, ABILITY_STUDIO_ID_MAX)) {
    errors.push(`${path}.id must be ${ABILITY_STUDIO_ID_MIN}-${ABILITY_STUDIO_ID_MAX}`);
  }
  if (typeof value.name !== "string" || value.name.trim().length < 2 || value.name.length > 40) {
    errors.push(`${path}.name must be 2-40 characters`);
  }
  if (typeof value.description !== "string" || value.description.trim().length < 2 || value.description.length > 500) {
    errors.push(`${path}.description must be 2-500 characters`);
  }
  if (!Number.isInteger(value.generation) || !isNumberInRange(value.generation, 1, 9)) {
    errors.push(`${path}.generation must be 1-9`);
  }
  if (
    !Array.isArray(value.includes)
    || value.includes.length > 12
    || value.includes.some(id => !Number.isInteger(id) || (id as number) <= 0)
  ) {
    errors.push(`${path}.includes must contain at most 12 positive ability ids`);
  }
  if (
    value.mechanics !== undefined
    && (!Array.isArray(value.mechanics)
      || value.mechanics.length > 64
      || value.mechanics.some(
        mechanic =>
          !isObject(mechanic)
          || !Number.isInteger(mechanic.abilityId)
          || (mechanic.abilityId as number) <= 0
          || !Number.isInteger(mechanic.attrIndex)
          || !isNumberInRange(mechanic.attrIndex, 0, 1023)
          || typeof mechanic.attrType !== "string"
          || !/^[A-Za-z0-9_]{2,120}$/.test(mechanic.attrType),
      ))
  ) {
    errors.push(`${path}.mechanics must contain at most 64 valid runtime mechanic references`);
  } else if (
    Array.isArray(value.mechanics)
    && value.mechanics.some(mechanic => isObject(mechanic) && mechanic.abilityId === value.id)
  ) {
    errors.push(`${path}.mechanics cannot reference the same ability`);
  } else if (Array.isArray(value.mechanics)) {
    const mechanicKeys = value.mechanics
      .filter(isObject)
      .map(mechanic => `${mechanic.abilityId}:${mechanic.attrIndex}:${mechanic.attrType}`);
    if (new Set(mechanicKeys).size !== mechanicKeys.length) {
      errors.push(`${path}.mechanics cannot contain duplicates`);
    }
  }
  if (!Array.isArray(value.componentRules) && value.componentRules !== undefined) {
    errors.push(`${path}.componentRules must be an array`);
  } else if (Array.isArray(value.componentRules)) {
    if (value.componentRules.length > 32) {
      errors.push(`${path}.componentRules must contain at most 32 entries`);
    }
    const keys = new Set<string>();
    value.componentRules.forEach((rule, index) => {
      validateRuntimeComponentRule(rule, `${path}.componentRules[${index}]`, errors);
      if (isObject(rule) && typeof rule.key === "string") {
        if (keys.has(rule.key)) {
          errors.push(`${path}.componentRules has duplicate key ${rule.key}`);
        }
        keys.add(rule.key);
      }
      const sources = isObject(rule)
        ? [
            ...(Array.isArray(rule.prerequisiteHooks) ? rule.prerequisiteHooks : []),
            rule.hook,
            ...(Array.isArray(rule.conditions) ? rule.conditions : []),
            ...(Array.isArray(rule.effects) ? rule.effects : []),
          ]
        : [];
      if (sources.some(source => isObject(source) && "abilityId" in source && source.abilityId === value.id)) {
        errors.push(`${path}.componentRules cannot reference the same ability`);
      }
    });
  }
  if (!Array.isArray(value.rules) || value.rules.length > 24) {
    errors.push(`${path}.rules must contain at most 24 entries`);
  } else {
    const keys = new Set<string>();
    value.rules.forEach((rule, index) => {
      validateRule(rule, `${path}.rules[${index}]`, errors);
      if (isObject(rule) && typeof rule.key === "string") {
        if (keys.has(rule.key)) {
          errors.push(`${path}.rules has duplicate key ${rule.key}`);
        }
        keys.add(rule.key);
      }
    });
  }
  if (!Array.isArray(value.modifiers) || value.modifiers.length > 24) {
    errors.push(`${path}.modifiers must contain at most 24 entries`);
  } else {
    value.modifiers.forEach((modifier, index) => validateModifier(modifier, `${path}.modifiers[${index}]`, errors));
  }
  if (
    Array.isArray(value.includes)
    && Array.isArray(value.rules)
    && Array.isArray(value.modifiers)
    && value.includes.length
      + (Array.isArray(value.mechanics) ? value.mechanics.length : 0)
      + (Array.isArray(value.componentRules) ? value.componentRules.length : 0)
      + value.rules.length
      + value.modifiers.length
      === 0
  ) {
    errors.push(`${path} must include an ability, component rule, mechanic, rule, or modifier`);
  }
  if (value.flags !== undefined) {
    if (isObject(value.flags)) {
      const allowed = ["bypassFaint", "ignorable", "unsuppressable", "uncopiable", "unreplaceable"];
      for (const [key, flag] of Object.entries(value.flags)) {
        if (!allowed.includes(key) || typeof flag !== "boolean") {
          errors.push(`${path}.flags.${key} is invalid`);
        }
      }
    } else {
      errors.push(`${path}.flags must be an object`);
    }
  }
  return errors.length === 0;
}

export function validateAbilityStudioBlueprints(raw: unknown): AbilityStudioValidationResult {
  const blueprints: Record<string, AbilityStudioBlueprintV1> = {};
  const errors: string[] = [];
  if (!isObject(raw)) {
    return { blueprints, errors: ["custom abilities must be an object"] };
  }
  const ids = new Map<number, string>();
  const names = new Map<string, string>();
  for (const [key, value] of Object.entries(raw)) {
    const entryErrors: string[] = [];
    if (!/^[a-z0-9-]{2,48}$/.test(key)) {
      entryErrors.push(`${key}: key must use lowercase letters, digits, and hyphens`);
    }
    if (validateBlueprint(value, key, entryErrors)) {
      const normalizedName = value.name.trim().toLowerCase();
      const idOwner = ids.get(value.id);
      const nameOwner = names.get(normalizedName);
      if (idOwner !== undefined) {
        entryErrors.push(`${key}.id duplicates ${idOwner}`);
      }
      if (nameOwner !== undefined) {
        entryErrors.push(`${key}.name duplicates ${nameOwner}`);
      }
      if (entryErrors.length === 0) {
        blueprints[key] = value;
        ids.set(value.id, key);
        names.set(normalizedName, key);
      }
    }
    errors.push(...entryErrors);
  }
  return { blueprints, errors };
}

export function getAbilityStudioCatalog() {
  return {
    schemaVersion: ABILITY_STUDIO_SCHEMA_VERSION,
    idRange: [ABILITY_STUDIO_ID_MIN, ABILITY_STUDIO_ID_MAX],
    triggers: ABILITY_STUDIO_TRIGGERS,
    targets: ABILITY_STUDIO_TARGETS,
    stats: ABILITY_STUDIO_STATS,
    statMultiplierStats: ABILITY_STUDIO_STAT_MULTIPLIER_STATS,
    statuses: ABILITY_STUDIO_STATUSES,
    types: ABILITY_STUDIO_TYPES,
    categories: ABILITY_STUDIO_CATEGORIES,
    moveFlags: ABILITY_STUDIO_MOVE_FLAGS,
    weathers: ABILITY_STUDIO_WEATHERS,
    terrains: ABILITY_STUDIO_TERRAINS,
    conditionKinds: ["holder-hp", "holder-status", "other-status", "weather", "terrain", "move"],
    effectKinds: ["stat-stage", "status", "heal-percent", "cure-status", "set-weather", "set-terrain"],
    modifierKinds: ["move-power", "received-damage", "stat-multiplier", "priority"],
  } as const;
}
