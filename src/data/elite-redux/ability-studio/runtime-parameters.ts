import type { AbAttr } from "#abilities/ab-attrs";
import { TerrainType } from "#data/terrain";
import { ArenaTagSide } from "#enums/arena-tag-side";
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
    | "ability"
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
  "onChange",
  "outcomes",
  "hasTagOutcomes",
  "reductionAmount",
  "oncePerBattleKey",
  "erMetaKind",
  "provenanceKey",
  "i18nKey",
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

const PARAMETER_OVERRIDES: Readonly<
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
  ChanceStatusOnAttackAbAttr: {
    tags: {
      control: "multi-select",
      editable: true,
      optional: true,
      options: enumOptions(BattlerTagType),
    },
  },
  ChanceStatusOnHitAbAttr: {
    tags: {
      control: "multi-select",
      editable: true,
      optional: true,
      options: enumOptions(BattlerTagType),
    },
  },
  PostAttackApplyBattlerTagAbAttr: {
    effects: {
      control: "multi-select",
      editable: true,
      options: enumOptions(BattlerTagType),
    },
  },
  PostAttackChangeTargetTypeAbAttr: {
    newType: {
      control: "select",
      editable: true,
      options: [...enumOptions(PokemonType), { value: "moveType", label: "Move's current type" }],
    },
  },
  PostFaintDeferredReviveAbAttr: {
    requireTerrain: {
      control: "multi-select",
      editable: true,
      optional: true,
      options: enumOptions(TerrainType),
    },
    requireWeather: {
      control: "multi-select",
      editable: true,
      optional: true,
      options: enumOptions(WeatherType),
    },
  },
  PostTurnDrainAbAttr: {
    weather: {
      control: "multi-select",
      editable: true,
      optional: true,
      options: enumOptions(WeatherType),
    },
  },
  PostTurnHurtNonTypedAbAttr: {
    requiredWeathers: {
      control: "multi-select",
      editable: true,
      optional: true,
      options: enumOptions(WeatherType),
    },
  },
  HitMultiplierAbAttr: {
    "filter.flag": {
      control: "multi-select",
      editable: true,
      options: moveFlagOptions(),
    },
  },
  HitMultiplierPowerAbAttr: {
    "powerFilter.flag": {
      control: "multi-select",
      editable: true,
      options: moveFlagOptions(),
    },
  },
  RepeatMovePowerBoostAbAttr: {
    cap: {
      control: "number",
      editable: true,
      optional: true,
      min: 0,
      max: 10,
      step: 0.05,
    },
  },
  ChanceBattlerTagOnAttackAbAttr: {
    targetHasTag: {
      control: "select",
      editable: true,
      optional: true,
      options: enumOptions(BattlerTagType),
    },
  },
  DefenseStatSwapOnFlagAbAttr: {
    "opts.swap": {
      control: "select",
      editable: true,
      options: literalOptions(["target-spdef-instead-of-def", "target-def-instead-of-spdef", "target-lower-defense"]),
    },
  },
  EntryArenaTagOnFoeSideAbAttr: {
    side: { control: "select", editable: true, options: literalOptions(["foe", "self"]) },
    tag: { control: "select", editable: true, options: enumOptions(ArenaTagType) },
  },
  EntryEffectAbAttr: {
    "effect.hazard": { control: "select", editable: true, options: enumOptions(ArenaTagType) },
    "effect.side": { control: "select", editable: true, options: literalOptions(["foe", "self", "both"]) },
    "effect.tag": { control: "select", editable: true, options: enumOptions(ArenaTagType) },
  },
  EntryTrapOnFoeSideAbAttr: {
    side: { control: "select", editable: true, options: literalOptions(["foe", "self"]) },
  },
  LifestealOnHitAbAttr: {
    "hitFilter.targetTag": {
      control: "select",
      editable: true,
      optional: true,
      options: enumOptions(BattlerTagType),
    },
  },
  MoveFlagInjectionAbAttr: {
    scope: {
      control: "select",
      editable: true,
      options: literalOptions(["kicking-moves", "sound-moves", "dance-moves", "status-moves", "all-attacks"]),
    },
  },
  PostAttackSetHazardByMoveTypeAbAttr: {
    tagType: { control: "select", editable: true, options: enumOptions(ArenaTagType) },
  },
  PostDefendHpGatedStatStageChangeAbAttr: {
    guardTag: {
      control: "select",
      editable: true,
      optional: true,
      options: enumOptions(BattlerTagType),
    },
  },
  PostSummonAddArenaTagAbAttr: {
    tagType: { control: "select", editable: true, options: enumOptions(ArenaTagType) },
  },
  PostSummonRemoveArenaTagAbAttr: {
    sideMode: { control: "select", editable: true, options: literalOptions(["both", "own", "opponent"]) },
  },
  PostSummonRemoveBattlerTagAbAttr: {
    immuneTags: { control: "multi-select", editable: true, options: enumOptions(BattlerTagType) },
  },
  SelfDamageOnAttackAbAttr: {
    basis: { control: "select", editable: true, options: literalOptions(["maxHp", "damageDealt"]) },
  },
  SetArenaTagOnHitAbAttr: {
    side: { control: "select", editable: true, options: literalOptions(["self", "attacker", "both"]) },
    tagType: { control: "select", editable: true, options: enumOptions(ArenaTagType) },
  },
  SpeedBonusToStatAbAttr: {
    "bonusFilter.contact": { control: "select", editable: true, options: literalOptions(["only", "non"]) },
  },
  StatChangeOnCategoryAttackAbAttr: {
    target: { control: "select", editable: true, options: literalOptions(["self", "opponent"]) },
  },
  StatTriggerOnStatLoweredAbAttr: {
    scope: { control: "select", editable: true, options: literalOptions(["self", "side"]) },
  },
};

