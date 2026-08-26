import type { AbAttr } from "#abilities/ab-attrs";
import type { Ability } from "#abilities/ability";
import { TerrainType } from "#data/terrain";
import { ArenaTagType } from "#enums/arena-tag-type";
import { BattlerTagType } from "#enums/battler-tag-type";
import { BerryType } from "#enums/berry-type";
import { MoveCategory } from "#enums/move-category";
import { MoveFlags } from "#enums/move-flags";
import { MoveId } from "#enums/move-id";
import { MoveTarget } from "#enums/move-target";
import { PokemonType } from "#enums/pokemon-type";
import { Stat } from "#enums/stat";
import { StatusEffect } from "#enums/status-effect";
import { WeatherType } from "#enums/weather-type";
import {
  AbilityStudioRuntimeCapabilityAbAttr,
  AbilityStudioSourceAbilityAbAttr,
  abilityStudioRuntimeClassChain,
} from "./runtime-components";

export interface AbilityStudioSemanticParameter {
  readonly key: string;
  readonly label: string;
  readonly value: string;
}

export interface AbilityStudioComponentSemantics {
  readonly label: string;
  readonly summary: string;
  readonly scope: "primitive" | "package";
  readonly parameters: readonly AbilityStudioSemanticParameter[];
}

const OMITTED_PARAMETERS = new Set([
  "showAbility",
  "extraCondition",
  "componentLabel",
  "componentHookId",
  "componentHookLabel",
  "abilityStudioCapability",
  "abilityStudioSourceAbilityId",
]);

const OPERATION_LABELS: Readonly<Record<string, string>> = {
  AbilityStudioRuntimeCapabilityAbAttr: "Direct runtime effect",
  AbilityStudioSourceAbilityAbAttr: "Complete direct engine integration",
  MovePowerBoostAbAttr: "Multiply matching move power",
  MoveTypePowerBoostAbAttr: "Multiply matching move-type power",
  LowHpMoveTypePowerBoostAbAttr: "Multiply move-type power at low HP",
  TypeDamageBoostAbAttr: "Multiply typed move power",
  FlagDamageBoostAbAttr: "Multiply move-family power",
  ReceivedMoveDamageMultiplierAbAttr: "Multiply matching incoming damage",
  ReceivedTypeDamageMultiplierAbAttr: "Multiply incoming typed damage",
  DamageReductionAbAttr: "Reduce matching incoming damage",
  StatMultiplierAbAttr: "Multiply a calculated stat",
  WeatherStatMultiplierAbAttr: "Multiply a calculated stat in weather",
  SelfHighestStatMultiplierAbAttr: "Multiply the holder's highest calculated stat",
  PostSummonStatStageChangeAbAttr: "Change stat stages on entry",
  PostDefendStatStageChangeAbAttr: "Change stat stages after being hit",
  ChanceStatusOnAttackAbAttr: "Chance to inflict status after attacking",
  ChanceStatusOnHitAbAttr: "Chance to inflict status after being hit",
  ChanceBattlerTagOnAttackAbAttr: "Chance to apply a volatile effect after attacking",
  ChanceBattlerTagOnHitAbAttr: "Chance to apply a volatile effect after being hit",
  PostAttackContactApplyStatusEffectAbAttr: "Inflict status after making contact",
  PostDefendContactApplyStatusEffectAbAttr: "Inflict status on a contact attacker",
  PostSummonWeatherChangeAbAttr: "Set weather on entry",
  PostSummonTerrainChangeAbAttr: "Set terrain on entry",
  TypeConversionAbAttr: "Convert matching moves to another type",
  TypeConversionPowerBoostAbAttr: "Multiply converted move power",
  MoveTypeChangeAbAttr: "Change a matching move's type",
  ChangeMovePriorityAbAttr: "Change matching move priority",
  PriorityModifierAbAttr: "Change matching move priority",
  BlockWeatherDamageAttr: "Prevent matching weather damage",
  StatusEffectImmunityAbAttr: "Prevent matching status effects",
  BattlerTagImmunityAbAttr: "Prevent matching volatile effects",
  AttackTypeImmunityAbAttr: "Negate matching attack types",
  MoveImmunityAbAttr: "Negate matching moves",
  PassiveRecoveryAbAttr: "Recover HP at the end of the turn",
  PostSummonScriptedMoveAbAttr: "Use a scripted move on entry",
  PostAttackScriptedMoveAbAttr: "Use a scripted move after attacking",
  NoFusionAbilityAbAttr: "Disable this effect while fused",
  NoTransformAbilityAbAttr: "Disable this effect while transformed",
  AbsorbantAbAttr: "Boost draining moves and apply Leech Seed",
  AddMoveFlagAbAttr: "Add a move-family property",
  AddSecondStrikeAbAttr: "Add a second strike",
  AmaterasuMarkerAbAttr: "Mark an attack for Amaterasu",
  AteConditionalStatusAbAttr: "Inflict status after a converted move",
  ErMultiHeadedAbAttr: "Repeat attacks for additional heads",
  StabAddAbAttr: "Add same-type attack bonus for another type",
  StabBoostAbAttr: "Increase same-type attack bonus",
  StabSuppressAuraAbAttr: "Suppress an opposing same-type attack bonus aura",
};

