import type { AbAttr } from "#abilities/ab-attrs";
import { TerrainType } from "#data/terrain";
import { ArenaTagType } from "#enums/arena-tag-type";
import { BattlerTagType } from "#enums/battler-tag-type";
import { BerryType } from "#enums/berry-type";
import { MoveCategory } from "#enums/move-category";
import { MoveFlags } from "#enums/move-flags";
import { MoveTarget } from "#enums/move-target";
import { PokemonType } from "#enums/pokemon-type";
import { Stat } from "#enums/stat";
import { StatusEffect } from "#enums/status-effect";
import { WeatherType } from "#enums/weather-type";

export type AbilityStudioRuntimeParameterValue =
  | string
  | number
  | boolean
  | readonly string[]
  | readonly number[]
  | readonly boolean[]
  | null;

export interface AbilityStudioRuntimeParameterOption {
  readonly value: string | number;
  readonly label: string;
}

export interface AbilityStudioRuntimeParameterDefinition {
  readonly path: string;
  readonly label: string;
  readonly control:
    | "fixed"
    | "number"
    | "number-list"
    | "boolean"
    | "move"
    | "move-list"
    | "select"
    | "multi-select"
    | "text";
  readonly editable: boolean;
  readonly optional?: boolean;
  readonly min?: number;
  readonly max?: number;
  readonly step?: number;
  readonly options?: readonly AbilityStudioRuntimeParameterOption[];
}

export interface AbilityStudioRuntimeParameterEntry {
  readonly definition: AbilityStudioRuntimeParameterDefinition;
  readonly value: unknown;
}

const OMITTED_PARAMETERS = new Set([
  "showAbility",
  "extraCondition",
  "componentLabel",
  "componentHookId",
  "componentHookLabel",
  "abilityStudioCapability",
  "abilityStudioSourceAbilityId",
  "activeBattleData",
  "skipDuringMovesetGen",
]);

const INTERNAL_STATE_KEYS =
  /^(active|applied|cached|consumed|current|fired|last|pending|satisfied|state|triggered|used|warned)/i;

const SCRIPTED_MOVE_PARAMETERS: Readonly<
  Record<string, Readonly<Record<string, Partial<AbilityStudioRuntimeParameterDefinition>>>>
> = {
  PostAttackScriptedMoveAbAttr: {
    "opts.moveId": { control: "move", editable: true },
    "opts.power": { control: "number", editable: true, optional: true, min: 0, max: 999, step: 1 },
    "opts.categoryFilter": {
      control: "select",
      editable: true,
      optional: true,
      options: enumOptions(MoveCategory),
    },
    "opts.typeFilter": {
      control: "multi-select",
      editable: true,
      optional: true,
      options: enumOptions(PokemonType),
    },
    "opts.flagFilter": {
      control: "select",
      editable: true,
      optional: true,
      options: moveFlagOptions(),
    },
    "opts.magnitudeRange": {
      control: "number-list",
      editable: true,
      optional: true,
      min: 1,
      max: 10,
      step: 1,
    },
    "opts.hpScaledBasePower": {
      control: "number",
      editable: true,
      optional: true,
      min: 0,
      max: 999,
      step: 1,
    },
    "opts.triggerMoveIds": { control: "move-list", editable: true, optional: true },
    "opts.targetStatsDecreased": { control: "boolean", editable: true, optional: true },
    "opts.allowVirtualTriggerMoveId": { control: "move", editable: true, optional: true },
  },
  PostSummonScriptedMoveAbAttr: {
    "opts.moveId": { control: "move", editable: true },
    "opts.power": { control: "number", editable: true, optional: true, min: 0, max: 999, step: 1 },
    "opts.targetsSelf": { control: "boolean", editable: true, optional: true },
    "opts.allOpponents": { control: "boolean", editable: true, optional: true },
    "opts.alwaysHit": { control: "boolean", editable: true, optional: true },
    "opts.nonReflectable": { control: "boolean", editable: true, optional: true },
  },
  PostTurnScriptedMoveAbAttr: {
    moveId: { control: "move", editable: true },
    power: { control: "number", editable: true, optional: true, min: 0, max: 999, step: 1 },
  },
  OnOpponentStatRaiseScriptedMoveAbAttr: {
    "opts.moveId": { control: "move", editable: true },
    "opts.power": { control: "number", editable: true, optional: true, min: 0, max: 999, step: 1 },
  },
  PostItemLostScriptedMoveAbAttr: {
    "opts.moveId": { control: "move", editable: true },
    "opts.power": { control: "number", editable: true, optional: true, min: 0, max: 999, step: 1 },
  },
};