const PARAMETER_LABELS: Readonly<Record<string, string>> = {
  activateOnGain: "Also trigger when gained",
  basis: "Self-damage basis",
  "bonusFilter.contact": "Contact requirement",
  "condition.kind": "Priority condition",
  "conditionSpec.kind": "Recovery condition",
  "damageCondition.kind": "Damage condition",
  "effect.hazard": "Hazard",
  "effect.kind": "Effect",
  "effect.side": "Target side",
  "effect.tag": "Field effect",
  event: "Trigger",
  "filterSpec.kind": "Damage filter",
  "gate.kind": "Activation gate",
  guardTag: "Suppress while holder has",
  "hitFilter.targetTag": "Required target volatile effect",
  immuneTags: "Removed volatile effects",
  moveId: "Move",
  "outcome.kind": "Outcome",
  power: "Base power",
  scope: "Affected scope",
  side: "Target side",
  sideMode: "Affected sides",
  "source.kind": "Converted move source",
  targetFormKey: "Target form",
  targetHasTag: "Required target volatile effect",
  "usage.kind": "Usage limit",
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
  chance: "Activation chance (%)",
  contactExcluded: "Only non-contact moves",
  contactRequired: "Require contact",
  critRequired: "Require a critical hit",
  damageFraction: "Max HP damage fraction",
  damageRatio: "Max HP damage denominator (1 / value)",
  damageMultiplier: "Incoming damage multiplier",
  effects: "Status outcomes",
  firstTurnChance: "First-turn chance (%)",
  fraction: "Max HP fraction",
  healFraction: "Max HP healing fraction",
  healRatio: "Max HP healing denominator (1 / value)",
  hpFraction: "Max HP fraction",
  lowHpThreshold: "Low HP threshold",
  requireTerrain: "Required terrains",
  requireWeather: "Required weather",
  requiredWeathers: "Required weather",
  safeTypes: "Immune types",
  tags: "Volatile-effect outcomes",
  turnCount: "Duration (turns; 0 uses the source default)",
  turns: "Duration (turns)",
  ability: "Ability",
  abilityId: "Ability",
};

function words(value: string): string {
  return value
    .replace(/[_-]+/g, " ")
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
  const segments = path.split(".");
  const key = segments.at(-1) ?? path;
  const label = words(key);
  const numbered = /^\d+$/.test(segments.at(-2) ?? "") ? ` ${Number(segments.at(-2)) + 1}` : "";
  return label.length > 0 ? `${label[0].toUpperCase()}${label.slice(1)}${numbered}` : label;
}

function enumOptions(enumObject: object): AbilityStudioRuntimeParameterOption[] {
  return Object.entries(enumObject)
    .filter(
      (entry): entry is [string, string | number] =>
        Number.isNaN(Number(entry[0])) && ["string", "number"].includes(typeof entry[1]),
    )
    .map(([label, value]) => ({ value, label: words(label) }));
}