function words(value: string): string {
  return value
    .replace(/AbAttr$/, "")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .replace(/\bHp\b/g, "HP")
    .replace(/\bKo\b/g, "KO")
    .replace(/\bPp\b/g, "PP")
    .replace(/\bAi\b/g, "AI")
    .replace(/\bEr\b/g, "ER")
    .replace(/\bStab\b/g, "same-type attack bonus")
    .replace(/\bSe\b/g, "super-effective")
    .trim();
}

function parameterLabel(value: string): string {
  const label = words(value);
  return label.length > 0 ? `${label[0].toUpperCase()}${label.slice(1)}` : label;
}

function operationLabel(type: string): string {
  const configured = OPERATION_LABELS[type];
  if (configured !== undefined) {
    return configured;
  }
  const stripped = type.replace(
    /^(PostBattleInit|PostSummon|PreSummon|PostAttack|PreAttack|PostDefend|PreDefend|PostKnockOut|PostVictory|PostTurn|PostFaint|PostWeatherChange|PostWeatherLapse|PostTerrainChange|PostBiomeChange|PostMoveUsed|PostItemLost|PreSwitchOut|PreLeaveField|PreStatStageChange|PostStatStageChange|PostAllyStatStageChange|PreSetStatus|PostSetStatus|PreApplyBattlerTag|PreWeatherDamage|PreWeatherEffect)/,
    "",
  );
  return words(stripped || type);
}

function enumName(enumObject: object, value: number): string | undefined {
  const resolved = (enumObject as Record<number, string>)[value];
  return typeof resolved === "string" ? words(resolved) : undefined;
}

function moveFlags(value: number): string {
  if (value === MoveFlags.NONE) {
    return "None";
  }
  const names = Object.entries(MoveFlags)
    .filter((entry): entry is [string, number] => typeof entry[1] === "number" && entry[1] !== 0)
    .filter(([, flag]) => (value & flag) === flag)
    .map(([name]) => words(name));
  return names.length > 0 ? names.join(" + ") : String(value);
}

function semanticMoveEnum(normalized: string, value: number): string | undefined {
  if (normalized.includes("moveid") || normalized === "move" || normalized === "moves") {
    return enumName(MoveId, value);
  }
  if (normalized.includes("movetarget") || normalized === "target") {
    return enumName(MoveTarget, value);
  }
  if (normalized.includes("category")) {
    return enumName(MoveCategory, value);
  }
  if (normalized.includes("flag")) {
    return moveFlags(value);
  }
  return;
}

