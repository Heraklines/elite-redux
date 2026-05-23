/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Elite Redux — Phase C Task C1: archetype-primitive barrel export.
//
// Import surface for the archetype layer:
//
//   ```ts
//   import {
//     EntryEffectAbAttr,
//     FlagDamageBoostAbAttr,
//     TypeDamageBoostAbAttr,
//   } from "#data/elite-redux/archetypes";
//   ```
//
// Each archetype is one file under this directory; this barrel re-exports
// every public symbol from each. Adding a new archetype = add a new file,
// add it to this barrel.
// =============================================================================

// biome-ignore lint/performance/noBarrelFile: archetype layer is intentionally a barrel for Phase C tests + ER ability wiring; small module set
export { ChanceStatusOnHitAbAttr, type ChanceStatusOnHitOptions } from "./chance-status-on-hit";
export { type CompositeOptions, composeAbAttrs } from "./composite";
export {
  ConditionalDamageAbAttr,
  type ConditionalDamageOptions,
  type DamageCondition,
  type DamageConditionKind,
  type DamageConditionSelfLowHp,
  type DamageConditionTargetConfused,
  type DamageConditionTargetHasLoweredStat,
  type DamageConditionTargetLowHp,
  type DamageConditionTargetStatused,
} from "./conditional-damage";
export { ContactDamageOnHitAbAttr, type ContactDamageOnHitOptions } from "./contact-damage-on-hit";
export {
  CritDamageMultiplierAbAttr,
  type CritDamageMultiplierOptions,
  CritImmunityAbAttr,
  type CritMod,
  type CritModFilter,
  CritStageBonusAbAttr,
  type CritStageBonusOptions,
} from "./crit-mod";
export {
  type DamageReduction,
  DamageReductionAbAttr,
  type DamageReductionFilter,
  type DamageReductionOptions,
} from "./damage-reduction-generic";
export { EffectChanceModifierAbAttr, type EffectChanceModifierOptions } from "./effect-chance-modifier";
export type { EntryEffect, EntryEffectKind } from "./entry-effect";
export {
  EntryEffectAbAttr,
  type EntryEffectAddSelfType,
  type EntryEffectFirstMovePriority,
  type EntryEffectScriptedMove,
  type EntryEffectSelfStatBoost,
  type EntryEffectSetHazard,
  type EntryEffectSetScreenOrRoom,
  type EntryEffectSetTerrain,
  type EntryEffectSetWeather,
} from "./entry-effect";
export { FlagDamageBoostAbAttr, type FlagDamageBoostAbAttrOptions } from "./flag-damage-boost";
export {
  type HitMultiplier,
  HitMultiplierAbAttr,
  type HitMultiplierFilter,
  type HitMultiplierOptions,
  HitMultiplierPowerAbAttr,
  type HitMultiplierPowerOptions,
} from "./hit-multiplier";
export {
  TypeAbsorbHealAbAttr,
  type TypeAbsorbHealOptions,
  TypeAbsorbStatBoostAbAttr,
  type TypeAbsorbStatBoostOptions,
} from "./immunity-with-absorb";
export {
  type Lifesteal,
  type LifestealFilter,
  LifestealOnHitAbAttr,
  type LifestealOnHitOptions,
  LifestealOnKoAbAttr,
  type LifestealOnKoOptions,
} from "./lifesteal";
export {
  type MoveReplacement,
  MovesetReplacementAbAttr,
  type MovesetReplacementOptions,
  MoveTypeReplacementAbAttr,
  type MoveTypeReplacementOptions,
} from "./move-replacement";
export {
  type OnFaintEffect,
  OnFaintEffectAbAttr,
  type OnFaintEffectAttackerDamageFlat,
  type OnFaintEffectKind,
  type OnFaintEffectOptions,
  type OnFaintEffectSetHazard,
  type OnFaintEffectSetTerrain,
  type OnFaintEffectSetWeather,
} from "./on-faint-effect";
export {
  type PassiveRecovery,
  PassiveRecoveryAbAttr,
  type PassiveRecoveryCondition,
  type PassiveRecoveryOptions,
} from "./passive-recovery";
export {
  PreFaintReviveAbAttr,
  type PreFaintReviveGate,
  type PreFaintReviveOptions,
  type PreFaintReviveUsage,
} from "./pre-faint-revive";
export {
  type PriorityCondition,
  PriorityModifierAbAttr,
  type PriorityModifierFilter,
  type PriorityModifierOptions,
} from "./priority-modifier";
export { type StabAdd, StabAddAbAttr, type StabAddOptions } from "./stab-add";
export {
  StatStageChangeModifierAbAttr,
  type StatStageChangeModifierOptions,
} from "./stat-stage-change-modifier";
export {
  type OnHitFilter,
  type StatChange,
  type StatTriggerEvent,
  StatTriggerOnEntryAbAttr,
  type StatTriggerOnEventAbAttr,
  StatTriggerOnHitAbAttr,
  type StatTriggerOnHitPayload,
  StatTriggerOnKoAbAttr,
  StatTriggerOnStatLoweredAbAttr,
  type StatTriggerPayload,
} from "./stat-trigger-on-event";
export {
  BattlerTagImmunityAbAttrEr,
  type BattlerTagImmunityOptions,
  IntimidateImmunityAbAttrEr,
  StatusEffectImmunityAbAttrEr,
  type StatusEffectImmunityOptions,
  type StatusImmunity,
} from "./status-immunity";
export {
  type TypeConversion,
  TypeConversionAbAttr,
  type TypeConversionOptions,
  TypeConversionPowerBoostAbAttr,
  type TypeConversionPowerBoostOptions,
  type TypeConversionSource,
} from "./type-conversion";
export { TypeDamageBoostAbAttr, type TypeDamageBoostAbAttrOptions } from "./type-damage-boost";
export {
  buildTypeEffectivenessModAttrs,
  OffensiveTypeMultiplierAbAttr,
  type TypeEffectivenessMod,
  type TypeEffectivenessModOptions,
} from "./type-effectiveness-mod";
export {
  WeatherStatMultiplierAbAttr,
  type WeatherStatMultiplierOptions,
} from "./weather-stat-multiplier";
export {
  SetTerrainOnEntryAbAttr,
  type SetTerrainOnEntryOptions,
  SetWeatherOnEntryAbAttr,
  type SetWeatherOnEntryOptions,
  WeatherDamageReductionAbAttr,
  type WeatherDamageReductionOptions,
  type WeatherTerrainInteraction,
  WeatherTypeBoostAbAttr,
  type WeatherTypeBoostOptions,
} from "./weather-terrain-interaction";
// =============================================================================
// New primitives (round-30+ batch) for remaining bespoke ability wires.
// =============================================================================
export { BstConditionalAllyAuraAbAttr, type BstConditionalAllyAuraOptions } from "./bst-conditional-ally-aura";
export { ContactQuashAbAttr, type ContactQuashOptions } from "./contact-quash";
export { DamageCapOnResistAbAttr } from "./damage-cap-on-resist";
export { DefenseStatSwapOnStatusedFoeAbAttr } from "./defense-stat-swap-on-statused-foe";
export { FieldStatShareAbAttr } from "./field-stat-share";
export {
  FoeStrongestStatSelfBoostAbAttr,
  type FoeStrongestStatSelfBoostOptions,
} from "./foe-strongest-stat-self-boost";
export { OnCritStatBoostLowestAbAttr, type OnCritStatBoostLowestOptions } from "./on-crit-stat-boost-lowest";
export {
  OneShotTypeBoostAbAttr,
  OneShotTypeBoostFollowupAbAttr,
  type OneShotTypeBoostOptions,
} from "./one-shot-type-boost-then-lose-type";
export {
  OutgoingStatDropMultiplierAbAttr,
  type OutgoingStatDropMultiplierOptions,
} from "./outgoing-stat-drop-multiplier";
export {
  PostDefendChangeAttackerTypeAbAttr,
  type PostDefendChangeAttackerTypeOptions,
} from "./post-defend-change-attacker-type";
export { PostDefendSuppressOpponentDamageBoostAbAttr } from "./post-defend-suppress-opponent-damage-boost";
export { PostFaintReviveAbAttr, type PostFaintReviveOptions } from "./post-faint-revive";
export { PostSummonClearTerrainAbAttr, type PostSummonClearTerrainOptions } from "./post-summon-clear-terrain";
export { PostSummonQuashFoesAbAttr, type PostSummonQuashFoesOptions } from "./post-summon-quash-foes";
export {
  PostSummonStackSetEffectsAbAttr,
  type PostSummonStackSetEffectsOptions,
} from "./post-summon-stack-set-effects";
export { PostTurnFoeStatDropAbAttr, type PostTurnFoeStatDropOptions } from "./post-turn-foe-stat-drop";
export { PostVictoryClearTagAbAttr, type PostVictoryClearTagOptions } from "./post-victory-clear-tag";
export { PreSwitchOutItemRestoreAbAttr } from "./pre-switch-out-item-restore";
export { RepeatMovePowerBoostAbAttr, type RepeatMovePowerBoostOptions } from "./repeat-move-power-boost";
export { SePriorityBonusAbAttr, type SePriorityBonusOptions } from "./se-priority-bonus";
export { SkipChargeTurnAbAttr } from "./skip-charge-turn";
export { StabSuppressAuraAbAttr } from "./stab-suppress-aura";
export { StatusCascadeAbAttr, type StatusCascadeChange, type StatusCascadeOptions } from "./status-cascade";
export {
  SuperEffectiveMultiplierBoostAbAttr,
  type SuperEffectiveMultiplierBoostOptions,
} from "./super-effective-multiplier-boost";
export {
  SuppressAttackerAbilityAbAttr,
  type SuppressAttackerAbilityOptions,
} from "./suppress-attacker-ability";
export {
  TargetHighestStatDropAbAttr,
  type TargetHighestStatDropOptions,
  type TargetHighestStatDropRule,
} from "./target-highest-stat-drop";
export {
  TimeLimitedDamageReductionAbAttr,
  type TimeLimitedDamageReductionOptions,
} from "./time-limited-damage-reduction";
export { TrapDurationModifierAbAttr, type TrapDurationModifierOptions } from "./trap-duration-modifier";
export {
  TurnDecayDamageMultiplierAbAttr,
  type TurnDecayDamageMultiplierOptions,
} from "./turn-decay-damage-multiplier";
export {
  TypeChartOverrideAbAttr,
  type TypeChartOverrideOptions,
  type TypeChartOverrideRule,
} from "./type-chart-override";
export {
  TypeGatedStatTriggerOnAttackAbAttr,
  type TypeGatedStatTriggerOnAttackOptions,
} from "./type-gated-stat-trigger-on-attack";
export {
  TypedImmunityWithArenaTagAbAttr,
  type TypedImmunityWithArenaTagOptions,
} from "./typed-immunity-with-arena-tag";
export { UserFieldFlagImmunityAbAttr, type UserFieldFlagImmunityOptions } from "./user-field-flag-immunity";
export { WeatherBasedMoveBlockAbAttr } from "./weather-based-move-block";