function literalOptions(values: readonly string[]): AbilityStudioRuntimeParameterOption[] {
  return values.map(value => {
    const label = words(value);
    return { value, label: label.length > 0 ? `${label[0].toUpperCase()}${label.slice(1)}` : label };
  });
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
  const scalarOrList =
    value === undefined || value === null || validScalar(value) || (Array.isArray(value) && value.every(validScalar));
  if (!scalarOrList) {
    return;
  }
  const multiple =
    Array.isArray(value)
    || key.endsWith("ids")
    || key.endsWith("types")
    || key.endsWith("stats")
    || key.endsWith("statuses")
    || key.endsWith("effects")
    || key.endsWith("tags")
    || key.endsWith("flags")
    || key.endsWith("categories")
    || key.endsWith("weathers")
    || key.endsWith("terrains")
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
  if (
    key === "tag"
    || key === "tags"
    || key === "tagtype"
    || key.endsWith("tag")
    || key.endsWith("tags")
    || key.endsWith("tagtypes")
  ) {
    return { control: optionControl, editable: true, options: enumOptions(BattlerTagType) };
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

function dynamicParameterOverride(
  attrType: string,
  path: string,
): Partial<AbilityStudioRuntimeParameterDefinition> | undefined {
  const key = path.split(".").at(-1)?.toLowerCase();
  if (key === "ability" || key === "abilityid" || key?.endsWith("hasability")) {
    return { control: "ability", editable: true };
  }
  if (attrType === "PostSummonStackSetEffectsAbAttr" && /^opts\.tags\.\d+\.type$/.test(path)) {
    return { control: "select", editable: true, options: enumOptions(ArenaTagType) };
  }
  if (attrType === "PostSummonStackSetEffectsAbAttr" && /^opts\.tags\.\d+\.side$/.test(path)) {
    return { control: "select", editable: true, options: enumOptions(ArenaTagSide) };
  }
  if (attrType === "PostAttackSetTerrainByMoveTypeAbAttr" && /^terrainByType\.\d+\.key$/.test(path)) {
    return {
      label: parameterLabel(path).replace("Key", "Move type"),
      control: "select",
      editable: true,
      options: enumOptions(PokemonType),
    };
  }
  if (attrType === "PostAttackSetTerrainByMoveTypeAbAttr" && /^terrainByType\.\d+\.value$/.test(path)) {
    return {
      label: parameterLabel(path).replace("Value", "Terrain"),
      control: "select",
      editable: true,
      options: enumOptions(TerrainType),
    };
  }
  if (key === "message") {
    return { control: "text", editable: true };
  }
  return;
}

function nullablePathIsConfigurable(path: string): boolean {
  const key = (path.split(".").at(-1) ?? path).toLowerCase();
  return (
    enumDefinition(path, null) !== undefined
    || key.includes("chance")
    || key.endsWith("percent")
    || key.endsWith("pct")
    || key.includes("multiplier")
    || key === "mult"
    || key === "factor"
    || key.includes("power")
    || key.includes("priority")
    || key.includes("stage")
    || key === "amount"
    || key === "reduction"
    || key.includes("turn")
    || key.includes("uses")
    || key.includes("strikes")
    || key === "count"
    || key.includes("ratio")
    || key.includes("fraction")
    || key.includes("threshold")
  );
}

function numberDefinition(path: string, value: number | undefined): Partial<AbilityStudioRuntimeParameterDefinition> {
  const key = (path.split(".").at(-1) ?? path).toLowerCase();
  if (key.includes("chance") || key.endsWith("percent") || key.endsWith("pct")) {
    return { control: "number", editable: true, min: 0, max: 100, step: 1 };
  }
  if (key.includes("multiplier") || key === "mult" || key === "factor") {
    return { control: "number", editable: true, min: value !== undefined && value < 0 ? -10 : 0, max: 10, step: 0.05 };
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
  if (key === "reduction") {
    return { control: "number", editable: true, min: 0, max: 99, step: 1 };
  }
  if (key.includes("turn") || key.includes("uses") || key.includes("strikes") || key === "count") {
    return { control: "number", editable: true, min: 0, max: 99, step: 1 };
  }
  if (key.includes("ratio") && value !== undefined && value > 1) {
    return { control: "number", editable: true, min: 1, max: 999, step: 1 };
  }
  if (
    key.includes("ratio")
    || key.includes("fraction")
    || (key.includes("threshold") && (value === undefined || (value >= 0 && value <= 1)))
  ) {
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
  const definition =
    typeof value === "boolean"
      ? { control: "boolean" as const, editable: true }
      : (enumDefinition(path, value)
        ?? ((typeof value === "number" && Number.isFinite(value)) || value === undefined || value === null
          ? numberDefinition(path, typeof value === "number" ? value : undefined)
          : Array.isArray(value) && value.every(item => typeof item === "number")
            ? { control: "number-list" as const, editable: true }
            : { control: "fixed" as const, editable: false }));
  return {
    path,
    label: parameterLabel(path),
    control: definition.control ?? "fixed",
    editable: definition.editable ?? false,
    optional: optional || value === null,
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
  if (path === "key" || path.split(".").some(key => OMITTED_PARAMETERS.has(key) || INTERNAL_STATE_KEYS.test(key))) {
    return;
  }
  if (isPlainRecord(value)) {
    for (const [key, child] of Object.entries(value)) {
      collectEntries(child, path ? `${path}.${key}` : key, entries);
    }
    return;
  }
  if (value instanceof Set) {
    collectEntries([...value], path, entries);
    return;
  }
  if (value instanceof Map) {
    collectEntries(
      [...value].map(([key, mappedValue]) => ({ key, value: mappedValue })),
      path,
      entries,
    );
    return;
  }
  if (Array.isArray(value) && value.length > 0 && value.every(isPlainRecord)) {
    value.forEach((child, index) => collectEntries(child, `${path}.${index}`, entries));
    return;
  }
  if (typeof value === "function") {
    return;
  }
  if (value === null && !nullablePathIsConfigurable(path)) {
    return;
  }
  if (value !== null && typeof value === "object" && !Array.isArray(value)) {
    return;
  }
  entries.push({ definition: parameterDefinition(path, value), value });
}

function virtualParameterValues(attr: AbAttr, attrType: string): Readonly<Record<string, unknown>> {
  if (attrType !== "ChanceStatusOnAttackAbAttr" && attrType !== "ChanceStatusOnHitAbAttr") {
    return {};
  }
  const record = attr as unknown as Record<string, unknown>;
  const outcomes = Array.isArray(record.outcomes) ? record.outcomes : [];
  return {
    tags: outcomes
      .filter(
        (outcome): outcome is { kind: "tag"; value: string | number } =>
          isPlainRecord(outcome)
          && outcome.kind === "tag"
          && (typeof outcome.value === "string" || typeof outcome.value === "number"),
      )
      .map(outcome => outcome.value),
  };
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
  const parameterOverrides = PARAMETER_OVERRIDES[attrType] ?? {};
  const virtualValues = virtualParameterValues(attr, attrType);
  for (const [path, override] of Object.entries(parameterOverrides)) {
    if (!knownPaths.has(path)) {
      const value = virtualValues[path];
      entries.push({
        definition: mergeParameterDefinition(parameterDefinition(path, value, true), override),
        value,
      });
    }
  }
  return entries.map(entry => {
    const override =
      parameterOverrides[entry.definition.path] ?? dynamicParameterOverride(attrType, entry.definition.path);
    const value = normalizeParameterValue(attrType, entry.definition.path, entry.value);
    return override === undefined
      ? { ...entry, value }
      : {
          ...entry,
          value,
          definition: mergeParameterDefinition(entry.definition, override),
        };
  });
}

function normalizeParameterValue(attrType: string, path: string, value: unknown): unknown {
  if (attrType === "RepeatMovePowerBoostAbAttr" && path === "cap" && value === Number.POSITIVE_INFINITY) {
    return;
  }
  if (
    typeof value === "number"
    && ((attrType === "HitMultiplierAbAttr" && path === "filter.flag")
      || (attrType === "HitMultiplierPowerAbAttr" && path === "powerFilter.flag"))
  ) {
    return moveFlagOptions()
      .filter(option => typeof option.value === "number" && (value & option.value) === option.value)
      .map(option => option.value);
  }
  return value;
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
  if (definition.control === "ability") {
    return typeof value === "number" && Number.isInteger(value) && value > 0;
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

function setParameterPath(target: Record<string, unknown>, path: string, value: unknown): void {
  const segments = path.split(".");
  let current = target;
  for (const [index, segment] of segments.slice(0, -1).entries()) {
    const source = current[segment];
    const clone: Record<string, unknown> = Array.isArray(source)
      ? ([...source] as unknown as Record<string, unknown>)
      : isPlainRecord(source)
        ? { ...source }
        : /^\d+$/.test(segments[index + 1] ?? "")
          ? ([] as unknown as Record<string, unknown>)
          : {};
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

function synchronizeDerivedParameters(
  attr: AbAttr,
  attrType: string,
  overrides: Readonly<Record<string, AbilityStudioRuntimeParameterValue>>,
): void {
  if (attrType !== "ChanceStatusOnAttackAbAttr" && attrType !== "ChanceStatusOnHitAbAttr") {
    return;
  }
  const record = attr as unknown as Record<string, unknown>;
  const existingOutcomes = Array.isArray(record.outcomes) ? record.outcomes : [];
  const effects = Array.isArray(record.effects)
    ? record.effects.filter((value): value is string | number => typeof value === "string" || typeof value === "number")
    : [];
  const tags = Object.hasOwn(overrides, "tags")
    ? Array.isArray(record.tags)
      ? record.tags.filter((value): value is string | number => typeof value === "string" || typeof value === "number")
      : []
    : existingOutcomes
        .filter(
          (outcome): outcome is { kind: "tag"; value: string | number } =>
            isPlainRecord(outcome)
            && outcome.kind === "tag"
            && (typeof outcome.value === "string" || typeof outcome.value === "number"),
        )
        .map(outcome => outcome.value);
  record.outcomes = [
    ...effects.map(value => ({ kind: "status", value })),
    ...tags.map(value => ({ kind: "tag", value })),
  ];
  if (attrType === "ChanceStatusOnHitAbAttr") {
    record.hasTagOutcomes = tags.length > 0;
  }
}

function denormalizeParameterValue(
  attr: AbAttr,
  attrType: string,
  path: string,
  value: AbilityStudioRuntimeParameterValue,
): unknown {
  if (
    Array.isArray(value)
    && ((attrType === "HitMultiplierAbAttr" && path === "filter.flag")
      || (attrType === "HitMultiplierPowerAbAttr" && path === "powerFilter.flag"))
  ) {
    return value.reduce((mask, flag) => mask | Number(flag), 0);
  }
  const existing = (attr as unknown as Record<string, unknown>)[path];
  if (existing instanceof Set && Array.isArray(value)) {
    return new Set(value);
  }
  return value;
}

function applyMapParameterOverrides(
  attr: AbAttr,
  attrType: string,
  overrides: Readonly<Record<string, AbilityStudioRuntimeParameterValue>>,
): ReadonlySet<string> {
  if (attrType !== "PostAttackSetTerrainByMoveTypeAbAttr") {
    return new Set();
  }
  const paths = Object.keys(overrides).filter(path => /^terrainByType\.\d+\.(?:key|value)$/.test(path));
  if (paths.length === 0) {
    return new Set();
  }
  const record = attr as unknown as Record<string, unknown>;
  const source = record.terrainByType;
  if (!(source instanceof Map)) {
    throw new Error(`invalid Ability Studio map source ${attrType}.terrainByType`);
  }
  const holder: Record<string, unknown> = {
    terrainByType: [...source].map(([key, mappedValue]) => ({ key, value: mappedValue })),
  };
  for (const path of paths) {
    setParameterPath(holder, path, overrides[path]);
  }
  const rows = holder.terrainByType;
  if (!Array.isArray(rows)) {
    throw new Error(`invalid Ability Studio map override ${attrType}.terrainByType`);
  }
  record.terrainByType = new Map(
    rows.map(row => {
      if (!isPlainRecord(row) || typeof row.key !== "number" || typeof row.value !== "number") {
        throw new Error(`invalid Ability Studio map row ${attrType}.terrainByType`);
      }
      return [row.key, row.value];
    }),
  );
  return new Set(paths);
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
  }
  const appliedMapPaths = applyMapParameterOverrides(attr, attrType, overrides);
  for (const [path, value] of Object.entries(overrides)) {
    if (appliedMapPaths.has(path)) {
      continue;
    }
    setParameterPath(
      attr as unknown as Record<string, unknown>,
      path,
      denormalizeParameterValue(attr, attrType, path, value),
    );
  }
  synchronizeDerivedParameters(attr, attrType, overrides);
}