function semanticBattleEnum(normalized: string, value: number, attrType: string): string | undefined {
  if (normalized.includes("weather")) {
    return enumName(WeatherType, value);
  }
  if (normalized.includes("terrain")) {
    return enumName(TerrainType, value);
  }
  if (normalized.includes("arenatag")) {
    return enumName(ArenaTagType, value);
  }
  if (normalized.includes("tag")) {
    return enumName(BattlerTagType, value);
  }
  const statusValue =
    normalized.includes("status")
    || normalized.includes("immuneeffect")
    || (normalized === "effects" && attrType.toLowerCase().includes("status"));
  if (statusValue) {
    return enumName(StatusEffect, value);
  }
  if (normalized === "stat" || normalized === "stats" || normalized === "candidates") {
    return enumName(Stat, value);
  }
  if (normalized.includes("berry")) {
    return enumName(BerryType, value);
  }
  if (normalized === "type" || normalized === "types" || normalized.endsWith("type")) {
    return enumName(PokemonType, value);
  }
  return;
}

function semanticNumber(key: string, value: number, attrType: string): string {
  const normalized = key.toLowerCase();
  const resolvedEnum = semanticMoveEnum(normalized, value) ?? semanticBattleEnum(normalized, value, attrType);
  if (resolvedEnum !== undefined) {
    return resolvedEnum;
  }
  if (normalized.includes("multiplier") || normalized === "mult") {
    return `${value}x`;
  }
  if (normalized.includes("chance")) {
    return `${value}%`;
  }
  if (normalized === "stages" || normalized.endsWith("stages")) {
    return `${value > 0 ? "+" : ""}${value}`;
  }
  if (normalized.includes("threshold") || normalized.endsWith("pct") || normalized.endsWith("ratio")) {
    return value >= 0 && value <= 1 ? `${Number((value * 100).toFixed(2))}%` : String(value);
  }
  if (normalized === "healratio") {
    return `1/${value} max HP`;
  }
  return String(value);
}

function semanticValue(key: string, value: unknown, abilityName: string, attrType: string): string {
  if (typeof value === "number") {
    return semanticNumber(key, value, attrType);
  }
  if (typeof value === "boolean") {
    return value ? "Yes" : "No";
  }
  if (typeof value === "string") {
    return words(value);
  }
  if (typeof value === "function") {
    return `Custom ${words(key)} from ${abilityName}`;
  }
  if (value === null) {
    return "None";
  }
  if (Array.isArray(value)) {
    return value.length === 0 ? "None" : value.map(item => semanticValue(key, item, abilityName, attrType)).join(", ");
  }
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    if ((record.kind === "status" || record.kind === "tag") && typeof record.value === "number") {
      return semanticNumber(String(record.kind), record.value, attrType);
    }
    return Object.entries(record)
      .map(
        ([childKey, childValue]) =>
          `${parameterLabel(childKey)}: ${semanticValue(childKey, childValue, abilityName, attrType)}`,
      )
      .join(", ");
  }
  return String(value);
}

function semanticParameters(ability: Ability, attr: AbAttr): AbilityStudioSemanticParameter[] {
  const attrType = abilityStudioRuntimeClassChain(attr)[0];
  return Object.entries(attr)
    .filter(([key, value]) => !OMITTED_PARAMETERS.has(key) && value !== undefined)
    .map(([key, value]) => ({
      key,
      label: parameterLabel(key),
      value: semanticValue(key, value, ability.name, attrType),
    }));
}

export function describeAbilityStudioComponent(ability: Ability, attr: AbAttr): AbilityStudioComponentSemantics {
  const type = abilityStudioRuntimeClassChain(attr)[0];
  const parameters = semanticParameters(ability, attr);
  if (attr instanceof AbilityStudioSourceAbilityAbAttr) {
    return {
      label: `${ability.name} direct engine integration`,
      summary: `Reuse every direct engine check tied to ${ability.name}. ${ability.description}`,
      scope: "package",
      parameters,
    };
  }
  const label = attr instanceof AbilityStudioRuntimeCapabilityAbAttr ? attr.componentLabel : operationLabel(type);
  return {
    label,
    summary: `From ${ability.name}: ${ability.description}`,
    scope: "primitive",
    parameters,
  };
}