const PARAMETER_LABELS: Readonly<Record<string, string>> = {
  activateOnGain: "Also trigger when gained",
  moveId: "Move",
  power: "Base power",
  "opts.moveId": "Move",
  "opts.power": "Base power",
  "opts.categoryFilter": "Trigger move category",
  "opts.typeFilter": "Trigger move types",
  "opts.flagFilter": "Trigger move flag",
  "opts.magnitudeRange": "Magnitude level range",
  "opts.hpScaledBasePower": "HP-scaled base power",
  "opts.triggerMoveIds": "Trigger moves",
  "opts.targetStatsDecreased": "Require lowered target stats",
  "opts.allowVirtualTriggerMoveId": "Allowed virtual trigger move",
  "opts.targetsSelf": "Target the holder",
  "opts.allOpponents": "Target all opponents",
  "opts.alwaysHit": "Always hit",
  "opts.maxUsesPerBattle": "Maximum uses per battle",
  "opts.nonReflectable": "Cannot be reflected",
};

function words(value: string): string {
  return value
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .replace(/\bHp\b/g, "HP")
    .replace(/\bId\b/g, "ID")
    .replace(/\bPp\b/g, "PP")
    .replace(/\bStab\b/g, "same-type attack bonus")
    .trim();
}

function parameterLabel(path: string): string {
  const explicit = PARAMETER_LABELS[path];
  if (explicit !== undefined) {
    return explicit;
  }
  const key = path.split(".").at(-1) ?? path;
  const label = words(key);
  return label.length > 0 ? `${label[0].toUpperCase()}${label.slice(1)}` : label;
}

function enumOptions(enumObject: object): AbilityStudioRuntimeParameterOption[] {
  return Object.entries(enumObject)
    .filter(
      (entry): entry is [string, string | number] =>
        Number.isNaN(Number(entry[0])) && ["string", "number"].includes(typeof entry[1]),
    )
    .map(([label, value]) => ({ value, label: words(label) }));
}

function tagOptions(): AbilityStudioRuntimeParameterOption[] {
  const options = [...enumOptions(BattlerTagType), ...enumOptions(ArenaTagType)];
  return options.filter((option, index) => options.findIndex(candidate => candidate.value === option.value) === index);
}

function moveFlagOptions(): AbilityStudioRuntimeParameterOption[] {
  return Object.entries(MoveFlags)
    .filter(
      (entry): entry is [string, number] =>
        Number.isNaN(Number(entry[0])) && typeof entry[1] === "number" && entry[1] !== MoveFlags.NONE,
    )
    .map(([label, value]) => ({ value, label: words(label) }));
}

function enumDefinition(path: string, value: unknown): Partial<AbilityStudioRuntimeParameterDefinition> | undefined {
  const key = (path.split(".").at(-1) ?? path).toLowerCase();
  const multiple =
    Array.isArray(value)
    || key.endsWith("ids")
    || key.endsWith("types")
    || key.endsWith("stats")
    || key === "typefilter";
  const optionControl = multiple ? "multi-select" : "select";
  if (key.includes("moveid") || key === "move" || key === "moves") {
    return { control: multiple ? "move-list" : "move", editable: true };
  }
  if (key.includes("category")) {
    return { control: optionControl, editable: true, options: enumOptions(MoveCategory) };
  }
  if (key.includes("flag")) {
    return { control: optionControl, editable: true, options: moveFlagOptions() };
  }
  if (key.includes("movetarget")) {
    return { control: optionControl, editable: true, options: enumOptions(MoveTarget) };
  }
  if (key.includes("weather")) {
    return { control: optionControl, editable: true, options: enumOptions(WeatherType) };
  }
  if (key.includes("terrain")) {
    return { control: optionControl, editable: true, options: enumOptions(TerrainType) };
  }
  if (key.includes("arenatag")) {
    return { control: optionControl, editable: true, options: enumOptions(ArenaTagType) };
  }
  if (key === "tag" || key === "tagtype" || key.endsWith("tagtypes")) {
    return { control: optionControl, editable: true, options: tagOptions() };
  }
  if (key.includes("status") || key.includes("immuneeffect") || key === "effects") {
    return { control: optionControl, editable: true, options: enumOptions(StatusEffect) };
  }
  if (key === "stat" || key === "stats" || key === "candidates") {
    return { control: optionControl, editable: true, options: enumOptions(Stat) };
  }
  if (key.includes("berry")) {
    return { control: optionControl, editable: true, options: enumOptions(BerryType) };
  }
  if (key === "type" || key === "types" || key.endsWith("type") || key.endsWith("types") || key === "typefilter") {
    return { control: optionControl, editable: true, options: enumOptions(PokemonType) };
  }
  return;
}

function numberDefinition(path: string, value: number | undefined): Partial<AbilityStudioRuntimeParameterDefinition> {
  const key = (path.split(".").at(-1) ?? path).toLowerCase();
  if (key.includes("chance") || key.endsWith("percent") || key.endsWith("pct")) {
    return { control: "number", editable: true, min: 0, max: 100, step: 1 };
  }
  if (key.includes("multiplier") || key === "mult" || key === "factor") {
    return { control: "number", editable: true, min: 0, max: 10, step: 0.05 };
  }
  if (key.includes("power")) {
    return { control: "number", editable: true, min: 0, max: 999, step: 1 };
  }
  if (key.includes("priority")) {
    return { control: "number", editable: true, min: -7, max: 7, step: 1 };
  }
  if (key.includes("stage") || key === "amount") {
    return { control: "number", editable: true, min: -12, max: 12, step: 1 };
  }
  if (key.includes("turn") || key.includes("uses") || key.includes("strikes") || key === "count") {
    return { control: "number", editable: true, min: 1, max: 99, step: 1 };
  }
  if (key.includes("ratio") && value !== undefined && value >= 0 && value <= 1) {
    return { control: "number", editable: true, min: 0, max: 1, step: 0.01 };
  }
  return {
    control: "number",
    editable: true,
    min: Number.isInteger(value) ? -999 : -100,
    max: 999,
    step: Number.isInteger(value) ? 1 : 0.01,
  };
}

function parameterDefinition(path: string, value: unknown, optional = false): AbilityStudioRuntimeParameterDefinition {
  const fromEnum = enumDefinition(path, value);
  const definition =
    fromEnum
    ?? (typeof value === "boolean"
      ? { control: "boolean" as const, editable: true }
      : typeof value === "number" || value === undefined
        ? numberDefinition(path, typeof value === "number" ? value : undefined)
        : Array.isArray(value) && value.every(item => typeof item === "number")
          ? { control: "number-list" as const, editable: true }
          : { control: "fixed" as const, editable: false });
  return {
    path,
    label: parameterLabel(path),
    control: definition.control ?? "fixed",
    editable: definition.editable ?? false,
    optional,
    ...(definition.min === undefined ? {} : { min: definition.min }),
    ...(definition.max === undefined ? {} : { max: definition.max }),
    ...(definition.step === undefined ? {} : { step: definition.step }),
    ...(definition.options === undefined ? {} : { options: definition.options }),
  };
}

function mergeParameterDefinition(
  definition: AbilityStudioRuntimeParameterDefinition,
  override: Partial<AbilityStudioRuntimeParameterDefinition>,
): AbilityStudioRuntimeParameterDefinition {
  const control = override.control ?? definition.control;
  const min = override.min ?? definition.min;
  const max = override.max ?? definition.max;
  const step = override.step ?? definition.step;
  const options = override.options ?? definition.options;
  return {
    path: definition.path,
    label: override.label ?? PARAMETER_LABELS[definition.path] ?? definition.label,
    control,
    editable: override.editable ?? definition.editable,
    optional: override.optional ?? definition.optional ?? false,
    ...(["number", "number-list"].includes(control) && min !== undefined ? { min } : {}),
    ...(["number", "number-list"].includes(control) && max !== undefined ? { max } : {}),
    ...(["number", "number-list"].includes(control) && step !== undefined ? { step } : {}),
    ...(["select", "multi-select"].includes(control) && options !== undefined ? { options } : {}),
  };
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return (
    value !== null
    && typeof value === "object"
    && !Array.isArray(value)
    && Object.getPrototypeOf(value) === Object.prototype
  );
}

function collectEntries(value: unknown, path: string, entries: AbilityStudioRuntimeParameterEntry[]): void {
  if (path.split(".").some(key => OMITTED_PARAMETERS.has(key) || INTERNAL_STATE_KEYS.test(key))) {
    return;
  }
  if (isPlainRecord(value)) {
    for (const [key, child] of Object.entries(value)) {
      collectEntries(child, path ? `${path}.${key}` : key, entries);
    }
    return;
  }
  entries.push({ definition: parameterDefinition(path, value), value });
}

export function abilityStudioRuntimeParameterEntries(
  attr: AbAttr,
  attrType: string,
): AbilityStudioRuntimeParameterEntry[] {
  const entries: AbilityStudioRuntimeParameterEntry[] = [];
  for (const [key, value] of Object.entries(attr)) {
    if (OMITTED_PARAMETERS.has(key) || INTERNAL_STATE_KEYS.test(key) || value === undefined) {
      continue;
    }
    collectEntries(value, key, entries);
  }
  const knownPaths = new Set(entries.map(entry => entry.definition.path));
  const scriptedParameters = SCRIPTED_MOVE_PARAMETERS[attrType] ?? {};
  for (const [path, override] of Object.entries(scriptedParameters)) {
    if (!knownPaths.has(path)) {
      entries.push({
        definition: mergeParameterDefinition(parameterDefinition(path, undefined, true), override),
        value: undefined,
      });
    }
  }
  return entries.map(entry => {
    const override = scriptedParameters[entry.definition.path];
    return override === undefined
      ? entry
      : {
          ...entry,
          definition: mergeParameterDefinition(entry.definition, override),
        };
  });
}

function validScalar(value: unknown): value is string | number | boolean {
  return (
    typeof value === "string" || (typeof value === "number" && Number.isFinite(value)) || typeof value === "boolean"
  );
}

export function isAbilityStudioRuntimeParameterValue(value: unknown): value is AbilityStudioRuntimeParameterValue {
  return (
    value === null || validScalar(value) || (Array.isArray(value) && value.length <= 32 && value.every(validScalar))
  );
}

function overrideIsValid(
  definition: AbilityStudioRuntimeParameterDefinition,
  value: AbilityStudioRuntimeParameterValue,
): boolean {
  if (!definition.editable) {
    return false;
  }
  if (value === null) {
    return definition.optional === true;
  }
  if (definition.control === "boolean") {
    return typeof value === "boolean";
  }
  if (definition.control === "number") {
    return (
      typeof value === "number"
      && (definition.min === undefined || value >= definition.min)
      && (definition.max === undefined || value <= definition.max)
    );
  }
  if (definition.control === "number-list") {
    return (
      Array.isArray(value)
      && value.length > 0
      && value.every(
        item =>
          typeof item === "number"
          && Number.isFinite(item)
          && (definition.min === undefined || item >= definition.min)
          && (definition.max === undefined || item <= definition.max),
      )
    );
  }
  if (definition.control === "move") {
    return typeof value === "number" && Number.isInteger(value) && value > 0;
  }
  if (definition.control === "move-list") {
    return Array.isArray(value) && value.every(item => typeof item === "number" && Number.isInteger(item) && item > 0);
  }
  if (definition.control === "select") {
    return !Array.isArray(value) && definition.options?.some(option => option.value === value) === true;
  }
  if (definition.control === "multi-select") {
    return (
      Array.isArray(value) && value.every(item => definition.options?.some(option => option.value === item) === true)
    );
  }
  return definition.control === "text" && typeof value === "string";
}

function setParameterPath(
  target: Record<string, unknown>,
  path: string,
  value: AbilityStudioRuntimeParameterValue,
): void {
  const segments = path.split(".");
  let current = target;
  for (const segment of segments.slice(0, -1)) {
    const source = current[segment];
    const clone = isPlainRecord(source) ? { ...source } : {};
    current[segment] = clone;
    current = clone;
  }
  const key = segments.at(-1) ?? path;
  if (value === null) {
    delete current[key];
  } else {
    current[key] = Array.isArray(value) ? [...value] : value;
  }
}

export function applyAbilityStudioRuntimeParameterOverrides(
  attr: AbAttr,
  attrType: string,
  overrides: Readonly<Record<string, AbilityStudioRuntimeParameterValue>> | undefined,
): void {
  if (overrides === undefined) {
    return;
  }
  const definitions = new Map(
    abilityStudioRuntimeParameterEntries(attr, attrType).map(entry => [entry.definition.path, entry.definition]),
  );
  for (const [path, value] of Object.entries(overrides)) {
    const definition = definitions.get(path);
    if (definition === undefined || !overrideIsValid(definition, value)) {
      throw new Error(`invalid Ability Studio parameter override ${attrType}.${path}`);
    }
    setParameterPath(attr as unknown as Record<string, unknown>, path, value);
  }
}
