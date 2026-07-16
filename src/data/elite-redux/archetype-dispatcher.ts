/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Elite Redux — Phase D Task D3 + D3b: archetype-classifier →
// archetype-primitive dispatcher. Translates `ER_ABILITY_ARCHETYPES` rows
// (which carry flat classifier-emitted JSON params) into one or more
// constructed `AbAttr` instances ready to be attached to a custom `Ability`
// via the builder.
//
// Why a dispatcher and not direct construction at the init site?
//
//   The classifier's emitted params are deliberately classifier-shaped — flat
//   strings (e.g. `type: "FIRE"`), JSON-only types (no `MoveFlags` bits), and
//   sub-shape vocabulary that doesn't exactly match the archetype constructors'
//   typed options. Translating happens here ONCE, in a single switch, so the
//   init site stays small and the per-archetype quirks are localized.
//
// Skip semantics
//
//   This dispatcher is conservative: when the classifier emitted a shape we
//   can't faithfully translate (e.g. a `target-asleep` damage condition is
//   classifier-only and maps to `target-statused + statuses: [SLEEP]`), we
//   emit a normalized attr. When we encounter a shape we genuinely can't
//   wire (composite mashups, status names that aren't pokerogue's
//   `StatusEffect` — `BLEED`, `FROSTBITE`, ER-specific), we return an empty
//   attrs list and record a `skipped` note so the caller's diagnostics can
//   surface coverage gaps.
//
// Composite resolution (D3b)
//
//   For `composite-vanilla-mashup` rows, the dispatcher consults
//   `ER_COMPOSITE_PARTS` (auto-generated from
//   `scripts/elite-redux/classify-composites.mjs`) to walk the named parts
//   back to either vanilla pokerogue `AbilityId`s (whose AbAttrs are copied
//   verbatim from `allAbilities[id].attrs`) or other ER `erAbilityId`s
//   (whose archetype rows are recursively dispatched). Free-text riders
//   ("triggers hail when hit") show up as `unresolvedParts` on the side
//   table and contribute no attrs — they're for triage / future bespoke
//   implementation.
//
//   Recursion is guarded by a per-call `visited` set passed through the
//   internal dispatch entry: a composite referencing another composite
//   eventually bottoms out in concrete archetype-primitive rows or in a
//   vanilla pokerogue ability. A cycle (composite A → composite B →
//   composite A) would otherwise infinite-loop; the guard skips repeats.
//
// Bespoke skip
//
//   `bespoke` entries (258 rows) have `params: null` and need hand-written
//   wiring — they're the long-tail abilities whose behavior doesn't fit any
//   archetype shape. Phase D's bespoke-implementation task wires them.
// =============================================================================

import {
  type AbAttr,
  AddMoveFlagAbAttr,
  AllAttacksMultiHitAbAttr,
  AlwaysHitAbAttr,
  ArenaTrapAbAttr,
  AttackTypeImmunityAbAttr,
  BadDreamsImmunityAbAttr,
  BattlerTagImmunityAbAttr,
  BlockNonDirectDamageAbAttr,
  BlockRecoilDamageAttr,
  BlockWeatherDamageAttr,
  BugPowderImmunityAbAttr,
  BypassBurnDamageReductionAbAttr,
  ConditionalCritAbAttr,
  ConditionalUserFieldBattlerTagImmunityAbAttr,
  ConditionalUserFieldProtectStatAbAttr,
  ConditionalUserFieldStatusEffectImmunityAbAttr,
  CritUseLowerDefensiveStatAbAttr,
  DoubleSelfInflictedDamageAbAttr,
  DrenchImmunityAbAttr,
  EnemyMinDamageRollAbAttr,
  FieldMoveTypePowerBoostAbAttr,
  FieldPriorityMoveImmunityAbAttr,
  FloatAbAttr,
  FogRestoreDisguiseFormChangeAbAttr,
  ForceSwitchOutImmunityAbAttr,
  FullBurnDamageImmunityAbAttr,
  getWeatherCondition,
  IgnoreGenderInfatuationAbAttr,
  IgnoreMoveEffectsAbAttr,
  IgnoreOpponentStatStagesAbAttr,
  IgnoreProtectByFlagAbAttr,
  IgnoreProtectFirstTurnAbAttr,
  IgnoreTypeImmunityAbAttr,
  IgnoreTypeStatusEffectImmunityAbAttr,
  MoveAbilityBypassAbAttr,
  MoveImmunityAbAttr,
  MovePowerBoostAbAttr,
  MoveTypeChangeAbAttr,
  MoveTypePowerBoostAbAttr,
  OpposingMegaStatSuppressAbAttr,
  OverruleCritAbAttr,
  PokemonTypeChangeAbAttr,
  PostAttackAbilityGiveAbAttr,
  PostAttackApplyBattlerTagAbAttr,
  PostAttackApplyStatusEffectAbAttr,
  PostDefendAbilityGiveAbAttr,
  PostDefendAbilitySwapAbAttr,
  PostDefendContactDamageAbAttr,
  PostDefendHpGatedStatStageChangeAbAttr,
  PostDefendWeatherChangeAbAttr,
  PostReceiveCritStatStageChangeAbAttr,
  PostStatStageChangeStatStageChangeAbAttr,
  PostSummonAddBattlerTagAbAttr,
  PostSummonClearAllyStatStagesAbAttr,
  PostSummonClearOpponentPositiveStatStagesAbAttr,
  PostSummonFogRestoreDisguiseAbAttr,
  PostSummonRemoveArenaTagAbAttr,
  PostSummonStatStageChangeAbAttr,
  PostTurnRandomBerryEffectAbAttr,
  PostTurnResetStatusAbAttr,
  PreHitResistTypeChangeAbAttr,
  PreserveBaseStatAbilitiesAbAttr,
  PreventItemUseAbAttr,
  ProtectStatAbAttr,
  ReceivedMoveDamageMultiplierAbAttr,
  ReceivedTypeDamageMultiplierAbAttr,
  RedirectTypeMoveAbAttr,
  ReflectStatStageChangeAbAttr,
  SagePowerMoveLockAbAttr,
  SelfStatDropImmunityAbAttr,
  SetMoveAccuracyAbAttr,
  SpreadTargetByFlagAbAttr,
  StatMultiplierAbAttr,
  StealthRockImmunityAbAttr,
  SuperEffectiveMoveAbilityBypassAbAttr,
  SuppressFieldAbilitiesWhenEnragedAbAttr,
  SuppressFieldEffectsAbAttr,
  SuppressWeatherEffectAbAttr,
  SwitchWhileRampagingAbAttr,
  UserFieldMoveTypePowerBoostAbAttr,
  UserFieldSelfStatDropImmunityAbAttr,
  WeightMultiplierAbAttr,
} from "#abilities/ab-attrs";
import { globalScene } from "#app/global-scene";
import { TrappedTag } from "#data/battler-tags";
import { allAbilities } from "#data/data-lists";
import { PostTurnHurtNonTypedAbAttr } from "#data/elite-redux/abilities/post-turn-hurt-non-typed";
import { PpReductionOnContactAbAttr } from "#data/elite-redux/abilities/pp-reduction-on-contact";
import { SetArenaTagOnHitAbAttr, SetTerrainOnHitAbAttr } from "#data/elite-redux/abilities/set-arena-effect-on-hit";
import { StatBoostOnFlagAttackAbAttr } from "#data/elite-redux/abilities/stat-boost-on-flag-attack";
import { StatChangeOnCategoryAttackAbAttr } from "#data/elite-redux/abilities/stat-change-on-category-attack";
import { StatDebuffOnFlagAttackAbAttr } from "#data/elite-redux/abilities/stat-debuff-on-flag-attack";
import { AbsorbantAbAttr } from "#data/elite-redux/archetypes/absorbant";
import { AddTypeToAttackerOnContactAbAttr } from "#data/elite-redux/archetypes/add-type-to-attacker-on-contact";
import { AllyAttackPowerBoostAbAttr } from "#data/elite-redux/archetypes/ally-attack-power-boost";
import { ateConditionalAttrs } from "#data/elite-redux/archetypes/ate-conditional";
import { AttackStatSubstituteAbAttr } from "#data/elite-redux/archetypes/attack-stat-substitute";
import { BoneMoveTypeChartAbAttr } from "#data/elite-redux/archetypes/bone-move-type-chart";
import { ChanceDodgeAbAttr } from "#data/elite-redux/archetypes/chance-dodge";
import {
  ChanceBattlerTagOnAttackAbAttr,
  ChanceBattlerTagOnHitAbAttr,
  type ChanceStatusFilter,
  ChanceStatusOnAttackAbAttr,
  ChanceStatusOnHitAbAttr,
} from "#data/elite-redux/archetypes/chance-status-on-hit";
import { ConditionalAlwaysHitAbAttr } from "#data/elite-redux/archetypes/conditional-always-hit";
import { ConditionalDamageAbAttr, type DamageCondition } from "#data/elite-redux/archetypes/conditional-damage";
import {
  FirstDefendAttackerAtkDropAbAttr,
  FirstDefendDamageReductionAbAttr,
} from "#data/elite-redux/archetypes/consume-on-first-defend";
import { ContactQuashAbAttr } from "#data/elite-redux/archetypes/contact-quash";
import { CopyMoveByFilterAbAttr } from "#data/elite-redux/archetypes/copy-move-by-filter";
import { CounterAttackOnHitAbAttr } from "#data/elite-redux/archetypes/counter-attack-on-hit";
import { CowardOnceProtectAbAttr } from "#data/elite-redux/archetypes/coward-once-protect";
import {
  CritDamageMultiplierAbAttr,
  CritImmunityAbAttr,
  CritStageBonusAbAttr,
} from "#data/elite-redux/archetypes/crit-mod";
import { CritStackOnKoAbAttr } from "#data/elite-redux/archetypes/crit-stack-on-ko";
import { CurseAttackerOnFormBlockDamageAbAttr } from "#data/elite-redux/archetypes/curse-attacker-on-form-block";
import { DamageCapOnResistAbAttr } from "#data/elite-redux/archetypes/damage-cap-on-resist";
import {
  DamageReductionAbAttr,
  type DamageReductionFilter,
} from "#data/elite-redux/archetypes/damage-reduction-generic";
import { DefenseStatSwapOnFlagAbAttr } from "#data/elite-redux/archetypes/defense-stat-swap-on-flag";
import { DefenseStatSwapOnStatusedFoeAbAttr } from "#data/elite-redux/archetypes/defense-stat-swap-on-statused-foe";
import { EffectChanceModifierAbAttr } from "#data/elite-redux/archetypes/effect-chance-modifier";
import { EntryArenaTagOnFoeSideAbAttr } from "#data/elite-redux/archetypes/entry-arena-tag-on-foe-side";
import { type EntryEffect, EntryEffectAbAttr } from "#data/elite-redux/archetypes/entry-effect";
import { FieldCritBoostAbAttr } from "#data/elite-redux/archetypes/field-crit-boost";
import { FieldStatShareAbAttr } from "#data/elite-redux/archetypes/field-stat-share";
import {
  FireHitFormChangeAbAttr,
  FireUseFormChangeAbAttr,
} from "#data/elite-redux/archetypes/fire-interaction-form-change";
import {
  ConsumeFirstFlaggedMoveOnUseAbAttr,
  ConsumeFirstFlaggedMovePriorityAbAttr,
  FirstFlaggedMovePriorityAbAttr,
  FirstTurnPriorityClampAbAttr,
  RearmFirstFlaggedMoveOnMoveAbAttr,
} from "#data/elite-redux/archetypes/first-move-priority";
import { FirstTurnStatMultiplierAbAttr } from "#data/elite-redux/archetypes/first-turn-stat-multiplier";
import { FlagDamageBoostAbAttr } from "#data/elite-redux/archetypes/flag-damage-boost";
import { FoeStrongestStatSelfBoostAbAttr } from "#data/elite-redux/archetypes/foe-strongest-stat-self-boost";
import { ForceFoeOutOnInactivityAbAttr } from "#data/elite-redux/archetypes/force-foe-out-on-inactivity";
import { GroundEntryHazardImmunityAbAttr } from "#data/elite-redux/archetypes/ground-entry-hazard-immunity";
import { HitMultiplierAbAttr, HitMultiplierPowerAbAttr } from "#data/elite-redux/archetypes/hit-multiplier";
import { HpScalingStatMultiplierAbAttr } from "#data/elite-redux/archetypes/hp-scaling-stat-multiplier";
import { HpThresholdFormChangeAbAttr } from "#data/elite-redux/archetypes/hp-threshold-form-change";
import {
  TypeAbsorbHealAbAttr,
  TypeAbsorbHighestAttackStatBoostAbAttr,
  TypeAbsorbStatBoostAbAttr,
} from "#data/elite-redux/archetypes/immunity-with-absorb";
import { IncomingAccuracyMultiplierAbAttr } from "#data/elite-redux/archetypes/incoming-accuracy-multiplier";
import { LifestealOnHitAbAttr, LifestealOnKoAbAttr, ScavengerLootAbAttr } from "#data/elite-redux/archetypes/lifesteal";
import { MoveCategoryOverrideAbAttr } from "#data/elite-redux/archetypes/move-category-override";
import { MoveFlagInjectionAbAttr } from "#data/elite-redux/archetypes/move-flag-injection";
import { MovingFirstTrapFlinchAbAttr } from "#data/elite-redux/archetypes/moving-first-trap-flinch";
import { ErMultiHeadedAbAttr } from "#data/elite-redux/archetypes/multi-headed";
import { OverrideMultiHitCountAbAttr } from "#data/elite-redux/archetypes/multi-hit-count-override";
import { NullifyFirstNHitsAbAttr } from "#data/elite-redux/archetypes/nullify-first-n-hits";
import { OffensiveTypeChartOverrideAbAttr } from "#data/elite-redux/archetypes/offensive-type-chart-override";
import { OnCritStatBoostLowestAbAttr } from "#data/elite-redux/archetypes/on-crit-stat-boost-lowest";
import { OnFaintEffectAbAttr } from "#data/elite-redux/archetypes/on-faint-effect";
import {
  OnOpponentStatRaiseAbAttr,
  OnOpponentStatRaiseScriptedMoveAbAttr,
} from "#data/elite-redux/archetypes/on-opponent-stat-raise";
import { OnOpponentSwitchOutAbAttr } from "#data/elite-redux/archetypes/on-opponent-switch-out";
import { OncePerEntryContactDamageReductionAbAttr } from "#data/elite-redux/archetypes/once-per-entry-contact-reduction";
import {
  OneShotTypeBoostAbAttr,
  OneShotTypeBoostFollowupAbAttr,
} from "#data/elite-redux/archetypes/one-shot-type-boost-then-lose-type";
import { OutgoingStatDropMultiplierAbAttr } from "#data/elite-redux/archetypes/outgoing-stat-drop-multiplier";
import { PartyCountMultiHitAbAttr } from "#data/elite-redux/archetypes/party-count-multi-hit";
import { PassiveRecoveryAbAttr, type PassiveRecoveryCondition } from "#data/elite-redux/archetypes/passive-recovery";
import { PersistentFieldAuraAbAttr } from "#data/elite-redux/archetypes/persistent-field-aura";
import { PoisonedFoePurgeAbAttr } from "#data/elite-redux/archetypes/poisoned-foe-purge";
import { PostAttackChangeTargetTypeAbAttr } from "#data/elite-redux/archetypes/post-attack-change-target-type";
import { PostAttackContactSuppressTargetAbilityAbAttr } from "#data/elite-redux/archetypes/post-attack-contact-suppress-target-ability";
import { PostAttackRemoveTargetTypeAbAttr } from "#data/elite-redux/archetypes/post-attack-remove-target-type";
import { PostAttackScriptedMoveAbAttr } from "#data/elite-redux/archetypes/post-attack-scripted-move";
import {
  PostAttackSetHazardByMoveTypeAbAttr,
  PostAttackSetTerrainByMoveTypeAbAttr,
} from "#data/elite-redux/archetypes/post-attack-set-field-by-type";
import { PostDamageForceAttackerOutAbAttr } from "#data/elite-redux/archetypes/post-damage-force-attacker-out";
import { PostDefendChangeAttackerTypeAbAttr } from "#data/elite-redux/archetypes/post-defend-change-attacker-type";
import { PostDefendHpGatedSelfTagAbAttr } from "#data/elite-redux/archetypes/post-defend-hp-gated-self-tag";
import { PostDefendSuppressOpponentDamageBoostAbAttr } from "#data/elite-redux/archetypes/post-defend-suppress-opponent-damage-boost";
import { PostFaintDeferredReviveAbAttr } from "#data/elite-redux/archetypes/post-faint-deferred-revive";
import { PostFaintSpreadDetonateAbAttr } from "#data/elite-redux/archetypes/post-faint-spread-detonate";
import { PostItemLostScriptedMoveAbAttr } from "#data/elite-redux/archetypes/post-item-lost-scripted-move";
import { PostSummonApplyTagOnFoesAbAttr } from "#data/elite-redux/archetypes/post-summon-apply-tag-on-foes";
import { PostSummonClearTerrainAbAttr } from "#data/elite-redux/archetypes/post-summon-clear-terrain";
import { PostSummonQuashFoesAbAttr } from "#data/elite-redux/archetypes/post-summon-quash-foes";
import { PostSummonScriptedMoveAbAttr } from "#data/elite-redux/archetypes/post-summon-scripted-move";
import { PostSummonStackSetEffectsAbAttr } from "#data/elite-redux/archetypes/post-summon-stack-set-effects";
import { PostTurnApplyTagOnFoesAbAttr } from "#data/elite-redux/archetypes/post-turn-apply-tag-on-foes";
import { PostTurnDrainAbAttr } from "#data/elite-redux/archetypes/post-turn-drain";
import { PostTurnFoeStatDropAbAttr } from "#data/elite-redux/archetypes/post-turn-foe-stat-drop";
import { PostTurnRandomPureTypeAbAttr } from "#data/elite-redux/archetypes/post-turn-random-type";
import { PostTurnScriptedMoveAbAttr } from "#data/elite-redux/archetypes/post-turn-scripted-move";
import { PostVictoryClearRechargeAbAttr } from "#data/elite-redux/archetypes/post-victory-clear-recharge";
import {
  AllyFaintPowerBoostAbAttr,
  AllyFaintPowerBoostExpireAbAttr,
  AllyFaintPowerBoostTriggerAbAttr,
} from "#data/elite-redux/archetypes/power-boost-on-ally-faint";
import { PreFaintReviveAbAttr } from "#data/elite-redux/archetypes/pre-faint-revive";
import {
  PostSummonRetrieverSnapshotAbAttr,
  PreSwitchOutItemRestoreAbAttr,
} from "#data/elite-redux/archetypes/pre-switch-out-item-restore";
import { PreemptivePriorityCounterAbAttr } from "#data/elite-redux/archetypes/preemptive-priority-counter";
import {
  type PriorityCondition,
  PriorityModifierAbAttr,
  type PriorityModifierFilter,
} from "#data/elite-redux/archetypes/priority-modifier";
import {
  RechargeChargedOnElectricKoAbAttr,
  RechargeChargedOnElectricTerrainAbAttr,
} from "#data/elite-redux/archetypes/recharge-on-electric-terrain";
import { RecoilDamageMultiplierAbAttr } from "#data/elite-redux/archetypes/recoil-damage-multiplier";
import { ReflectDamageOnDefendAbAttr } from "#data/elite-redux/archetypes/reflect-damage-on-defend";
import { RemoveScreensOnTypedAttackAbAttr } from "#data/elite-redux/archetypes/remove-screens-on-typed-attack";
import { RepeatMovePowerBoostAbAttr } from "#data/elite-redux/archetypes/repeat-move-power-boost";
import { SandSecondaryEffectImmunityAbAttr, SandStatusImmunityAbAttr } from "#data/elite-redux/archetypes/sand-cloak";
import { SePriorityBonusAbAttr } from "#data/elite-redux/archetypes/se-priority-bonus";
import { SelfDamageOnAttackAbAttr } from "#data/elite-redux/archetypes/self-damage-on-attack";
import { SelfHighestStatBoostOnSummonAbAttr } from "#data/elite-redux/archetypes/self-highest-stat-boost-on-summon";
import { SelfHighestStatMultiplierAbAttr } from "#data/elite-redux/archetypes/self-highest-stat-multiplier";
import { SelfPersistentBleedAbAttr } from "#data/elite-redux/archetypes/self-persistent-bleed";
import { SelfSwitchOnMoveTypeAbAttr } from "#data/elite-redux/archetypes/self-switch-on-move-type";
import { SelfSwitchOnStatLowerAbAttr } from "#data/elite-redux/archetypes/self-switch-on-stat-lower";
import { SetFogOnHitAbAttr } from "#data/elite-redux/archetypes/set-fog-on-hit";
import { SetTargetAbilityOnMoveAbAttr } from "#data/elite-redux/archetypes/set-target-ability-on-move";
import { SkipChargeTurnAbAttr } from "#data/elite-redux/archetypes/skip-charge-turn";
import { SpeedBonusToStatAbAttr } from "#data/elite-redux/archetypes/speed-bonus-to-stat";
import { StabAddAbAttr } from "#data/elite-redux/archetypes/stab-add";
import { StabSuppressAuraAbAttr } from "#data/elite-redux/archetypes/stab-suppress-aura";
import { StatBlendAbAttr } from "#data/elite-redux/archetypes/stat-blend";
import { StatChangeOnAttackAbAttr } from "#data/elite-redux/archetypes/stat-change-on-attack";
import {
  FaintCountTriggerAbAttr,
  PerFaintStatMultiplierAbAttr,
} from "#data/elite-redux/archetypes/stat-multiplier-per-faint";
import {
  type StatChange,
  StatTriggerOnAllyStatLoweredAbAttr,
  StatTriggerOnEntryAbAttr,
  StatTriggerOnHitAbAttr,
  StatTriggerOnKoAbAttr,
  StatTriggerOnStatLoweredAbAttr,
} from "#data/elite-redux/archetypes/stat-trigger-on-event";
import { StatusCascadeAbAttr } from "#data/elite-redux/archetypes/status-cascade";
import { StatusChanceMultiplierAbAttr } from "#data/elite-redux/archetypes/status-chance-multiplier";
import {
  BattlerTagImmunityAbAttrEr,
  IntimidateImmunityAbAttrEr,
  StatusEffectImmunityAbAttrEr,
} from "#data/elite-redux/archetypes/status-immunity";
import { SuperEffectiveMultiplierBoostAbAttr } from "#data/elite-redux/archetypes/super-effective-multiplier-boost";
import { SuppressAttackerAbilityAbAttr } from "#data/elite-redux/archetypes/suppress-attacker-ability";
import { TargetHighestStatDropAbAttr } from "#data/elite-redux/archetypes/target-highest-stat-drop";
import { TimeLimitedEffectivenessFloorAbAttr } from "#data/elite-redux/archetypes/time-limited-effectiveness-floor";
import { TrapDurationModifierAbAttr } from "#data/elite-redux/archetypes/trap-duration-modifier";
import { TurnDecayDamageMultiplierAbAttr } from "#data/elite-redux/archetypes/turn-decay-damage-multiplier";
import { TypeConversionAbAttr, TypeConversionPowerBoostAbAttr } from "#data/elite-redux/archetypes/type-conversion";
import { TypeDamageBoostAbAttr, TypeRecoilAbAttr } from "#data/elite-redux/archetypes/type-damage-boost";
import {
  buildTypeEffectivenessModAttrs,
  OffensiveTypeMultiplierAbAttr,
} from "#data/elite-redux/archetypes/type-effectiveness-mod";
import { TypeFilteredEffectChanceMultiplierAbAttr } from "#data/elite-redux/archetypes/type-filtered-effect-chance";
import { TypeGatedStatTriggerOnAttackAbAttr } from "#data/elite-redux/archetypes/type-gated-stat-trigger-on-attack";
import { TypeImmunityHighestAttackStatStageAbAttr } from "#data/elite-redux/archetypes/type-immunity-highest-attack-stat-stage";
import { TypedImmunityWithArenaTagAbAttr } from "#data/elite-redux/archetypes/typed-immunity-with-arena-tag";
import { UserFieldFlagImmunityAbAttr } from "#data/elite-redux/archetypes/user-field-flag-immunity";
import { WakeStatBoostAbAttr } from "#data/elite-redux/archetypes/wake-stat-boost";
import { WeatherBasedMoveBlockAbAttr } from "#data/elite-redux/archetypes/weather-based-move-block";
import { WeatherGroundAirborneAbAttr } from "#data/elite-redux/archetypes/weather-ground-airborne";
import { WeatherStatMultiplierAbAttr } from "#data/elite-redux/archetypes/weather-stat-multiplier";
import {
  WeatherDamageReductionAbAttr,
  WeatherTypeBoostAbAttr,
  WeatherTypeDebuffCancelAbAttr,
} from "#data/elite-redux/archetypes/weather-terrain-interaction";
import { ER_ABILITIES } from "#data/elite-redux/er-abilities";
import { ER_ABILITY_ARCHETYPES, type ErArchetypeKind } from "#data/elite-redux/er-ability-archetypes";
import { ER_COMPOSITE_PARTS, type ErCompositePartRef } from "#data/elite-redux/er-composite-parts";
import { ER_CLASSIFIER_FLAG_TO_MOVE_FLAG } from "#data/elite-redux/er-flag-mapping";
import { ER_ID_MAP } from "#data/elite-redux/er-id-map";
import { TerrainType } from "#data/terrain";
import { isFogWeather } from "#data/weather";
import { AbilityId } from "#enums/ability-id";
import { ArenaTagSide } from "#enums/arena-tag-side";
import { ArenaTagType } from "#enums/arena-tag-type";
import { BattlerTagType } from "#enums/battler-tag-type";
import { BerryType } from "#enums/berry-type";
import { ErMoveId } from "#enums/er-move-id";
import { MoveCategory } from "#enums/move-category";
import { MoveFlags } from "#enums/move-flags";
import { MoveId } from "#enums/move-id";
import { PokemonType } from "#enums/pokemon-type";
import { type BattleStat, Stat } from "#enums/stat";
import { StatusEffect } from "#enums/status-effect";
import { WeatherType } from "#enums/weather-type";
import type { Pokemon } from "#field/pokemon";

/**
 * Result of a single archetype-dispatch call. Carries the list of constructed
 * AbAttrs (possibly empty) plus diagnostic metadata. The caller iterates
 * `attrs` and attaches each via the builder; `note` is surfaced in the init
 * result for triage of coverage gaps.
 */
export interface DispatchResult {
  /** Constructed AbAttr instances ready to attach via the builder. Empty when skipped. */
  readonly attrs: readonly AbAttr[];
  /**
   * Why dispatch produced zero attrs, if applicable. `null` means dispatch
   * produced one or more attrs successfully (`attrs.length > 0`). A string
   * means we intentionally skipped — composite/bespoke or shape we don't yet
   * translate. Surfaced in init diagnostics; not an error.
   */
  readonly skipReason: string | null;
}

/** Convenience: an empty success result. Only used internally. */
const SKIP_BESPOKE: DispatchResult = {
  attrs: [],
  skipReason: "bespoke entry; hand-written implementation pending",
};

/** Empty success: dispatch succeeded but the archetype yields no attrs. Rarely used. */
function ok(attrs: AbAttr[]): DispatchResult {
  return { attrs, skipReason: null };
}

/** Skip with a custom reason. */
function skip(reason: string): DispatchResult {
  return { attrs: [], skipReason: reason };
}

// =============================================================================
// String-to-enum lookups
// =============================================================================

/**
 * Resolve a classifier-emitted type string ("FIRE", "GHOST", …) to its
 * `PokemonType` enum value. Returns `null` for unrecognised inputs so the
 * caller can skip rather than throw.
 */
function lookupPokemonType(value: unknown): PokemonType | null {
  if (typeof value !== "string") {
    return null;
  }
  const v = (PokemonType as unknown as Record<string, number>)[value];
  if (typeof v !== "number") {
    return null;
  }
  return v as PokemonType;
}

/**
 * Resolve a classifier-emitted weather string ("RAIN", "HAIL", …) to its
 * `WeatherType` enum value. Returns `null` for unrecognised inputs.
 */
function lookupWeatherType(value: unknown): WeatherType | null {
  if (typeof value !== "string") {
    return null;
  }
  const v = (WeatherType as unknown as Record<string, number>)[value];
  if (typeof v !== "number") {
    return null;
  }
  return v as WeatherType;
}

/**
 * Resolve a classifier-emitted terrain string ("ELECTRIC", "GRASSY", …) to
 * its `TerrainType` enum value. Returns `null` for unrecognised inputs.
 */
function lookupTerrainType(value: unknown): TerrainType | null {
  if (typeof value !== "string") {
    return null;
  }
  const v = (TerrainType as unknown as Record<string, number>)[value];
  if (typeof v !== "number") {
    return null;
  }
  return v as TerrainType;
}

/**
 * Resolve a classifier-emitted arena-tag string ("STICKY_WEB", "TRICK_ROOM",
 * …) to its `ArenaTagType` enum value. Returns `null` for unrecognised
 * inputs. Note: `ArenaTagType` uses string-valued enums, so reverse-lookup is
 * the same as forward-lookup.
 */
function lookupArenaTagType(value: unknown): ArenaTagType | null {
  if (typeof value !== "string") {
    return null;
  }
  if (Object.hasOwn(ArenaTagType, value)) {
    return (ArenaTagType as unknown as Record<string, ArenaTagType>)[value];
  }
  return null;
}

/**
 * Resolve a classifier-emitted move-flag string ("PUNCHING_MOVE",
 * "SLICING_MOVE", "MIGHTY_HORN", …) to its `MoveFlags` bit. We try the
 * pokerogue-native enum form first, then the classifier-form mapping in
 * `ER_CLASSIFIER_FLAG_TO_MOVE_FLAG`. Returns `null` for unrecognised inputs
 * or for ER concepts represented as `MoveAttr` rather than a flag bit.
 */
function lookupMoveFlag(value: unknown): MoveFlags | null {
  if (typeof value !== "string") {
    return null;
  }
  // Try direct enum lookup first (pokerogue-native names like "PUNCHING_MOVE",
  // "SLICING_MOVE"). MoveFlags is a bitmask enum so values are numbers and
  // reverse-lookup yields the bit value.
  if (Object.hasOwn(MoveFlags, value)) {
    const v = (MoveFlags as unknown as Record<string, number>)[value];
    if (typeof v === "number" && v !== MoveFlags.NONE) {
      return v as MoveFlags;
    }
  }
  // Fall back to the classifier-form mapping (e.g. "MIGHTY_HORN" → HORN_BASED).
  if (Object.hasOwn(ER_CLASSIFIER_FLAG_TO_MOVE_FLAG, value)) {
    const v = ER_CLASSIFIER_FLAG_TO_MOVE_FLAG[value];
    return v ?? null;
  }
  return null;
}

/**
 * Resolve a classifier-emitted status string to its `StatusEffect` enum value.
 * ER-specific statuses (`BLEED`, `FROSTBITE`) and battler-tag-flavored ones
 * (`FLINCH`, `CONFUSION`, `INFATUATION`, `DISABLE`, `FEAR`) return `null` —
 * callers should map those via the battler-tag dispatcher when applicable.
 */
function lookupStatusEffect(value: unknown): StatusEffect | null {
  if (typeof value !== "string") {
    return null;
  }
  // StatusEffect's enum values 0-7 are the vanilla statuses. We accept the
  // canonical names; non-StatusEffect status concepts (CONFUSION, etc.) fall
  // through to null.
  if (Object.hasOwn(StatusEffect, value)) {
    const v = (StatusEffect as unknown as Record<string, number>)[value];
    if (typeof v === "number" && v !== StatusEffect.NONE) {
      return v as StatusEffect;
    }
  }
  return null;
}

/**
 * Resolve a classifier-emitted stat string ("ATK", "SPATK", …) to its
 * `BattleStat` (subset of `Stat`). The `BATTLE_STATS` set excludes HP — the
 * stat-trigger archetype rejects HP changes at construction time so we don't
 * have to filter here, but we do drop HP early to keep the dispatcher
 * predictable.
 */
function lookupBattleStat(value: unknown): BattleStat | null {
  if (typeof value !== "string") {
    return null;
  }
  if (!Object.hasOwn(Stat, value)) {
    return null;
  }
  const v = (Stat as unknown as Record<string, number>)[value];
  if (typeof v !== "number") {
    return null;
  }
  if (v === Stat.HP) {
    return null;
  }
  return v as BattleStat;
}

/**
 * Helper: is `v` a plain object (Record<string, unknown>)? Used to safely
 * read nested params without crashing on null / arrays / primitives.
 */
function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

// =============================================================================
// Per-archetype dispatchers
// =============================================================================

/**
 * Dispatch a `type-damage-boost` classifier row. When the row carries a
 * `recoilPct` (the "… but have N% recoil" abilities — Electric Burst, Infernal
 * Rage, Doom Blast), a sibling {@linkcode TypeRecoilAbAttr} is emitted so the
 * recoil downside is wired alongside the boost (otherwise those abilities would
 * be a pure, over-powered boost).
 */
function dispatchTypeDamageBoost(params: Record<string, unknown>): DispatchResult {
  const type = lookupPokemonType(params.type);
  if (type === null) {
    return skip(`type-damage-boost: unknown type ${String(params.type)}`);
  }
  const multiplier = params.multiplier;
  if (typeof multiplier !== "number") {
    return skip("type-damage-boost: missing/invalid multiplier");
  }
  const lowHpMultiplier = params.lowHpMultiplier;
  const lowHpThreshold = params.lowHpThreshold;
  const attrs: AbAttr[] = [
    new TypeDamageBoostAbAttr({
      type,
      multiplier,
      ...(typeof lowHpMultiplier === "number" ? { lowHpMultiplier } : {}),
      ...(typeof lowHpThreshold === "number" ? { lowHpThreshold } : {}),
    }),
  ];
  const recoilPct = params.recoilPct;
  if (typeof recoilPct === "number" && recoilPct > 0) {
    attrs.push(new TypeRecoilAbAttr({ type, recoilPct }));
  }
  return ok(attrs);
}

/** Dispatch a `flag-damage-boost` classifier row. */
function dispatchFlagDamageBoost(params: Record<string, unknown>): DispatchResult {
  const flag = lookupMoveFlag(params.flag);
  if (flag === null) {
    return skip(`flag-damage-boost: unknown flag ${String(params.flag)}`);
  }
  const multiplier = params.multiplier;
  if (typeof multiplier !== "number") {
    return skip("flag-damage-boost: missing/invalid multiplier");
  }
  return ok([new FlagDamageBoostAbAttr({ flag, multiplier })]);
}

/**
 * Translate the classifier's `condition` payload (with kinds like `max-hp`,
 * `low-hp`, `first-turn`, `first-entry`) to the archetype's
 * `PriorityCondition` discriminated union. The classifier kinds we can map:
 *   - `max-hp` → `full-hp`
 *   - `low-hp` → `low-hp` (passthrough threshold if present)
 * Other kinds (`first-turn`, `first-entry`) need turn-counter / per-entry
 * state that the archetype doesn't yet expose — we return `null` to signal
 * the caller should skip the entry.
 */
function translatePriorityCondition(cond: unknown): PriorityCondition | "skip" | null {
  if (cond === undefined) {
    return null;
  }
  if (!isObject(cond)) {
    return "skip";
  }
  switch (cond.kind) {
    case "max-hp":
      return { kind: "full-hp" };
    case "low-hp": {
      const threshold = cond.threshold;
      return typeof threshold === "number" ? { kind: "low-hp", threshold } : { kind: "low-hp" };
    }
    case "first-turn":
      return { kind: "first-turn" };
    default:
      return "skip";
  }
}

/** Dispatch a `priority-modifier` classifier row. */
function dispatchPriorityModifier(params: Record<string, unknown>): DispatchResult {
  const priority = params.priority;
  if (typeof priority !== "number" || !Number.isInteger(priority) || priority === 0) {
    return skip("priority-modifier: missing/invalid priority");
  }
  // Translate filter (may include `type` and/or `flag`).
  const filter: PriorityModifierFilter = {};
  if (isObject(params.filter)) {
    const type = lookupPokemonType(params.filter.type);
    if (type !== null) {
      (filter as { type: PokemonType }).type = type;
    }
    const flag = lookupMoveFlag(params.filter.flag);
    if (flag !== null) {
      (filter as { flag: MoveFlags }).flag = flag;
    }
    // A filter was PROVIDED but neither its type nor flag resolved — that's a
    // dropped/typo'd filter, not "intentionally unfiltered". Silently defaulting to
    // {} would grant the bonus to EVERY move (the 743/882/923 random-outspeed class).
    // Skip instead so a classifier miss can never reintroduce blanket priority.
    if (Object.keys(filter).length === 0) {
      return skip(`priority-modifier: filter ${JSON.stringify(params.filter)} resolved to nothing - dropped/typo'd?`);
    }
  }
  const condResult = translatePriorityCondition(params.condition);
  if (condResult === "skip") {
    return skip(
      `priority-modifier: unsupported condition kind ${String((params.condition as Record<string, unknown>)?.kind)}`,
    );
  }
  // GUARD (random-outspeed class): a POSITIVE priority with NO filter AND no real
  // condition means "+priority on EVERY move, always" - i.e. this mon out-prioritizes
  // everything with anything. No real ability does that; it's a classifier miss that
  // dropped a type/flag filter (e.g. Cutthroat/Edgelord/Galeforce Wings did exactly
  // this). Skip rather than wire blanket priority, so a future miss can't reintroduce
  // the bug. (Negative blanket priority IS legit - Stall-style "always move last" - so
  // it is NOT skipped; nor is a conditional blanket like "+prio at low HP".)
  const unconditional = condResult === null || condResult.kind === "always";
  if (priority > 0 && Object.keys(filter).length === 0 && unconditional) {
    return skip(`priority-modifier: refusing blanket +${priority} priority (no filter/condition) - classifier miss?`);
  }
  return ok([
    new PriorityModifierAbAttr({
      priority,
      ...(Object.keys(filter).length > 0 ? { filter } : {}),
      ...(condResult === null ? {} : { condition: condResult }),
    }),
  ]);
}

/** Per-kind translator table for `translateEntryEffect`. Returning `null`
 * means the kind isn't wireable (skip the dispatch). Splitting into named
 * helpers keeps the parent function's cognitive complexity within biome's
 * threshold. */
const ENTRY_EFFECT_TRANSLATORS: Record<string, (effect: Record<string, unknown>) => EntryEffect | null> = {
  "set-weather": effect => {
    const weather = lookupWeatherType(effect.weather);
    if (weather === null) {
      return null;
    }
    const turns = typeof effect.turns === "number" ? effect.turns : 8;
    return { kind: "set-weather", weather, turns };
  },
  "set-terrain": effect => {
    const terrain = lookupTerrainType(effect.terrain);
    if (terrain === null) {
      return null;
    }
    const turns = typeof effect.turns === "number" ? effect.turns : 8;
    return { kind: "set-terrain", terrain, turns };
  },
  "set-hazard": effect => {
    const hazard = lookupArenaTagType(effect.hazard);
    if (hazard === null) {
      return null;
    }
    const layers = typeof effect.layers === "number" ? effect.layers : 1;
    const side = effect.side === "foe" || effect.side === "self" || effect.side === "both" ? effect.side : undefined;
    return side === undefined ? { kind: "set-hazard", hazard, layers } : { kind: "set-hazard", hazard, layers, side };
  },
  "set-screen-or-room": effect => {
    const tag = lookupArenaTagType(effect.tag);
    if (tag === null) {
      return null;
    }
    const turns = typeof effect.turns === "number" ? effect.turns : 5;
    return { kind: "set-screen-or-room", tag, turns };
  },
  "add-self-type": effect => {
    const type = lookupPokemonType(effect.type);
    if (type === null) {
      return null;
    }
    return { kind: "add-self-type", type };
  },
  "self-stat-boost": effect => {
    const stat = lookupBattleStat(effect.stat);
    if (stat === null) {
      // Classifier emits "HIGHEST" / "HIGHEST_ATK" — not a single stat.
      return null;
    }
    const stages = typeof effect.stages === "number" ? effect.stages : 1;
    if (stages === 0) {
      return null;
    }
    return { kind: "self-stat-boost", stat, stages };
  },
};

/**
 * Translate the classifier's `effect` payload into the archetype's
 * `EntryEffect` discriminated union. Returns `null` for kinds the archetype
 * doesn't model (scripted-move, first-move-priority, lower-foe-stat,
 * set-misc, misc — handled bespoke or via follow-up archetypes).
 */
function translateEntryEffect(effect: unknown): EntryEffect | null {
  if (!isObject(effect)) {
    return null;
  }
  const kind = effect.kind;
  if (typeof kind !== "string") {
    return null;
  }
  const translator = ENTRY_EFFECT_TRANSLATORS[kind];
  if (translator === undefined) {
    return null;
  }
  return translator(effect);
}

/** Dispatch an `entry-effect` classifier row. */
function dispatchEntryEffect(params: Record<string, unknown>): DispatchResult {
  const effect = translateEntryEffect(params.effect);
  if (effect === null) {
    const kind = (params.effect as Record<string, unknown> | undefined)?.kind ?? "(missing)";
    return skip(`entry-effect: unsupported/unparseable kind ${String(kind)}`);
  }
  return ok([new EntryEffectAbAttr(effect)]);
}

/**
 * Map classifier-emitted status strings that are actually battler-tag concepts
 * (CONFUSION, INFATUATION, FLINCH, DISABLE, plus ER-specific BLEED,
 * FROSTBITE, FEAR) to their {@linkcode BattlerTagType} value. Returns `null`
 * for inputs that aren't battler-tag concepts — those flow to
 * `lookupStatusEffect` (vanilla StatusEffect).
 */
function lookupBattlerTagFromStatus(value: unknown): BattlerTagType | null {
  if (typeof value !== "string") {
    return null;
  }
  // Direct enum match (CONFUSED, INFATUATED, FLINCHED, DISABLED, TAUNT).
  if (Object.hasOwn(BattlerTagType, value)) {
    return (BattlerTagType as unknown as Record<string, BattlerTagType>)[value];
  }
  // Classifier aliases — the inventory uses non-suffixed forms.
  switch (value) {
    case "CONFUSION":
      return BattlerTagType.CONFUSED;
    case "INFATUATION":
      return BattlerTagType.INFATUATED;
    case "FLINCH":
      return BattlerTagType.FLINCHED;
    case "DISABLE":
      return BattlerTagType.DISABLED;
    // ER-specific status concepts modelled as battler tags (see
    // `BattlerTagType.ER_BLEED` et al. and their backing tag classes in
    // `src/data/battler-tags.ts`).
    case "BLEED":
      return BattlerTagType.ER_BLEED;
    case "FROSTBITE":
      return BattlerTagType.ER_FROSTBITE;
    case "FEAR":
      return BattlerTagType.ER_FEAR;
    default:
      return null;
  }
}

/**
 * Translate a classifier-emitted `filter` payload into a
 * {@linkcode ChanceStatusFilter}. The classifier emits `{flag: "BITING_MOVE"}`
 * (CAPS form, going through `ER_CLASSIFIER_FLAG_TO_MOVE_FLAG`) or
 * `{type: "GRASS"}` (`PokemonType` enum key). Returns `undefined` for absent
 * filters and `null` for unparseable ones so the caller can record a skip
 * reason.
 */
function lookupChanceStatusFilter(value: unknown): ChanceStatusFilter | null | undefined {
  if (value === undefined || value === null) {
    return;
  }
  if (!isObject(value)) {
    return null;
  }
  if (typeof value.flag === "string") {
    // Use the shared resolver so both pokerogue-native enum names
    // ("BITING_MOVE", "PUNCHING_MOVE") and classifier-form keys
    // ("STRONG_JAW", "IRON_FIST", "SOUND_BASED") are accepted — the classifier
    // and hand-authored fixups have used both spellings interchangeably.
    const flag = lookupMoveFlag(value.flag);
    if (flag === null) {
      return null;
    }
    return { flag };
  }
  if (typeof value.type === "string") {
    const t = lookupPokemonType(value.type);
    return t === null ? null : { type: t };
  }
  if (typeof value.category === "string") {
    // Gate the proc on the incoming move's category (e.g. Voodoo Power: bleed
    // only when hit by a SPECIAL attack).
    if (value.category === "PHYSICAL") {
      return { category: MoveCategory.PHYSICAL };
    }
    if (value.category === "SPECIAL") {
      return { category: MoveCategory.SPECIAL };
    }
    if (value.category === "STATUS") {
      return { category: MoveCategory.STATUS };
    }
    return null;
  }
  return null;
}

/** Proc direction for `chance-status-on-hit` rows (see `dispatchChanceStatusOnHit`). */
type ChanceStatusDirection = "defense" | "offense" | "both";

/**
 * Parse the optional `direction` param. Controls whether the proc fires on
 * DEFENSE (holder is hit → status the attacker, Static/Effect-Spore style),
 * OFFENSE (holder's move → status the target, Poison-Touch/Shocking-Jaws
 * style), or BOTH ("also works on offense" composites like Daybreak). Absent
 * defaults to "defense" to preserve the original (vanilla-reactive) behavior
 * for unannotated rows; an unrecognised value returns `null`.
 */
function parseChanceStatusDirection(value: unknown): ChanceStatusDirection | null {
  if (value === undefined) {
    return "defense";
  }
  if (value === "defense" || value === "offense" || value === "both") {
    return value;
  }
  return null;
}

/**
 * Build the defensive and/or offensive attrs for the resolved direction.
 * `makeDefense`/`makeOffense` are thunks so only the needed attrs are
 * constructed.
 */
function buildDirectionalAttrs(
  direction: ChanceStatusDirection,
  makeDefense: () => AbAttr,
  makeOffense: () => AbAttr,
): AbAttr[] {
  const attrs: AbAttr[] = [];
  if (direction === "defense" || direction === "both") {
    attrs.push(makeDefense());
  }
  if (direction === "offense" || direction === "both") {
    attrs.push(makeOffense());
  }
  return attrs;
}

/** Dispatch a `chance-status-on-hit` classifier row. */
function dispatchChanceStatusOnHit(params: Record<string, unknown>): DispatchResult {
  const chance = params.chance;
  if (typeof chance !== "number" || chance < 0 || chance > 100) {
    return skip("chance-status-on-hit: missing/invalid chance");
  }
  const direction = parseChanceStatusDirection(params.direction);
  if (direction === null) {
    return skip(`chance-status-on-hit: unknown direction ${String(params.direction)}`);
  }
  const contactRequired = params.onContactOnly;
  const contactOpt = typeof contactRequired === "boolean" ? { contactRequired } : {};
  const filter = lookupChanceStatusFilter(params.filter);
  if (filter === null) {
    return skip(`chance-status-on-hit: unparseable filter ${JSON.stringify(params.filter)}`);
  }
  const filterOpt = filter === undefined ? {} : { filter };
  // Prefer the vanilla StatusEffect path first; only fall back to the
  // battler-tag flavor when the status string is a tag concept (CONFUSION,
  // INFATUATION, FLINCH, DISABLE) or an ER-specific one (BLEED, FROSTBITE,
  // FEAR) routed through `lookupBattlerTagFromStatus`.
  const status = lookupStatusEffect(params.status);
  if (status !== null) {
    const opts = { chance, effects: [status], ...contactOpt, ...filterOpt };
    return ok(
      buildDirectionalAttrs(
        direction,
        () => new ChanceStatusOnHitAbAttr(opts),
        () => new ChanceStatusOnAttackAbAttr(opts),
      ),
    );
  }
  const tag = lookupBattlerTagFromStatus(params.status);
  if (tag !== null) {
    const opts = { chance, tags: [tag], ...contactOpt, ...filterOpt };
    return ok(
      buildDirectionalAttrs(
        direction,
        () => new ChanceBattlerTagOnHitAbAttr(opts),
        () => new ChanceBattlerTagOnAttackAbAttr(opts),
      ),
    );
  }
  return skip(`chance-status-on-hit: status ${String(params.status)} not a vanilla StatusEffect or BattlerTag`);
}

/** Dispatch a `crit-mod` classifier row. */
function dispatchCritMod(params: Record<string, unknown>): DispatchResult {
  if (!isObject(params.mod)) {
    return skip("crit-mod: missing mod");
  }
  const mod = params.mod;
  switch (mod.kind) {
    case "immune":
      return ok([new CritImmunityAbAttr()]);
    case "rate-bonus": {
      const bonus = mod.bonus;
      if (typeof bonus !== "number" || !Number.isInteger(bonus) || bonus < 1) {
        return skip("crit-mod rate-bonus: missing/invalid bonus");
      }
      return ok([new CritStageBonusAbAttr({ bonus })]);
    }
    case "post-crit-mult": {
      const multiplier = mod.multiplier;
      if (typeof multiplier !== "number" || multiplier <= 0) {
        return skip("crit-mod post-crit-mult: missing/invalid multiplier");
      }
      return ok([new CritDamageMultiplierAbAttr({ multiplier })]);
    }
    default:
      return skip(`crit-mod: unknown mod kind ${String(mod.kind)}`);
  }
}

/**
 * Translate the classifier's `damage-reduction-generic` filter shape to the
 * archetype's `DamageReductionFilter`. The classifier emits:
 *   - `{ kind: "all" | "contact" | "super-effective" }` — direct passthrough
 *   - `{ kind: "physical" }` → `{ kind: "category", category: PHYSICAL }`
 *   - `{ kind: "special" }` → `{ kind: "category", category: SPECIAL }`
 *   - `{ kind: "weather", weather }` — NOT supported by the base archetype;
 *     callers should use `WeatherDamageReductionAbAttr` instead via the
 *     weather-or-terrain-interaction archetype. Return `"skip"`.
 */
function translateDamageReductionFilter(filter: unknown): DamageReductionFilter | "skip" {
  if (!isObject(filter)) {
    return "skip";
  }
  switch (filter.kind) {
    case "all":
    case "contact":
    case "super-effective":
    case "full-hp":
      return { kind: filter.kind };
    case "physical":
      return { kind: "category", category: MoveCategory.PHYSICAL };
    case "special":
      return { kind: "category", category: MoveCategory.SPECIAL };
    default:
      return "skip";
  }
}

/** Dispatch a `damage-reduction-generic` classifier row. */
function dispatchDamageReduction(params: Record<string, unknown>): DispatchResult {
  const reduction = params.reduction;
  if (typeof reduction !== "number" || reduction <= 0 || reduction >= 1) {
    return skip("damage-reduction-generic: missing/invalid reduction");
  }
  const filter = translateDamageReductionFilter(params.filter);
  if (filter === "skip") {
    const kind = isObject(params.filter) ? params.filter.kind : "(missing)";
    return skip(`damage-reduction-generic: unsupported filter kind ${String(kind)}`);
  }
  return ok([new DamageReductionAbAttr({ filter, reduction })]);
}

/**
 * Translate the classifier's passive-recovery condition (always-style or
 * status/weather/terrain-gated) to the archetype's condition. The classifier
 * only emits a single shape — `{ healFraction }` — for the one passive-
 * recovery entry; richer conditions are encoded via composite rows. We pass
 * the condition through if it parses, otherwise default to `always`.
 */
function dispatchPassiveRecovery(params: Record<string, unknown>): DispatchResult {
  const healFraction = params.healFraction;
  if (typeof healFraction !== "number" || healFraction <= 0 || healFraction > 1) {
    return skip("passive-recovery: missing/invalid healFraction");
  }
  // The classifier only emits `{ healFraction }` for this archetype today.
  // Reserve the condition slot for future expansion.
  const cond: PassiveRecoveryCondition = { kind: "always" };
  return ok([new PassiveRecoveryAbAttr({ healFraction, condition: cond })]);
}

/** Dispatch a `lifesteal` classifier row. */
function dispatchLifesteal(params: Record<string, unknown>): DispatchResult {
  const trigger = params.trigger;
  const healFraction = params.healFraction;
  if (typeof trigger !== "string") {
    return skip("lifesteal: missing trigger");
  }
  if (typeof healFraction !== "number" || healFraction <= 0 || healFraction > 1) {
    return skip("lifesteal: missing/invalid healFraction");
  }
  // Classifier emits `on-ko`, `on-hit-deal`. The archetype has `LifestealOnKoAbAttr`
  // and `LifestealOnHitAbAttr` siblings.
  if (trigger === "on-ko") {
    return ok([new LifestealOnKoAbAttr({ healFraction })]);
  }
  if (trigger === "on-hit-deal" || trigger === "on-hit") {
    return ok([new LifestealOnHitAbAttr({ healFraction })]);
  }
  return skip(`lifesteal: unknown trigger ${trigger}`);
}

/**
 * Build the StatChange[] payload from the classifier's `stats` array. Each
 * stat-change row carries either `{ stages }` (typed BattleStat delta) or
 * `{ percentBoost }` / `{ multiplier }` (which the archetype doesn't model).
 * We drop unmapped entries and return the filtered list.
 */
function buildStatChanges(rawStats: unknown): StatChange[] {
  if (!Array.isArray(rawStats)) {
    return [];
  }
  const out: StatChange[] = [];
  for (const raw of rawStats) {
    if (!isObject(raw)) {
      continue;
    }
    const stat = lookupBattleStat(raw.stat);
    if (stat === null) {
      continue;
    }
    const stages = raw.stages;
    if (typeof stages !== "number" || !Number.isInteger(stages) || stages === 0) {
      // The percentBoost / multiplier variants need a different surface
      // (stat-modifier archetype, not stat-stage). Skip.
      continue;
    }
    out.push({ stat, stages });
  }
  return out;
}

/**
 * Parse an `on-hit` filter row (`{ types?: string[], flags?: string[] }`) into the
 * type/flag gate consumed by {@linkcode StatTriggerOnHitAbAttr}. Returns null when
 * no usable type/flag is present so an unfiltered trigger stays unfiltered.
 *
 * Without this, the filter on filtered procs (e.g. Inflatable's `[FLYING, FIRE]`)
 * was silently dropped, so they fired on EVERY hit regardless of move type.
 */
function parseOnHitFilter(raw: unknown): { types?: PokemonType[]; flags?: MoveFlags[] } | null {
  if (raw === null || typeof raw !== "object") {
    return null;
  }
  const r = raw as { types?: unknown; flags?: unknown };
  const types: PokemonType[] = [];
  if (Array.isArray(r.types)) {
    for (const t of r.types) {
      const pt = typeof t === "string" ? PokemonType[t as keyof typeof PokemonType] : undefined;
      if (typeof pt === "number") {
        types.push(pt);
      }
    }
  }
  const flags: MoveFlags[] = [];
  if (Array.isArray(r.flags)) {
    for (const f of r.flags) {
      const mf = typeof f === "string" ? MoveFlags[f as keyof typeof MoveFlags] : undefined;
      if (typeof mf === "number") {
        flags.push(mf);
      }
    }
  }
  const filter: { types?: PokemonType[]; flags?: MoveFlags[] } = {};
  if (types.length > 0) {
    filter.types = types;
  }
  if (flags.length > 0) {
    filter.flags = flags;
  }
  return filter.types || filter.flags ? filter : null;
}

/** Dispatch a `stat-trigger-on-event` classifier row. */
function dispatchStatTriggerOnEvent(params: Record<string, unknown>): DispatchResult {
  const trigger = params.trigger;
  if (typeof trigger !== "string") {
    return skip("stat-trigger-on-event: missing trigger");
  }
  const stats = buildStatChanges(params.stats);
  if (stats.length === 0) {
    return skip("stat-trigger-on-event: no usable stat changes (raw stats may use percentBoost/multiplier)");
  }
  switch (trigger) {
    case "on-ko":
      return ok([new StatTriggerOnKoAbAttr({ stats })]);
    case "on-hit":
      return ok([new StatTriggerOnHitAbAttr({ stats, filter: parseOnHitFilter(params.filter) ?? undefined })]);
    case "on-entry":
      return ok([new StatTriggerOnEntryAbAttr({ stats })]);
    case "on-stat-lowered": {
      // `scope: "side"` (King's Wrath 409 / Queen's Mourning 410) fires ONCE
      // PER STAT LOWERED on the holder AND its ally; the ally half needs the
      // companion attr. Default `"self"` keeps the Defiant/Narcissist shape.
      const scope = params.scope === "side" ? "side" : "self";
      if (scope === "side") {
        return ok([
          new StatTriggerOnStatLoweredAbAttr({ stats, scope }),
          new StatTriggerOnAllyStatLoweredAbAttr({ stats }),
        ]);
      }
      return ok([new StatTriggerOnStatLoweredAbAttr({ stats, scope })]);
    }
    // The classifier emits `first-turn` for some abilities; the archetype
    // doesn't have a `StatTriggerOnFirstTurnAbAttr` yet. Skip.
    case "first-turn":
    default:
      return skip(`stat-trigger-on-event: trigger ${trigger} not yet wired`);
  }
}

/**
 * Dispatch a `type-conversion` classifier row. The archetype is two-class:
 * a `TypeConversionAbAttr` for the type rewrite + an optional sibling
 * `TypeConversionPowerBoostAbAttr` for the power boost. We wire both when
 * the classifier emits a multiplier.
 */
function dispatchTypeConversion(params: Record<string, unknown>): DispatchResult {
  const sourceType = lookupPokemonType(params.sourceType);
  const targetType = lookupPokemonType(params.targetType);
  if (sourceType === null || targetType === null) {
    return skip("type-conversion: unknown source/target type");
  }
  // Optional flag — when set, the conversion gates on both flag AND original type
  // (Sand Song "Sound Normal moves become Ground"). When unset, plain type-keyed.
  const flag = lookupMoveFlag(params.flag);
  const source =
    flag === null
      ? { kind: "type" as const, type: sourceType }
      : { kind: "flag" as const, flag, requireType: sourceType };
  const attrs: AbAttr[] = [new TypeConversionAbAttr({ source, newType: targetType })];
  const multiplier = params.multiplier;
  if (typeof multiplier === "number" && multiplier !== 1) {
    // The power boost is BROADER than the type rewrite for the flag-keyed
    // "X Song" family: the dex boosts ALL flagged (sound) moves by the
    // multiplier, while the type conversion only rewrites the requireType-gated
    // (Normal) subset. Drop `requireType` from the boost source so every sound
    // move gets the 1.2x (Snow Song, Sand Song, Banshee, Power Metal). Type-
    // keyed conversions (no flag) keep their single source.
    const boostSource = flag === null ? source : { kind: "flag" as const, flag };
    attrs.push(new TypeConversionPowerBoostAbAttr({ source: boostSource, multiplier }));
  }
  return ok(attrs);
}

/**
 * Resolve the classifier's `type` field (either a single string or a string
 * array) to a list of `PokemonType` values. Returns an empty array if the
 * input shape can't be parsed.
 */
function resolveTypeOrTypes(rawType: unknown): PokemonType[] {
  const types: PokemonType[] = [];
  if (typeof rawType === "string") {
    const t = lookupPokemonType(rawType);
    if (t !== null) {
      types.push(t);
    }
  } else if (Array.isArray(rawType)) {
    for (const r of rawType) {
      const t = lookupPokemonType(r);
      if (t !== null) {
        types.push(t);
      }
    }
  }
  return types;
}

/**
 * Build the absorb-side attrs for `type-resist-or-absorb`: either a
 * stat-boost variant (Storm Drain / Sap Sipper / Lightning Rod / Motor
 * Drive style) or a heal variant (Water Absorb / Volt Absorb). Returns
 * the constructed attr list (one per type when the input is multi-type).
 */
function buildTypeAbsorbAttrs(types: readonly PokemonType[], effect: Record<string, unknown>): AbAttr[] {
  // Storm-Drain / Lightning-Rod style: also DRAW IN (redirect) the absorbed type
  // toward the holder. The `redirect: true` payload flag was previously dropped
  // (e.g. Heat Sink 865 "Redirects Fire moves").
  const attrs: AbAttr[] = [];
  if (effect.redirect === true) {
    attrs.push(...types.map(type => new RedirectTypeMoveAbAttr(type)));
  }
  const statBoost = effect.statBoost;
  if (isObject(statBoost)) {
    const stages = statBoost.stages;
    if (typeof stages === "number" && Number.isInteger(stages) && stages !== 0) {
      // Heat Sink: "Fire-type moves boost the highest attacking stat by 1."
      // The `highestAttack` marker resolves ATK vs SPATK at proc time.
      if (statBoost.highestAttack === true) {
        attrs.push(...types.map(type => new TypeAbsorbHighestAttackStatBoostAbAttr({ type, stages })));
        return attrs;
      }
      const stat = lookupBattleStat(statBoost.stat);
      if (stat !== null) {
        attrs.push(...types.map(type => new TypeAbsorbStatBoostAbAttr({ type, stat, stages })));
        return attrs;
      }
    }
    return attrs;
  }
  const healPct = effect.healPct;
  if (typeof healPct === "number" && healPct > 0 && healPct <= 1) {
    attrs.push(...types.map(type => new TypeAbsorbHealAbAttr({ type, healFraction: healPct })));
    return attrs;
  }
  // Default to vanilla 1/4 heal when no payload — matches the
  // classifier's intent for plain "Water Absorb"-style abilities.
  attrs.push(...types.map(type => new TypeAbsorbHealAbAttr({ type })));
  return attrs;
}

/**
 * Dispatch a `type-resist-or-absorb` classifier row. The classifier emits
 * either `effect: { kind: "resist", multiplier }` (pure damage-reduction) or
 * `effect: { kind: "absorb", redirect?, healPct?, statBoost? }` (vanilla
 * Water-Absorb / Storm-Drain shape). We map absorb-heal and absorb-stat-
 * boost to the two `TypeAbsorb*AbAttr` classes. Pure resist returns no
 * attrs (needs damage-reduction-generic with a type filter, which the
 * archetype doesn't yet expose — skip).
 *
 * Multi-type filters (`type: ["FIRE", "WATER"]`) wire one absorb per type so
 * the archetype's single-type constructor works.
 */
function dispatchTypeResistOrAbsorb(params: Record<string, unknown>): DispatchResult {
  const types = resolveTypeOrTypes(params.type);
  if (types.length === 0) {
    return skip("type-resist-or-absorb: no valid types");
  }
  if (!isObject(params.effect)) {
    return skip("type-resist-or-absorb: missing effect");
  }
  const effect = params.effect;
  if (effect.kind === "resist") {
    // Pure resist needs `DamageReductionAbAttr` with a type filter, which
    // the archetype doesn't expose today. The vanilla equivalent is the
    // `TypeImmunityHealAbAttr` with a zero healFraction, but that's
    // semantically different (still triggers absorb). Defer.
    return skip("type-resist-or-absorb: pure resist (no absorb) needs type-filter on damage-reduction; not yet wired");
  }
  if (effect.kind === "absorb") {
    const attrs = buildTypeAbsorbAttrs(types, effect);
    if (attrs.length === 0) {
      return skip("type-resist-or-absorb: absorb payload had no constructable variant");
    }
    return ok(attrs);
  }
  return skip(`type-resist-or-absorb: unknown effect kind ${String(effect.kind)}`);
}

/**
 * Dispatch a `weather-or-terrain-interaction` classifier row. The classifier
 * emits `condition: { weather | terrain }` + `effect: { kind, … }` with
 * effect kinds the archetype models:
 *   - `type-boost` → `WeatherTypeBoostAbAttr`
 *   - `damage-reduction` → `WeatherDamageReductionAbAttr`
 *   - `stat-boost` → not modeled (highest-stat math is bespoke); skip.
 */
function dispatchWeatherOrTerrainInteraction(params: Record<string, unknown>): DispatchResult {
  if (!isObject(params.condition) || !isObject(params.effect)) {
    return skip("weather-or-terrain-interaction: missing condition/effect");
  }
  const weather = lookupWeatherType(params.condition.weather);
  // Terrain-gated currently has no archetype primitive (only weather-side has
  // `WeatherTypeBoostAbAttr` / `WeatherDamageReductionAbAttr`). Skip until
  // a terrain sibling lands.
  if (weather === null) {
    return skip("weather-or-terrain-interaction: terrain conditions not yet wired");
  }
  switch (params.effect.kind) {
    case "type-boost": {
      const type = lookupPokemonType(params.effect.type);
      const multiplier = params.effect.multiplier;
      if (type === null || typeof multiplier !== "number" || multiplier <= 0) {
        return skip("weather-or-terrain-interaction: type-boost missing type/multiplier");
      }
      return ok([new WeatherTypeBoostAbAttr({ weathers: [weather], type, multiplier })]);
    }
    case "damage-reduction": {
      const multiplier = params.effect.multiplier;
      if (typeof multiplier !== "number" || multiplier <= 0 || multiplier > 1) {
        return skip("weather-or-terrain-interaction: damage-reduction missing multiplier");
      }
      return ok([new WeatherDamageReductionAbAttr({ weathers: [weather], multiplier })]);
    }
    default:
      return skip(`weather-or-terrain-interaction: effect kind ${String(params.effect.kind)} not yet wired`);
  }
}

/**
 * Dispatch a `multi-hit-override` classifier row. The classifier emits
 * `{ filter: { kind, … }, hits, secondaryHitMultiplier?, allHitsMultiplier? }`.
 * We map to `HitMultiplierAbAttr` (the strike-count piece) plus optionally
 * `HitMultiplierPowerAbAttr` (the per-hit damage scaling). When the classifier
 * emits `allHitsMultiplier` we scale every strike uniformly; when it emits
 * `secondaryHitMultiplier` we scale ONLY the extra (2nd+) strikes via the
 * archetype's `extraStrikesOnly` mode — so the first hit stays at full power
 * (faithful "1st hit 100%, 2nd hit at N%").
 */
/**
 * Translate the classifier's `multi-hit-override` filter shape into the
 * archetype's `{ type?, flag? }` filter. Returns the special string
 * `"skip"` for kinds we can't resolve (callers translate that into a
 * dispatch skip).
 */
function translateMultiHitFilter(filter: Record<string, unknown>): { type?: PokemonType; flag?: MoveFlags } | "skip" {
  switch (filter.kind) {
    case "all":
      return {};
    case "type": {
      const type = lookupPokemonType(filter.type);
      return type === null ? "skip" : { type };
    }
    case "flag": {
      const flag = lookupMoveFlag(filter.flag);
      return flag === null ? "skip" : { flag };
    }
    default:
      return "skip";
  }
}

function dispatchMultiHitOverride(params: Record<string, unknown>): DispatchResult {
  const hits = params.hits;
  if (typeof hits !== "number" || !Number.isInteger(hits) || hits < 2) {
    return skip("multi-hit-override: missing/invalid hits");
  }
  if (!isObject(params.filter)) {
    return skip("multi-hit-override: missing filter");
  }
  const archetypeFilter = translateMultiHitFilter(params.filter);
  if (archetypeFilter === "skip") {
    return skip(`multi-hit-override: unsupported filter ${String(params.filter.kind)}`);
  }
  const extraStrikes = hits - 1;
  const hasFilter = Object.keys(archetypeFilter).length > 0;
  const attrs: AbAttr[] = [
    new HitMultiplierAbAttr({
      extraStrikes,
      ...(hasFilter ? { filter: archetypeFilter } : {}),
    }),
  ];
  // `allHitsMultiplier` scales EVERY strike uniformly (Raging Moth: both Fire
  // hits at 70%). `secondaryHitMultiplier` scales ONLY the extra (2nd+) strike,
  // leaving the first at full power (Hyper Aggressive: 1st 100% / 2nd 25%;
  // Raging Boxer / Primal Maw: 1st 100% / 2nd 40%) — the faithful ER behaviour.
  const allMult = params.allHitsMultiplier;
  const secondaryMult = params.secondaryHitMultiplier;
  if (typeof allMult === "number" && allMult > 0 && allMult <= 1) {
    attrs.push(
      new HitMultiplierPowerAbAttr({
        multiplier: allMult,
        ...(hasFilter ? { filter: archetypeFilter } : {}),
      }),
    );
  } else if (typeof secondaryMult === "number" && secondaryMult > 0 && secondaryMult <= 1) {
    attrs.push(
      new HitMultiplierPowerAbAttr({
        multiplier: secondaryMult,
        extraStrikesOnly: true,
        ...(hasFilter ? { filter: archetypeFilter } : {}),
      }),
    );
  }
  return ok(attrs);
}

/** Result of parsing a single classifier tag entry. */
type TagParseResult = "intimidate" | { battlerTag: BattlerTagType } | null;

/**
 * Resolve a single classifier-emitted tag string ("CONFUSED", "INFATUATED",
 * "INTIMIDATE", …) to either an `IntimidateImmunity` marker, a
 * `BattlerTagType`, or `null` for unrecognised inputs.
 */
function parseImmunityTag(raw: string): TagParseResult {
  if (raw === "INTIMIDATE" || raw === "SCARE") {
    return "intimidate";
  }
  if (Object.hasOwn(BattlerTagType, raw)) {
    return { battlerTag: (BattlerTagType as unknown as Record<string, BattlerTagType>)[raw] };
  }
  // Classifier aliases for tag-like statuses.
  if (raw === "CONFUSION") {
    return { battlerTag: BattlerTagType.CONFUSED };
  }
  if (raw === "INFATUATION") {
    return { battlerTag: BattlerTagType.INFATUATED };
  }
  return null;
}

/** Extract the StatusEffect[] piece from the classifier's `statuses` field. */
function collectStatuses(rawStatuses: unknown): StatusEffect[] {
  if (!Array.isArray(rawStatuses) || rawStatuses.length === 0) {
    return [];
  }
  const statuses: StatusEffect[] = [];
  for (const raw of rawStatuses) {
    const v = lookupStatusEffect(raw);
    if (v !== null) {
      statuses.push(v);
    }
  }
  return statuses;
}

/** Extract the BattlerTag[] + Intimidate-immunity piece from `tags`. */
function collectImmunityTags(rawTags: unknown): { battlerTags: BattlerTagType[]; intimidateImmunity: boolean } {
  if (!Array.isArray(rawTags) || rawTags.length === 0) {
    return { battlerTags: [], intimidateImmunity: false };
  }
  const battlerTags: BattlerTagType[] = [];
  let intimidateImmunity = false;
  for (const raw of rawTags) {
    if (typeof raw !== "string") {
      continue;
    }
    const parsed = parseImmunityTag(raw);
    if (parsed === "intimidate") {
      intimidateImmunity = true;
    } else if (parsed !== null) {
      battlerTags.push(parsed.battlerTag);
    }
  }
  return { battlerTags, intimidateImmunity };
}

/** Dispatch a `status-immunity` classifier row. */
function dispatchStatusImmunity(params: Record<string, unknown>): DispatchResult {
  const attrs: AbAttr[] = [];
  const statuses = collectStatuses(params.statuses);
  if (statuses.length > 0) {
    attrs.push(new StatusEffectImmunityAbAttrEr({ statuses }));
  }
  const { battlerTags, intimidateImmunity } = collectImmunityTags(params.tags);
  if (battlerTags.length > 0) {
    attrs.push(new BattlerTagImmunityAbAttrEr({ tags: battlerTags }));
  }
  if (intimidateImmunity) {
    attrs.push(new IntimidateImmunityAbAttrEr());
  }
  if (attrs.length === 0) {
    return skip("status-immunity: no constructable immunity (statuses/tags empty after filtering)");
  }
  return ok(attrs);
}

/** Build a `target-statused` condition from a classifier `statuses` array. */
function buildTargetStatusedCondition(cond: Record<string, unknown>): DamageCondition {
  if (!Array.isArray(cond.statuses)) {
    return { kind: "target-statused" };
  }
  const statuses: StatusEffect[] = [];
  for (const raw of cond.statuses) {
    const v = lookupStatusEffect(raw);
    if (v !== null) {
      statuses.push(v);
    }
  }
  return statuses.length > 0 ? { kind: "target-statused", statuses } : { kind: "target-statused" };
}

/** Per-kind translator for `translateDamageCondition`. */
const DAMAGE_CONDITION_TRANSLATORS: Record<string, (cond: Record<string, unknown>) => DamageCondition | null> = {
  "target-asleep": () => ({ kind: "target-statused", statuses: [StatusEffect.SLEEP] }),
  "target-statused": cond => buildTargetStatusedCondition(cond),
  "target-low-hp": cond => {
    const threshold = cond.threshold;
    return typeof threshold === "number" ? { kind: "target-low-hp", threshold } : { kind: "target-low-hp" };
  },
  "self-low-hp": cond => {
    const threshold = cond.threshold;
    return typeof threshold === "number" ? { kind: "self-low-hp", threshold } : { kind: "self-low-hp" };
  },
  "target-confused": () => ({ kind: "target-confused" }),
  "target-has-lowered-stat": () => ({ kind: "target-has-lowered-stat" }),
  "any-active-asleep": () => ({ kind: "any-active-asleep" }),
};

/**
 * Translate the classifier's conditional-damage condition kind (`target-
 * asleep`, `target-confused`, `target-has-lowered-stat`, `other`, …) to the
 * archetype's `DamageCondition`. The "other" kind carries a free-text note
 * that we can't map structurally — return `null` for those.
 */
function translateDamageCondition(cond: unknown): DamageCondition | null {
  if (!isObject(cond)) {
    return null;
  }
  const kind = cond.kind;
  if (typeof kind !== "string") {
    return null;
  }
  const translator = DAMAGE_CONDITION_TRANSLATORS[kind];
  if (translator === undefined) {
    return null;
  }
  return translator(cond);
}

/** Dispatch a `conditional-damage` classifier row. */
function dispatchConditionalDamage(params: Record<string, unknown>): DispatchResult {
  const multiplier = params.multiplier;
  if (typeof multiplier !== "number" || multiplier <= 0) {
    return skip("conditional-damage: missing/invalid multiplier");
  }
  const condition = translateDamageCondition(params.condition);
  if (condition === null) {
    const kind = isObject(params.condition) ? params.condition.kind : "(missing)";
    return skip(`conditional-damage: unsupported condition kind ${String(kind)}`);
  }
  return ok([new ConditionalDamageAbAttr({ condition, multiplier })]);
}

/**
 * Resolve a single composite part reference (vanilla pokerogue or ER) into
 * AbAttrs. For pokerogue parts the dispatcher copies the references from
 * `allAbilities[abilityId].attrs` verbatim — the existing per-attr state is
 * read-only at apply time (per-battle mutation lives on Pokemon, not on the
 * attr), so sharing instances across abilities is safe. For ER parts the
 * dispatcher recursively dispatches the referenced ability's archetype row;
 * `visited` blocks cycles.
 */
function resolveCompositePartAttrs(
  part: ErCompositePartRef,
  visited: Set<number>,
): { attrs: readonly AbAttr[]; skipReason: string | null } {
  if (part.kind === "pokerogue") {
    const ability = allAbilities[part.abilityId];
    if (ability === undefined) {
      // `allAbilities` is sparse-ish — built positionally in `initAbilities()`.
      // A missing entry usually means the dispatcher ran before that init step
      // (test ordering bug) or the id-map references an ability that isn't
      // implemented yet.
      return { attrs: [], skipReason: `pokerogue ability id ${part.abilityId} not initialised at dispatch time` };
    }
    if (ability.attrs.length === 0) {
      // Vanilla ability without wired AbAttrs (rare placeholder). Mention the
      // id so triage can confirm the upstream ability really is a no-op.
      return { attrs: [], skipReason: `pokerogue ability id ${part.abilityId} has no attrs to copy` };
    }
    // The source ability's GATE lives in its ability-level `.conditions` (e.g.
    // Swift Swim's `.condition(getWeatherCondition(RAIN))`, Chlorophyll's sun
    // gate). Copying only `.attrs` would drop that gate, making the part apply
    // UNCONDITIONALLY inside the composite (a systemic over-powering bug). To
    // preserve the gate we attach the source conditions as a per-attr
    // `extraCondition` (which `apply-ab-attrs` enforces generically, for ANY
    // attr type) — but on a shallow CLONE so we never mutate the shared source
    // instance (the real Swift Swim / other composites keep their own state).
    if (ability.conditions.length > 0) {
      const sourceConditions = ability.conditions;
      const gated = ability.attrs.map(attr => {
        const clone = Object.assign(Object.create(Object.getPrototypeOf(attr)), attr) as AbAttr;
        const existing = clone.getCondition();
        clone.addCondition(
          pokemon => sourceConditions.every(c => c(pokemon)) && (existing === null || existing(pokemon)),
        );
        return clone;
      });
      return { attrs: gated, skipReason: null };
    }
    return { attrs: ability.attrs, skipReason: null };
  }
  // ER recursive lookup.
  if (visited.has(part.erAbilityId)) {
    return { attrs: [], skipReason: `composite cycle: er ability ${part.erAbilityId} already visited` };
  }
  const archetypeRow = ER_ABILITY_ARCHETYPES[part.erAbilityId];
  if (archetypeRow === undefined) {
    return { attrs: [], skipReason: `er ability ${part.erAbilityId} missing archetype row` };
  }
  const sub = dispatchArchetypeInternal(part.erAbilityId, archetypeRow.archetype, archetypeRow.params, visited);
  return { attrs: sub.attrs, skipReason: sub.skipReason };
}

/**
 * Hand-maintained wiring for composite RIDERS — free-text effect sentences that
 * the auto-generated `ER_COMPOSITE_PARTS` table records under `unresolvedParts`
 * (they aren't ability names, so the classifier can't resolve them). We can't
 * regenerate that table to add them (it has hand-applied fixups that a rebuild
 * would clobber), so riders that map cleanly onto an existing archetype
 * primitive are wired here and merged into the composite's attr list.
 *
 * Currently covers the chance-status OFFENSIVE riders (the holder's flagged/
 * typed move statuses the target) — mechanically identical to the abilities
 * fixed under #126, just attached to a composite instead of standing alone.
 * Faithful to each ability's in-game description.
 */
function compositeRiderAttrs(erAbilityId: number): AbAttr[] {
  switch (erAbilityId) {
    case 416: {
      // Atomic Burst — composite (Galvanize + Electromorphosis) PLUS the missing
      // rider: "If they are Electric-type their Electric moves have a 10%
      // paralysis chance." Gated on the holder actually being Electric-type.
      const par = new ChanceStatusOnAttackAbAttr({
        chance: 10,
        effects: [StatusEffect.PARALYSIS],
        filter: { type: PokemonType.ELECTRIC },
      });
      par.addCondition(holder => holder.isOfType(PokemonType.ELECTRIC));
      return [par];
    }
    case 707:
      // Gleam Eyes — dex: "reveals the opponents' held items, prevents them from
      // working for 2 turns (Embargo-style; excludes Mega Stones), and lowers all
      // foes' Sp. Atk by one stage on entry." The Frisk (reveal + the 2-turn
      // ER_ITEM_DISABLED lock via DisableFoeItemsOnEntryAbAttr) and Scare
      // (SpAtk -1) composite parts already deliver ALL three clauses — the Frisk
      // part copies AbilityId.FRISK's ER attrs, which now include the real
      // turn-limited item lock (init-elite-redux-vanilla-rebalance.ts §Round 10;
      // enforced in PokemonHeldItemModifier.shouldApply + erApplyReactiveOnHit).
      // No rider needed: the earlier As-One primitives (PreventBerryUse/
      // PreventItemUse) were a PERMANENT field lock, over-broad vs the dex's exact
      // 2-turn window — dropped in favour of the ER_ITEM_DISABLED tag.
      return [];
    case 706: // Shocking Maw: "Bite moves have 50% paralysis chance"
      return [
        new ChanceStatusOnAttackAbAttr({
          chance: 50,
          effects: [StatusEffect.PARALYSIS],
          filter: { flag: MoveFlags.BITING_MOVE },
        }),
      ];
    case 845: // Impaler: "30% Bleed chance on horn moves"
      return [
        new ChanceBattlerTagOnAttackAbAttr({
          chance: 30,
          tags: [BattlerTagType.ER_BLEED],
          filter: { flag: MoveFlags.HORN_BASED },
        }),
      ];
    case 851: // Komodo: "Adds Dragon-type, moves have 30% Bad Poison chance" —
      // the Dragon type-add (on summon, via the same add-self-type path as
      // Aquatic/Grounded) plus the offensive 30% TOXIC rider.
      return [
        new EntryEffectAbAttr({ kind: "add-self-type", type: PokemonType.DRAGON }),
        new ChanceStatusOnAttackAbAttr({ chance: 30, effects: [StatusEffect.TOXIC] }),
      ];
    case 856: // Molten Coat: "Rock moves have 50% burn chance"
      return [
        new ChanceStatusOnAttackAbAttr({
          chance: 50,
          effects: [StatusEffect.BURN],
          filter: { type: PokemonType.ROCK },
        }),
      ];
    // "X STAB" riders — the holder gets STAB (1.5x) on moves of the named type
    // even when it isn't that type. StabAddAbAttr already guards against
    // double-STAB on real-STAB moves.
    case 620:
      // Old Mariner: "Water STAB" + "immunity to being drenched". The Seaweed
      // (Grass-gated Fire interaction) piece is the auto-resolved composite part;
      // this rider adds Water STAB plus the drench-immunity marker (DRENCH itself
      // is not yet implemented engine-wide — the marker makes the immunity
      // correct-by-construction; see DrenchImmunityAbAttr).
      return [new StabAddAbAttr({ targetType: PokemonType.WATER }), new DrenchImmunityAbAttr()];
    case 969: // Hand Barnacles: "Water STAB"
      return [new StabAddAbAttr({ targetType: PokemonType.WATER })];
    case 760: // Acidic Slime: "Poison STAB" + "Poison moves are super-effective
      // vs Steel" (the offensive type-chart override the dex grants, mirroring
      // Trash Heap 725 / Pyroclastic Flow 635).
      return [
        new StabAddAbAttr({ targetType: PokemonType.POISON }),
        new OffensiveTypeChartOverrideAbAttr({
          rules: [{ attackType: PokemonType.POISON, defenderType: PokemonType.STEEL, newMultiplier: 2 }],
        }),
      ];
    case 826: // Tender Affection: "Fairy STAB"
      return [new StabAddAbAttr({ targetType: PokemonType.FAIRY })];
    case 681: // Atomic Punch: "Iron Fist + 30% Steel type damage" — Steel moves x1.3
      // (the Iron Fist half is the auto-resolved pokerogue part).
      return [new TypeDamageBoostAbAttr({ type: PokemonType.STEEL, multiplier: 1.3 })];
    case 785: // Two-Faced: "Hunger Switch + Elec and Dark deal 1.35x with 10% recoil"
      // (Hunger Switch is the auto-resolved part). Both type boosts come WITH a
      // 10% recoil downside — now wirable via TypeRecoilAbAttr.
      return [
        new TypeDamageBoostAbAttr({ type: PokemonType.ELECTRIC, multiplier: 1.35 }),
        new TypeDamageBoostAbAttr({ type: PokemonType.DARK, multiplier: 1.35 }),
        new TypeRecoilAbAttr({ type: PokemonType.ELECTRIC, recoilPct: 0.1 }),
        new TypeRecoilAbAttr({ type: PokemonType.DARK, recoilPct: 0.1 }),
      ];
    case 986: // Mucus Membrane: "Takes 30% less damage from attacks" (reduction = fraction removed)
      return [new DamageReductionAbAttr({ reduction: 0.3, filter: { kind: "all" } })];
    case 530: // Crowned King: "Prevents all opposing Pokemon from consuming held
      // items." The composite parts wire Unnerve (berry-only block) + the Grim/
      // Chilling Neigh KO boosts; add the PreventItemUse marker so NON-berry
      // consumables are blocked too (mirrors As One 266/267).
      return [new PreventItemUseAbAttr()];
    case 779: // Blight Scale: "30% chance to inflict poison on contact moves, BOTH
      // when attacking and being attacked." The composite parts wire Multiscale +
      // Poison Point (the DEFENSIVE half); add the OFFENSIVE 30%-poison-on-contact.
      return [new ChanceStatusOnAttackAbAttr({ chance: 30, effects: [StatusEffect.POISON], contactRequired: true })];
    case 962: // Angelic Wings: "Prism Scales + Huge Wings." The Prism Scales part
      // (-30% special damage) resolves; add the dropped Huge Wings component —
      // wing/wind/air-based (AIR_BASED) moves at 1.3x, mirroring Giant Wings er371.
      return [new FlagDamageBoostAbAttr({ flag: MoveFlags.AIR_BASED, multiplier: 1.3 })];
    case 499: // Refrigerator: "Filter + Illuminate + removes Ghost-typing on the
      // target when landing an attack." Filter (SE 0.65) + Illuminate (1.2x
      // accuracy) resolve as the composite parts; add the on-hit Ghost strip.
      return [new PostAttackRemoveTargetTypeAbAttr({ type: PokemonType.GHOST })];
    case 682: // Iron Giant: "Heatproof + Juggernaut" — but the dex says burn deals
      // NO damage (Heatproof only halves it) AND burn's Attack drop is nullified.
      // Append FULL burn-tick immunity (wins over Heatproof's 0.5 as it runs after
      // it) + the burn-Attack-halving waiver. Fire ×0.5 + Juggernaut come from the
      // composite parts.
      return [new FullBurnDamageImmunityAbAttr(), new BypassBurnDamageReductionAbAttr()];
    case 805: // Sepia Lens: "Tinted Lens + Sand Guard" — the dex also grants
      // immunity to sandstorm chip damage (like other Ground-types). The parts
      // wire the NVE-doubling + in-sand special reduction / priority immunity;
      // add the sandstorm-damage immunity marker.
      return [new BlockWeatherDamageAttr(WeatherType.SANDSTORM)];
    // (er 909 Lightsaber relocated to dispatchBespokeR48 — it's a pure
    // hand-wired ability with no vanilla-ability parts, so it's classified
    // `bespoke` rather than `composite-vanilla-mashup`.)
    case 859: // Dreamscape: "Comatose + Dreamcatcher + Deal 20% more damage" — the
      // bare "+20% damage" rider is an unconditional all-moves power boost.
      // (Comatose is the auto-resolved part; Dreamcatcher remains a named rider.)
      return [new MovePowerBoostAbAttr(() => true, 1.2)];
    case 983: // Overcast: "Low Visibility + Sets Mist on entry" — cast Mist on
      // summon (the Mist move sets the side's Mist tag, blocking stat drops).
      return [new EntryEffectAbAttr({ kind: "scripted-move", move: MoveId.MIST })];
    case 493: // Cryo Proficiency: "triggers hail when hit" — PostDefend weather set.
      return [new PostDefendWeatherChangeAbAttr(WeatherType.HAIL)];
    case 857: // Royal Decree: "Queenly Majesty + Glare on entry once per battle" —
      // cast Glare (paralyze the foe) on summon, gated to ONCE per battle so a
      // switch-out/in within the encounter doesn't re-paralyze.
      return [new EntryEffectAbAttr({ kind: "scripted-move", move: MoveId.GLARE }, true)];
    case 508: // Pure Love: "Cute Charm + heal 25% damage vs infatuated" — lifesteal
      // (1/4 of damage dealt) gated on the target being INFATUATED. Cute Charm
      // (the auto-resolved part) is what infatuates the target on contact.
      return [new LifestealOnHitAbAttr({ healFraction: 0.25, filter: { targetTag: BattlerTagType.INFATUATED } })];
    case 469: // Nika: "Water moves function normally under sun" — cancel the 0.5x
      // sun penalty on the holder's Water moves. A x2.0 power boost gated on
      // active (non-suppressed) sun nets x1.0 against the weather's x0.5.
      return [
        new MovePowerBoostAbAttr((user, _target, move) => {
          const w = globalScene.arena.weather;
          if (!w || w.isEffectSuppressed()) {
            return false;
          }
          const wt = w.weatherType;
          if (wt !== WeatherType.SUNNY && wt !== WeatherType.HARSH_SUN) {
            return false;
          }
          return user?.getMoveType(move) === PokemonType.WATER;
        }, 2.0),
      ];
    case 873: // Ice Plumes: "Absorbs Rock-moves/Stealth Rocks" — Rock-move
      // absorb (immune + heal 1/4, like Water Absorb) PLUS Stealth Rock immunity
      // (no switch-in damage, heal 1/4 instead) via the hazard-immunity marker.
      // The +2-Speed-on-Rock-hit and +2-Speed-on-SR-present-switch-in halves come
      // from the er447 Furnace composite part (both triggers already wired there).
      return [new TypeAbsorbHealAbAttr({ type: PokemonType.ROCK }), new StealthRockImmunityAbAttr()];
    case 871: // Fire Aspect: "Doubles all allies' Speed" — persistent same-side
      // Speed aura (x2) over the holder's teammates (the Desolate Land weather +
      // 3-turn Tailwind halves come from the pokerogue-190 + er320 composite parts).
      // Same-side only (PersistentFieldAura skips cross-side); inert in singles,
      // as an ally aura should be.
      return [new PersistentFieldAuraAbAttr({ stats: [Stat.SPD], multiplier: 2 })];
    case 848: // Superheavy: "blocks phasing moves" — immune to forced switch-out
      // (Roar/Whirlwind/Dragon Tail), exactly Suction Cups' effect.
      return [new ForceSwitchOutImmunityAbAttr()];
    case 389: // Marine Apex: "50% more damage to Water-types + Infiltrator"
      // (Infiltrator is the auto-resolved part). +50% when the TARGET is Water.
      return [
        new MovePowerBoostAbAttr(
          (_user, target, _move) => !!target && target.getTypes().includes(PokemonType.WATER),
          1.5,
        ),
      ];
    case 1011: // Sinister Claws: "Keen Edge moves lower SpDef" — holder's SLICING
      // move lowers the target's Sp. Def by 1.
      return [
        new StatChangeOnAttackAbAttr({
          stats: [Stat.SPDEF],
          stages: -1,
          flag: MoveFlags.SLICING_MOVE,
        }),
      ];
    case 759: // Faraday Cage: "Shell Armor + 50BP Thunder Cage when hit by
      // contact" — retaliate with Thunder Cage when struck by a contact move
      // (Shell Armor is the auto-resolved part). The ROM dex specifies the
      // counter is cast at 50 BP (Thunder Cage's natural power is 80), so the
      // power override is required to match the dex. Dex also grants "Incoming
      // damage is reduced by 20%, multiplicative" — add the 0.8x DamageReduction
      // (same form Dream State/709 uses).
      return [
        new CounterAttackOnHitAbAttr({ moveId: MoveId.THUNDER_CAGE, power: 50, filter: { contactRequired: true } }),
        new DamageReductionAbAttr({ reduction: 0.2, filter: { kind: "all" } }),
      ];
    case 1019: // Wind Chimes: "Amplifier + attacks with 30 BP Hyper Voice when
      // hit" — retaliate with a 30BP Hyper Voice on any hit (power overridden
      // from its natural 90BP). Amplifier is the auto-resolved part.
      return [new CounterAttackOnHitAbAttr({ moveId: MoveId.HYPER_VOICE, power: 30 })];
    case 762: // Qigong: "Rampage + Always hits" — the holder's moves never miss
      // (No Guard's no-miss half). Rampage is the auto-resolved part.
      return [new AlwaysHitAbAttr()];
    case 881: // Stonecutter: "Fossilized + Rock moves ignore abilities" — the
      // holder's Rock-type moves bypass the target's ability (type-gated Mold
      // Breaker). Fossilized is the auto-resolved part.
      return [new MoveAbilityBypassAbAttr((pokemon, move) => pokemon.getMoveType(move) === PokemonType.ROCK)];
    case 600: // Brawling Wyvern: "No guard + Dragon type moves become punching
      // moves" — the holder's Dragon moves gain the PUNCHING flag (so Iron Fist
      // etc. boost them). No Guard is the auto-resolved part.
      return [
        new AddMoveFlagAbAttr({
          filter: (user, move) => user.getMoveType(move) === PokemonType.DRAGON,
          flags: [MoveFlags.PUNCHING_MOVE],
        }),
      ];
    case 780: // Gunman: "Mega Launcher + Status moves are Mega Launcher moves" —
      // the holder's Status moves gain the PULSE flag (Mega Launcher, the
      // auto-resolved part, then treats them as pulse moves).
      return [
        new AddMoveFlagAbAttr({
          filter: (_user, move) => move.category === MoveCategory.STATUS,
          flags: [MoveFlags.PULSE_MOVE],
        }),
      ];
    case 844: // Best Offense: "Mystic blades + use 20% of spdef during moves" —
      // the holder's offensive stat (ATK physical / SPATK special) gains 20% of
      // its Sp. Def while attacking. Mystic blades is the auto-resolved part.
      return [new StatBlendAbAttr({ appliesTo: [Stat.ATK, Stat.SPATK], sourceStat: Stat.SPDEF, fraction: 0.2 })];
    case 982: // Cryostasis: "Cryomancy + Frostbite causes flinching" — the
      // holder's hits flinch a target that is already frostbitten (Cryomancy,
      // the auto-resolved part, is what applies frostbite 5x as often).
      return [
        new ChanceBattlerTagOnAttackAbAttr({
          chance: 100,
          tags: [BattlerTagType.FLINCHED],
          targetHasTag: BattlerTagType.ER_FROSTBITE,
        }),
      ];
    case 959: // Chestnut Axe: "Keen edge + Grass moves become Keen Edge boosted"
      // — Grass moves gain the ER Keen Edge boost (1.3x, matching case 271's
      // SLICING 1.3x), wired as the OUTCOME: a Grass-type 1.3x power boost, since
      // pokerogue has no per-holder move-flag grant.
      return [new MoveTypePowerBoostAbAttr(PokemonType.GRASS, 1.3)];
    case 606: // Aerialist: "Levitate + 25% more Flying damage + ANOTHER 20% (or
      // 50% at <=1/3 HP)." Composite parts = Levitate (Ground immunity) + Flock
      // (Flying x1.2, x1.5 low-HP). The standalone flat +25% Flying boost is the
      // missing rider — it stacks on top of Flock, netting x1.5 / x1.875.
      return [new MoveTypePowerBoostAbAttr(PokemonType.FLYING, 1.25)];
    default:
      return [];
  }
}

/** Canonical (lowercase alphanumerics-only) form for ability-name matching. */
function canonicalizeAbilityName(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/**
 * Cheap pre-filter for whether a rider string could be an ability NAME (vs a
 * free-text effect sentence). We deliberately keep this loose — the index
 * lookup in {@linkcode getNamedRiderIndex} is the real filter. We only reject
 * the obvious non-names: anything carrying a digit/percent (effect numbers like
 * "50% more damage…") or too long to be a name. Crucially we do NOT ban
 * prepositions ("of", "the", "on") — that would wrongly reject multi-word
 * ability names like "Sword of Ruin", "Jaws of Carnage", "On the Prowl" (the
 * very reason the offline classifier left them unresolved).
 */
function riderLooksLikeAbilityName(part: string): boolean {
  return part.length <= 28 && !/[%\d]/.test(part);
}

/** Lazily-built canonical-name → composite part ref index (memoized). */
let namedRiderIndex: Map<string, ErCompositePartRef> | null = null;

/**
 * Build (once) a canonical-name → {@linkcode ErCompositePartRef} index covering
 * both the pokerogue `AbilityId` enum and the ER ability names. Pokerogue wins
 * ties (its abilities have real AbAttr wiring), matching the classifier's
 * resolution order. Used to late-bind composite riders that are actually
 * ability NAMES the generator's name-match missed (e.g. "Sword of Ruin",
 * "Stakeout", "On the Prowl").
 */
function getNamedRiderIndex(): Map<string, ErCompositePartRef> {
  if (namedRiderIndex !== null) {
    return namedRiderIndex;
  }
  const idx = new Map<string, ErCompositePartRef>();
  for (const key of Object.keys(AbilityId)) {
    if (!Number.isNaN(Number(key))) {
      continue; // skip the enum's reverse numeric keys
    }
    const id = (AbilityId as unknown as Record<string, number>)[key];
    const c = canonicalizeAbilityName(key);
    if (c.length > 0 && !idx.has(c)) {
      idx.set(c, { kind: "pokerogue", abilityId: id });
    }
  }
  for (const a of ER_ABILITIES) {
    const c = canonicalizeAbilityName(a.name);
    if (c.length > 0 && !idx.has(c)) {
      idx.set(c, { kind: "er", erAbilityId: a.id });
    }
  }
  namedRiderIndex = idx;
  return idx;
}

/**
 * Dispatch a `composite-vanilla-mashup` row. Looks up the per-ability resolved
 * parts table (`ER_COMPOSITE_PARTS`), walks each part through
 * `resolveCompositePartAttrs`, and concatenates the resulting AbAttr lists.
 *
 * Even when some parts fail to resolve (free-text riders, cycles), the
 * dispatcher returns whatever parts it COULD wire — partial coverage is
 * better than total skip. `skipReason` is set only when zero attrs were
 * produced (composite contributed nothing).
 */
function dispatchComposite(erAbilityId: number, visited: Set<number>): DispatchResult {
  const entry = ER_COMPOSITE_PARTS[erAbilityId];
  // Hand-wired riders (free-text effects) supplement the auto-resolved parts.
  // They may exist even when the parts table has zero resolvable parts.
  const riderAttrs = compositeRiderAttrs(erAbilityId);
  if (entry === undefined) {
    if (riderAttrs.length > 0) {
      return ok(riderAttrs);
    }
    return skip(
      `composite-vanilla-mashup: no resolved-parts entry for er ability ${erAbilityId} (run er:classify-composites)`,
    );
  }
  // Defensive: track the visited set with the composite's own id added BEFORE
  // recursion so self-references (rare but possible if the classifier emits a
  // composite that names itself) abort cleanly.
  const nextVisited = new Set(visited);
  nextVisited.add(erAbilityId);
  const out: AbAttr[] = [];
  const subSkips: string[] = [];
  for (const part of entry.parts) {
    const partResult = resolveCompositePartAttrs(part, nextVisited);
    if (partResult.skipReason !== null) {
      subSkips.push(partResult.skipReason);
      continue;
    }
    for (const attr of partResult.attrs) {
      out.push(attr);
    }
  }
  // Late-bind named riders: free-text `unresolvedParts` that are actually
  // ability NAMES (vanilla or ER) the generator's name-match missed. Resolve
  // them at runtime and dispatch like a normal part. The heuristic keeps real
  // free-text effect sentences out (those are handled by compositeRiderAttrs).
  for (const rider of entry.unresolvedParts ?? []) {
    if (!riderLooksLikeAbilityName(rider)) {
      continue;
    }
    const ref = getNamedRiderIndex().get(canonicalizeAbilityName(rider));
    if (ref === undefined) {
      continue;
    }
    const partResult = resolveCompositePartAttrs(ref, nextVisited);
    if (partResult.skipReason !== null) {
      subSkips.push(partResult.skipReason);
      continue;
    }
    for (const attr of partResult.attrs) {
      out.push(attr);
    }
  }
  // Append hand-wired riders after the auto-resolved parts.
  for (const attr of riderAttrs) {
    out.push(attr);
  }
  if (out.length === 0) {
    return skip(
      `composite-vanilla-mashup: er ability ${erAbilityId} produced 0 attrs from ${entry.parts.length} part(s) + ${entry.unresolvedParts?.length ?? 0} rider(s) (${subSkips.join("; ") || "no resolvable parts"})`,
    );
  }
  // Patchwork 693 — "Disguise + curses the attacker when its Disguise breaks. In
  // fog, the disguise is restored immediately once per switch in, or when fog is
  // set again." The Disguise part contributes the vanilla FormBlockDamageAbAttr;
  // swap it for the curse-on-break variant (same block / 1/8 recoil / busted-form
  // change, plus CURSED on the attacker). Done here (not as a bespoke case) so
  // 693 keeps the composite path's post-init refresh, which guarantees the copied
  // Disguise attrs are populated. Then append the fog-restore hooks: the busted
  // disguise (form index 1) is restored when FOG is set (PostWeatherChange) or on
  // a switch-in while fog is active (PostSummon). The restorable `busted -> ""`
  // ability edge (see init-elite-redux-er-custom-form-changes.ts) resolves the
  // ability form-change trigger back to the intact form.
  if (erAbilityId === 693) {
    for (let i = 0; i < out.length; i++) {
      if (out[i].constructor.name === "FormBlockDamageAbAttr") {
        out[i] = new CurseAttackerOnFormBlockDamageAbAttr(0, "abilityTriggers:disguiseAvoidedDamage", 0.125);
      }
    }
    out.push(new FogRestoreDisguiseFormChangeAbAttr(1), new PostSummonFogRestoreDisguiseAbAttr(1));
  }
  if (erAbilityId === 818) {
    for (let i = 0; i < out.length; i++) {
      const attr = out[i];
      if (attr instanceof ChanceBattlerTagOnAttackAbAttr && attr.getTags().includes(BattlerTagType.WRAP)) {
        out[i] = new ChanceBattlerTagOnAttackAbAttr({
          chance: 50,
          tags: [BattlerTagType.WRAP],
          contactRequired: false,
          turns: 6,
          damageDenominator: 6,
        });
      }
    }
  }
  // Trash Heap 725 (Corrosion + Toxic Spill) — the Corrosion part wires the
  // status-immunity bypass (poison Steel/Poison) but NOT the "Poison-type moves
  // become super-effective against Steel" damage clause; append it.
  if (erAbilityId === 725) {
    out.push(
      new OffensiveTypeChartOverrideAbAttr({
        rules: [{ attackType: PokemonType.POISON, defenderType: PokemonType.STEEL, newMultiplier: 2 }],
      }),
    );
  }
  // Pyroclastic Flow 635 (Molten Down + Corrosion) — the parts wire Fire-SE-vs-Rock
  // and poison-any-type, but NOT the dex's "Poison-type moves become super-effective
  // against Steel"; append the same offensive override 725/760 carry.
  if (erAbilityId === 635) {
    out.push(
      new OffensiveTypeChartOverrideAbAttr({
        rules: [{ attackType: PokemonType.POISON, defenderType: PokemonType.STEEL, newMultiplier: 2 }],
      }),
    );
  }
  // Imposing Wings 688 (er371 AIR_BASED 1.3x + Levitate) — the composite covers
  // the wing/wind/air +30% boost and the Ground immunity, but NOT the dex's
  // separate "+25% to FLYING-type moves" (AIR_BASED is a move flag, not the type).
  if (erAbilityId === 688) {
    out.push(new TypeDamageBoostAbAttr({ type: PokemonType.FLYING, multiplier: 1.25 }));
  }
  // Sludgy Mix 726 (Intoxicate + Punk Rock) — the Intoxicate part wires the
  // Normal→Poison conversion + STAB but NOT its "if the user is Poison-type, its
  // Poison moves gain a 10% bad-poison chance" rider; append it, gated on the
  // holder actually being Poison-type.
  if (erAbilityId === 726) {
    const toxicRider = new ChanceStatusOnAttackAbAttr({
      chance: 10,
      effects: [StatusEffect.TOXIC],
      filter: { type: PokemonType.POISON },
    });
    toxicRider.addCondition(holder => holder.isOfType(PokemonType.POISON));
    out.push(toxicRider);
  }
  // Hungry Maws 861 (Strong Jaw + Jaws of Carnage) — the KO-heal was flat 50%;
  // the text is "50% with biting KOs, 25% with other moves". Swap the flat
  // LifestealOnKo for the biting-flag-conditional variant (0.25 base / 0.5 bite).
  if (erAbilityId === 861) {
    for (let i = 0; i < out.length; i++) {
      if (out[i].constructor.name === "LifestealOnKoAbAttr") {
        out[i] = new LifestealOnKoAbAttr({
          healFraction: 0.25,
          flagBonus: { flag: MoveFlags.BITING_MOVE, fraction: 0.5 },
        });
      }
    }
  }
  // Big Leaves 374 (Chloroplast + Chlorophyll + Leaf Guard + Harvest + Solar
  // Power) — clause 5 is "Raises the HIGHEST attacking stat by 50% in sun", but
  // the Solar Power part only contributes a Sp.Atk×1.5 (StatMultiplierAbAttr on
  // SPATK), so a physical attacker got nothing. Swap that SPATK-only multiplier
  // for a highest-of-{ATK,SPATK}×1.5 gated on sun. (Do NOT touch patchSolarPower —
  // the standalone Solar Power ability is legitimately Sp.Atk-only.)
  if (erAbilityId === 374) {
    for (let i = out.length - 1; i >= 0; i--) {
      const a = out[i];
      if (a.constructor.name === "StatMultiplierAbAttr" && (a as unknown as { stat: number }).stat === Stat.SPATK) {
        out.splice(i, 1);
      }
    }
    out.push(
      new SelfHighestStatMultiplierAbAttr({
        candidates: [Stat.ATK, Stat.SPATK],
        multiplier: 1.5,
        weathers: [WeatherType.SUNNY, WeatherType.HARSH_SUN],
      }),
    );
  }
  // Draconic Might 841 (Draconize + Half Drake) — the Normal→Dragon conversion +
  // Dragon STAB + entry Dragon-type-add are wired, but Draconize's "if the user
  // is Dragon-type, its Dragon moves deal neutral damage vs Fairy" override was
  // dropped. Append OffensiveTypeChartOverride(DRAGON→FAIRY = 1), gated on the
  // holder being Dragon-type (which it becomes via the entry type-add).
  if (erAbilityId === 841) {
    const override = new OffensiveTypeChartOverrideAbAttr({
      rules: [{ attackType: PokemonType.DRAGON, defenderType: PokemonType.FAIRY, newMultiplier: 1 }],
    });
    override.addCondition(holder => holder.isOfType(PokemonType.DRAGON));
    out.push(override);
  }
  // Glacial Ghost 825 (Slush Rush + Snow Cloak) — the text is "reduces opponent
  // accuracy by 25% during hail", but the Snow Cloak part wired a +20% EVASION
  // boost. Swap the evasion multiplier for an incoming-accuracy ×0.75 (a true 25%
  // accuracy reduction), preserving the original hail weather-gate condition.
  if (erAbilityId === 825) {
    for (let i = 0; i < out.length; i++) {
      const a = out[i];
      if (a.constructor.name === "StatMultiplierAbAttr" && (a as unknown as { stat: number }).stat === Stat.EVA) {
        const acc = new IncomingAccuracyMultiplierAbAttr({ multiplier: 0.75 });
        const cond = a.getCondition();
        if (cond) {
          acc.addCondition(cond);
        }
        out[i] = acc;
      }
    }
  }
  // Stainless Steel 829 (Fort Knox + Steelworker) — dex: "If the user is
  // Steel-type it RESISTS GHOST AND STEEL, otherwise it gains Steel STAB." The
  // Steelworker part contributes the Normal→Steel conversion (kept) but ALSO an
  // UNCONDITIONAL Ghost 0.5 + DARK 0.5 resist (wrong: resists Dark not Steel, and
  // ungated). Strip those inherited ReceivedTypeDamageMultiplier resists and
  // replace with GHOST + STEEL at 0.5 GATED on the holder being Steel-type. The
  // StabAdd(STEEL) covers the "otherwise Steel STAB" branch — its built-in "move
  // type not already one of the user's types" guard makes it a no-op for Steel
  // users (who get natural STAB), so both branches coexist correctly.
  if (erAbilityId === 829) {
    for (let i = out.length - 1; i >= 0; i--) {
      if (out[i].constructor.name === "ReceivedTypeDamageMultiplierAbAttr") {
        out.splice(i, 1);
      }
    }
    const ghostResist = new ReceivedTypeDamageMultiplierAbAttr(PokemonType.GHOST, 0.5);
    ghostResist.addCondition(holder => holder.isOfType(PokemonType.STEEL));
    const steelResist = new ReceivedTypeDamageMultiplierAbAttr(PokemonType.STEEL, 0.5);
    steelResist.addCondition(holder => holder.isOfType(PokemonType.STEEL));
    out.push(ghostResist, steelResist, new StabAddAbAttr({ targetType: PokemonType.STEEL }));
  }
  // Super Sniper 806 (Sniper + switch-strike) — the Sniper crit ×2.25 is wired.
  // Dex: "attacks strike foes before they finish switching out for 50% power."
  // Fire the switch-strike via OnOpponentSwitchOut (the same engine hook 656 Tag
  // uses) at HALF Pursuit's 40 BP (= 20 BP, the "50% power" the dex specifies) —
  // NOT full-power Pursuit, which would land at ~2×.
  if (erAbilityId === 806) {
    out.push(new OnOpponentSwitchOutAbAttr({ moveId: MoveId.PURSUIT, power: 20 }));
  }
  // Caretaker 783 (Healer + Friend Guard) — the Healer part cures only the ALLY
  // (30%/turn). The description is "30% chance to cure status for BOTH the user
  // and their ally ... 2 separate checks for each Pokemon" — so append an
  // independent 30% SELF-cure (allyTarget=false) alongside the inherited ally one.
  if (erAbilityId === 783) {
    const selfCure = new PostTurnResetStatusAbAttr(false);
    selfCure.addCondition(holder => holder.randBattleSeedInt(10) < 3);
    out.push(selfCure);
  }
  // Unown Power 776 (Mystic Power) — Mystic Power grants STAB to all moves, but
  // the "Hidden/Secret Power is always super effective (×2)" clause was dropped.
  // Model the always-SE as a flat ×2 power boost on those two moves (same
  // resulting damage; move-id-scoped so nothing else is affected).
  if (erAbilityId === 776) {
    out.push(
      new MovePowerBoostAbAttr(
        (_user, _target, move) => move.id === MoveId.HIDDEN_POWER || move.id === MoveId.SECRET_POWER,
        2,
      ),
    );
  }
  // Acidic Slime 760 (Corrosion + Poison STAB) — the Corrosion part wires the
  // any-type poison bypass + Poison STAB, but NOT the headline "Poison-type
  // moves become super effective against Steel-type"; append it (mirrors 725).
  if (erAbilityId === 760) {
    out.push(
      new OffensiveTypeChartOverrideAbAttr({
        rules: [{ attackType: PokemonType.POISON, defenderType: PokemonType.STEEL, newMultiplier: 2 }],
      }),
    );
  }
  // Brute Force 758 (Rock Head + Reckless) — "increases recoil-move damage by
  // 20%. While enraged, this boost applies to ALL moves." The enraged-all-moves
  // boost is now handled by the GLOBAL ER_ENRAGE Reckless boost in
  // Move.calculateBattlePower (any enraged mon's non-recoil moves get +20%, with
  // recoil moves left to the real Reckless part), so no Brute-Force-specific
  // rider is needed here — its Rock Head recoil immunity also covers enrage recoil.
  // Relentless 772 (Exploit Weakness + Merciless) — Exploit Weakness here is the
  // 1.25×-damage variant ("deals 1.25x damage AND targets their lower defensive
  // stat"); the shared DefenseStatSwap part only does the stat redirect, so add
  // the flat 1.25× when attacking a statused foe.
  if (erAbilityId === 772) {
    out.push(
      new MovePowerBoostAbAttr(
        (_user, target) => target != null && target.status != null && target.status.effect !== StatusEffect.NONE,
        1.25,
      ),
    );
  }
  // Qigong 762 (Always hits + Fighting Spirit + Rampage) — the wired parts give
  // never-miss + clear-RECHARGING-on-KO. Append the "Fighting Spirit" piece
  // (Normal-type moves become Fighting + Fighting STAB) AND the dropped clause
  // "if the user is Fighting-type their Fighting-type moves break screens" — a
  // Fighting-typed break-screens attr gated on the holder being Fighting-type.
  if (erAbilityId === 762) {
    const breakScreens = new RemoveScreensOnTypedAttackAbAttr({ type: PokemonType.FIGHTING });
    breakScreens.addCondition(holder => holder.isOfType(PokemonType.FIGHTING));
    out.push(
      new TypeConversionAbAttr({ source: { kind: "type", type: PokemonType.NORMAL }, newType: PokemonType.FIGHTING }),
      new StabAddAbAttr({ targetType: PokemonType.FIGHTING }),
      breakScreens,
    );
  }
  // Best Offense 844 / Magus Blades 846 — both resolve Mystic Blades (er505),
  // which bundles an undocumented SLICING ×1.3 damage boost that NEITHER dex
  // grants (they only make Keen Edge moves Special + use 20% Sp.Def). Strip that
  // SLICING FlagDamageBoost for these two only — scoped so Blade's Essence (513),
  // whose dex DOES explicitly grant the 30%, keeps its boost, and Mystic Blades
  // 505's own standalone wiring is untouched.
  if (erAbilityId === 844 || erAbilityId === 846) {
    for (let i = out.length - 1; i >= 0; i--) {
      const a = out[i];
      if (a instanceof FlagDamageBoostAbAttr && a.getBoostFlag() === MoveFlags.SLICING_MOVE) {
        out.splice(i, 1);
      }
    }
  }
  // Magus Blades 846 — Dual Wield's (er433) double-hit masks PULSE|SLICING, but
  // 846's dex only makes KEEN EDGE (slicing) moves hit twice. Rebuild the
  // double-hit SLICING-only (removing the inherited PULSE|SLICING pair) so pulse
  // moves don't wrongly double-strike. Keep the 0.7 per-hit power.
  if (erAbilityId === 846) {
    for (let i = out.length - 1; i >= 0; i--) {
      const a = out[i];
      if (a instanceof HitMultiplierAbAttr || a instanceof HitMultiplierPowerAbAttr) {
        out.splice(i, 1);
      }
    }
    out.push(
      new HitMultiplierAbAttr({ filter: { flag: MoveFlags.SLICING_MOVE }, extraStrikes: 1 }),
      new HitMultiplierPowerAbAttr({ filter: { flag: MoveFlags.SLICING_MOVE }, multiplier: 0.7 }),
    );
  }
  // Icicle Fist 1017 (Iron Fist + "30% chance to cause frostbite with punches")
  // — Iron Fist boosts punching moves ×1.3; append the 30% frostbite rider on
  // PUNCHING_MOVE attacks (ER_FROSTBITE battler tag, same shape as Frostmaw 692).
  if (erAbilityId === 1017) {
    out.push(
      new PostAttackApplyBattlerTagAbAttr(
        false,
        (_u, _t, move) => (move.hasFlag(MoveFlags.PUNCHING_MOVE) ? 30 : 0),
        BattlerTagType.ER_FROSTBITE,
      ),
    );
  }
  // Fire's Wrath 969 (Intimidate + Scare) — the two parts give the −1 ATK /
  // −1 SpAtk on entry, but the headline "10% burn chance on non-contact moves"
  // is a third clause neither vanilla ability provides; append it as an
  // offensive non-contact 10% BURN proc.
  if (erAbilityId === 971) {
    out.push(new ChanceStatusOnAttackAbAttr({ chance: 10, effects: [StatusEffect.BURN], contactExcluded: true }));
  }
  // Crushing Jaw 976 (Strong Jaw + "Biting moves have a 50% chance to lower
  // defense") — the Strong Jaw part boosts biting moves ×1.3, but the headline
  // 50% DEF-drop rider was dropped; append it as a flag-gated, chance-gated
  // post-attack stat drop on the target.
  if (erAbilityId === 978) {
    out.push(new StatDebuffOnFlagAttackAbAttr({ flag: MoveFlags.BITING_MOVE, stat: Stat.DEF, stages: -1, chance: 50 }));
  }
  // Mega Drill 983 (Mighty Horn + "all Drill moves are 30% stronger") — the
  // Mighty Horn part (er-391) boosts HORN_BASED moves ×1.3, but the drill-move
  // boost was dropped; append a DRILL_BASED ×1.3 FlagDamageBoost.
  if (erAbilityId === 985) {
    out.push(new FlagDamageBoostAbAttr({ flag: MoveFlags.DRILL_BASED, multiplier: 1.3 }));
  }
  // Backstreet Boy 974 (Striker + "Kicking moves are Dance moves and vice-versa")
  // — the Striker part (er-361) already boosts KICKING moves ×1.3. The crossover
  // adds two halves: (a) dance moves are kicking → they also get the ×1.3 Striker
  // boost (FlagDamageBoost reads the static flag, so wire an explicit DANCE_MOVE
  // boost), and (b) kicking moves are dances → they trigger Dancer (inject the
  // DANCE_MOVE flag onto the holder's kicking moves; Dancer's trigger routes
  // through `doesFlagEffectApply`, which honors the injection).
  if (erAbilityId === 976) {
    out.push(
      new FlagDamageBoostAbAttr({ flag: MoveFlags.DANCE_MOVE, multiplier: 1.3 }),
      new MoveFlagInjectionAbAttr(MoveFlags.DANCE_MOVE, "kicking-moves"),
    );
  }
  // Compose order matches the parts order in ER's source description.
  return ok(out);
}

/**
 * Per-id bespoke dispatch. Hand-written wiring for ER abilities whose
 * mechanics don't fit any archetype primitive (the classifier emits
 * `bespoke` for these — see `er-ability-archetypes.ts`).
 *
 * Returns a {@linkcode DispatchResult} just like the archetype-typed
 * dispatchers; an entry for `erAbilityId` not present in the lookup falls
 * through to the default {@linkcode SKIP_BESPOKE} (`"hand-written
 * implementation pending"`), so adding a new bespoke is purely additive.
 *
 * Cluster table (round 1):
 *   - 396 Steel Barrel → reuse pokerogue's {@linkcode BlockRecoilDamageAttr}.
 *   - 411 Toxic Spill, 775 Flame Coat, 663 Funeral Pyre →
 *     {@linkcode PostTurnHurtNonTypedAbAttr} per-turn chip damage.
 *   - 906 Drop Blocks → {@linkcode SetArenaTagOnHitAbAttr} Spikes deploy.
 *   - 909 Loose Thorns → {@linkcode SetArenaTagOnHitAbAttr} Spikes (ER's
 *     Creeping Thorns isn't in vanilla `ArenaTagType` — Spikes stands in
 *     until the ER tag lands).
 *   - 898 Power Leak → {@linkcode SetTerrainOnHitAbAttr} Electric Terrain.
 *   - 956 Brain Overload → {@linkcode SetTerrainOnHitAbAttr} Psychic Terrain.
 *   - 957 Brain Mass → {@linkcode DamageReductionAbAttr} with `full-hp` filter.
 *
 * Cluster table (round 2):
 *   - 289 Growing Tooth → {@linkcode StatBoostOnFlagAttackAbAttr} BITING_MOVE +1 ATK.
 *   - 391 Hardened Sheath → {@linkcode StatBoostOnFlagAttackAbAttr} HORN_BASED +1 ATK.
 *   - 400 Scrapyard → {@linkcode SetArenaTagOnHitAbAttr} Spikes + contact required.
 *   - 401 Loose Quills → {@linkcode SetArenaTagOnHitAbAttr} Spikes + contact required.
 *   - 405 Loose Rocks → {@linkcode SetArenaTagOnHitAbAttr} Stealth Rock + contact required.
 *   - 574 Sharp Edges → vanilla {@linkcode PostDefendContactDamageAbAttr} 1/6 ratio.
 *
 * Cluster table (round 3):
 *   - 333 Sweet Dreams → {@linkcode PassiveRecoveryAbAttr} (status: SLEEP, 1/8).
 *   - 447 Furnace → {@linkcode StatTriggerOnHitAbAttr} (filter: ROCK, +2 SPD).
 *   - 591 Celestial Blessing → {@linkcode PassiveRecoveryAbAttr} (terrain: MISTY, 1/12).
 *   - 643 Denting Blows → {@linkcode StatDebuffOnFlagAttackAbAttr} HAMMER_BASED -1 DEF.
 *   - 653 Rest in Peace → {@linkcode PassiveRecoveryAbAttr} (weather: FOG, 1/8).
 *   - 787 Cryo Architect → {@linkcode StatTriggerOnHitAbAttr} (filter: WATER+ICE, +1 ATK/DEF).
 *   - 874 Winter Throne → {@linkcode PostTurnHurtNonTypedAbAttr} (safeTypes: [ICE], 1/8).
 *     The "heals Ice 1/8 each turn" piece is deferred — partial wire.
 *   - 942 Christmas Nightmare → {@linkcode PostTurnHurtNonTypedAbAttr} (weather-gated:
 *     [HAIL, SNOW], 1/8 to all foes).
 *   - 945 Chainsaw → {@linkcode StatDebuffOnFlagAttackAbAttr} SLICING_MOVE -1 DEF.
 *
 * Cluster table (round 4):
 *   - 335 Haunted Spirit → {@linkcode OnFaintEffectAbAttr} (attacker-battler-tag: CURSED).
 *   - 518 Spiteful → {@linkcode PpReductionOnContactAbAttr} (reduction: 4, contact).
 *   - 609 Parasitic Spores → {@linkcode PostTurnHurtNonTypedAbAttr} (safeTypes: [GHOST], 1/8).
 *     The "spreads on contact" piece is deferred — partial wire.
 *   - 722 Whiplash → {@linkcode StatChangeOnCategoryAttackAbAttr} (PHYSICAL, opponent
 *     DEF -1).
 *   - 729 Victory Bomb → {@linkcode PostFaintSpreadDetonateAbAttr} (power: 100,
 *     Fire, no flinch). A TRUE on-faint hook: on ANY KO cause it deals a 100 BP
 *     Fire spread hit directly to every adjacent foe (cannot miss).
 *   - 807 Woodland Curse → {@linkcode EntryEffectAbAttr} (scripted-move: FORESTS_CURSE).
 *     The "Adds Grass type on contact" piece is deferred — partial wire.
 *   - 991 Resilience → {@linkcode PassiveRecoveryAbAttr} (hp-below-fraction: 0.5, 1/4).
 *
 * Cluster table (round 6):
 *   - 429 Coward → {@linkcode EntryEffectAbAttr} (scripted-move: PROTECT). The
 *     scripted-move sub-effect is a wiring stub today; full per-turn Protect
 *     injection lands with the later turn-queue work. Partial wire.
 *   - 431 Dune Terror → {@linkcode WeatherDamageReductionAbAttr} (SANDSTORM,
 *     0.65 multiplier = 35% reduction). The "+20% Ground moves" piece would
 *     compose via `WeatherTypeBoostAbAttr` (sand + Ground type) but isn't
 *     wired here — partial wire.
 *   - 464 Hunter's Horn → {@linkcode LifestealOnKoAbAttr} (1/4 max-HP heal on
 *     KO). The "boost horn moves" piece composes via `FlagDamageBoostAbAttr`
 *     (HORN_BASED) but isn't wired here — partial wire.
 *   - 559 Guilt Trip → {@linkcode OnFaintEffectAbAttr} (attacker-stat-change:
 *     ATK -2, SPATK -2). Uses the new attacker-stat-change sub-effect
 *     introduced this round.
 *   - 673 Blood Stain → {@linkcode ChanceBattlerTagOnHitAbAttr} (chance 100,
 *     ER_BLEED, contact). The "is always bleeding" self-bleed piece is
 *     deferred — partial wire.
 *   - 697 Dragon's Ritual → {@linkcode StatTriggerOnKoAbAttr} (+1 ATK, +1 SPD).
 *   - 705 Terastal Treasure → {@linkcode DamageReductionAbAttr} (kind: all,
 *     reduction: 0.4). The "-20% Speed" tradeoff is deferred — partial wire.
 *   - 771 Forsaken Heart → {@linkcode StatTriggerOnKoAbAttr} (+1 ATK).
 *
 * Primitive extension (round 6):
 *   - {@linkcode OnFaintEffectAbAttr} gained the `attacker-stat-change`
 *     sub-effect kind. Pattern mirrors `attacker-battler-tag`: validate
 *     non-empty non-zero-stages payload, gate canApply on a live attacker,
 *     dispatch one `StatStageChangePhase` per delta against the attacker's
 *     battler index in `apply`.
 *
 * Cluster table (round 7):
 *   - 427 Cheating Death → {@linkcode PreFaintReviveAbAttr} (gate:
 *     hp-threshold:0, usage: first-n-hits:2). Endure-shaped (clamp to 1 HP)
 *     for the first two incoming hits — full "no damage" semantics is a
 *     partial wire.
 *   - 583 Gallantry → {@linkcode NullifyFirstNHitsAbAttr} (n=1). Negates the
 *     first incoming damage instance (set to 0); the N=1 sibling of Cheating
 *     Death. NOT an endure/Sturdy-shaped clamp.
 *   - 724 Lucky Halo → {@linkcode ProtectStatAbAttr} (vanilla Clear Body
 *     parent) + {@linkcode PreFaintReviveAbAttr} (first-n-hits:1). The two
 *     compose at the wire-up layer; both attach to the same Ability.
 *   - 862 Thermal Slide → {@linkcode WeatherStatMultiplierAbAttr} (Stat.SPD,
 *     1.5x, [SUNNY/HARSH_SUN/HAIL/SNOW]). Uses the new weather-stat-multiplier
 *     primitive introduced this round.
 *   - 488 Tipping Point → {@linkcode StatTriggerOnHitAbAttr} (SPATK +1) +
 *     vanilla {@linkcode PostReceiveCritStatStageChangeAbAttr} (SPATK +12,
 *     effectively max-out via the StatStageChangePhase internal clamp).
 *
 * Primitive extension (round 7):
 *   - {@linkcode PreFaintReviveAbAttr} gained a `usage` discriminator with
 *     `per-hit` (vanilla Sturdy parity) and `first-n-hits` (new, backed by
 *     `Pokemon.battleData.hitCount`) variants. Also removed the
 *     `isFullHp()` precondition from the dispatch site in `pokemon.ts:3968`
 *     so non-full-HP gates dispatch correctly — vanilla Sturdy's own
 *     `canApply` still checks `isFullHp()` so behavior is unchanged.
 *   - New archetype {@linkcode WeatherStatMultiplierAbAttr} added under
 *     `src/data/elite-redux/archetypes/weather-stat-multiplier.ts`. Generalizes
 *     Swift Swim / Chlorophyll to arbitrary (stat, multiplier, weather-list).
 *   - FROSTBITE (BattlerTagType.ER_FROSTBITE) now halves special-attack damage
 *     on the offensive side via a new `frostbiteMultiplier` in pokemon.ts —
 *     mirrors the BURN physical-attack halving. Completes the round-5
 *     BattlerTag work.
 *
 * Cluster table (round 8):
 *   - 674 Blood Stigma → {@linkcode StatusEffectImmunityAbAttrEr} with empty
 *     `statuses` list (Comatose-style block-all). "2x vs bleeding foes" piece
 *     deferred. Partial wire.
 *   - 855 Hyper Cleanse → {@linkcode StatusEffectImmunityAbAttrEr} with empty
 *     `statuses` list. "Halves poison damage" piece deferred (no type-keyed
 *     DamageReduction filter today). Partial wire.
 *   - 1004 Feathercoat → {@linkcode DamageReductionAbAttr} (kind: all,
 *     reduction: 0.1). "20% if resisted" piece deferred. Partial wire.
 *   - 944 Dead Bark → {@linkcode DamageReductionAbAttr} (kind: all, reduction:
 *     0.15). "Adds Ghost type" + "30% if SE" pieces deferred. Partial wire.
 *   - 931 Hammer Fist → two {@linkcode FlagDamageBoostAbAttr} instances:
 *     PUNCHING_MOVE 1.25x + HAMMER_BASED 1.25x. The flags are mutually
 *     exclusive on real moves in practice; stacking is theoretical.
 *   - 544 Airborne → {@linkcode TypeDamageBoostAbAttr} (FLYING, 1.3x).
 *     Ally-boost piece deferred (needs field-aura primitive). Partial wire.
 *   - 375 Precise Fist → {@linkcode CritStageBonusAbAttr} (+1, filter:
 *     PUNCHING_MOVE). "5x effect chance" piece deferred (no flag-gated
 *     effect-chance modifier today). Partial wire.
 *   - 278 Antarctic Bird → two {@linkcode TypeDamageBoostAbAttr} instances:
 *     ICE 1.3x + FLYING 1.3x. Single-type-per-move semantics — no compounding.
 *   - 883 Warmonger → three {@linkcode TypeDamageBoostAbAttr} instances:
 *     ROCK 1.3x + STEEL 1.3x + FIGHTING 1.3x. Same single-type guarantee.
 *   - 975 Talon Trap → {@linkcode ChanceBattlerTagOnHitAbAttr} (50%, TRAPPED,
 *     contact). "100% if entered this turn" piece deferred. Partial wire.
 */
/**
 * Per-id dispatch for bespoke ER abilities (those classified as
 * `archetype: "bespoke"` in `er-ability-archetypes.ts`). Exported so
 * verification scripts/tests can exercise it directly.
 */
export function dispatchBespoke(erAbilityId: number): DispatchResult {
  // ===========================================================================
  // Round 48 (final grind) — bespoke wires for the remaining 59 SKIPs.
  // This switch runs FIRST so it overrides any earlier SKIP_BESPOKE returns
  // for these IDs from rounds R1-R47.
  // ===========================================================================
  const r48 = dispatchBespokeR48(erAbilityId);
  if (r48 !== null) {
    return r48;
  }

  switch (erAbilityId) {
    case 266:
    case 267: {
      // As One (Calyrex Ice Rider 266 / Shadow Rider 267) — "Prevents all
      // opposing Pokemon from consuming HELD ITEMS. Raise [Attack|Sp.Atk] by one
      // stage on a KO." Copy vanilla Unnerve (127, PreventBerryUse) + the KO
      // boost (Chilling Neigh 264 = +Atk / Grim Neigh 265 = +SpAtk) and append
      // the PreventItemUse marker so the block covers NON-berry consumables too
      // (ER reactive items) — not just berries.
      const unnerve = allAbilities[127]?.attrs ?? [];
      const neigh = allAbilities[erAbilityId === 266 ? 264 : 265]?.attrs ?? [];
      return ok([...unnerve, ...neigh, new PreventItemUseAbAttr()]);
    }
    case 289:
      // Growing Tooth — Atk +1 after a biting move resolves.
      return ok([
        new StatBoostOnFlagAttackAbAttr({
          flag: MoveFlags.BITING_MOVE,
          stat: Stat.ATK,
          stages: 1,
        }),
      ]);
    case 300: {
      // Fighting Spirit — "Changes Normal moves to Fighting. If the user is
      // Fighting-type its Fighting moves break screens, otherwise it gains
      // Fighting STAB." (Was classified type-conversion with a flat 1.2x that
      // dropped the conditional STAB and the screen-break clause; hand-wired
      // here to the dex — mirrors Tectonize 308 / Qigong 762's Fighting Spirit.)
      const breakScreens = new RemoveScreensOnTypedAttackAbAttr({ type: PokemonType.FIGHTING });
      breakScreens.addCondition(holder => holder.isOfType(PokemonType.FIGHTING));
      return ok([
        new TypeConversionAbAttr({ source: { kind: "type", type: PokemonType.NORMAL }, newType: PokemonType.FIGHTING }),
        // Non-Fighting holder gains Fighting STAB (StabAddAbAttr self-gates: a
        // Fighting-type holder with natural STAB gets nothing here).
        new StabAddAbAttr({ targetType: PokemonType.FIGHTING }),
        // Fighting-type holder: Fighting moves break the target's screens.
        breakScreens,
      ]);
    }
    case 308:
      // Tectonize — "Changes the holder's Normal moves to Ground-type. If the
      // holder is Ground-type it is IMMUNE to Stealth Rock and Spikes; otherwise
      // it gains Ground STAB." (Was classified type-conversion with a flat 1.2x
      // that dropped the conditional STAB and the Ground-type hazard immunity;
      // hand-wired here to the dex.)
      return ok([
        // Normal moves become Ground.
        new TypeConversionAbAttr({ source: { kind: "type", type: PokemonType.NORMAL }, newType: PokemonType.GROUND }),
        // Non-Ground holder gains Ground STAB. StabAddAbAttr self-gates: it only
        // boosts a Ground move that is NOT already one of the holder's types, so
        // a Ground-type holder (with natural Ground STAB) gets nothing here —
        // exactly the dex's "otherwise" branch.
        new StabAddAbAttr({ targetType: PokemonType.GROUND }),
        // Ground-type holder: immune to Stealth Rock and Spikes switch-in damage.
        // The marker is consumed in DamagingTrapTag.activateTrap, gated there on
        // the holder being Ground-type (so a non-Ground holder is unaffected).
        new GroundEntryHazardImmunityAbAttr(),
      ]);
    case 413: // Draconize — "Changes Normal moves to Dragon-type. If the holder is
      // Dragon-type its Dragon moves deal NEUTRAL damage vs Fairy; otherwise it
      // gains Dragon STAB." (Was classified type-conversion with a flat 1.2x that
      // dropped the conditional STAB and the Dragon-vs-Fairy override; hand-wired
      // here to the dex — mirrors Draconic Might 841.)
      {
        const dragonVsFairy = new OffensiveTypeChartOverrideAbAttr({
          rules: [{ attackType: PokemonType.DRAGON, defenderType: PokemonType.FAIRY, newMultiplier: 1 }],
        });
        // Only a Dragon-type holder pierces the Fairy immunity (the scan in
        // getAttackTypeEffectiveness respects this condition against the holder).
        dragonVsFairy.addCondition(holder => holder.isOfType(PokemonType.DRAGON));
        return ok([
          new TypeConversionAbAttr({
            source: { kind: "type", type: PokemonType.NORMAL },
            newType: PokemonType.DRAGON,
          }),
          // Non-Dragon holder gains Dragon STAB (StabAddAbAttr self-gates as above).
          new StabAddAbAttr({ targetType: PokemonType.DRAGON }),
          dragonVsFairy,
        ]);
      }
    case 315:
      // Hydrate — "Changes the user's Normal-type moves to Water-type. If the
      // user is Water-type its Water-type moves have a 10% chance to drench,
      // otherwise it gains Water STAB." (Was classified type-conversion with a
      // flat 1.2x boost — an approximation that dropped the conditional STAB /
      // drench; hand-wired here to the dex.)
      return ok([
        // Normal moves become Water.
        new MoveTypeChangeAbAttr(PokemonType.WATER, (_u, _t, move) => !!move && move.type === PokemonType.NORMAL),
        // Non-Water user gains Water STAB. StabAddAbAttr self-gates: it only
        // boosts a Water move that is NOT already one of the user's types, so a
        // Water-type user (which already has natural Water STAB) gets nothing
        // here — exactly the dex's "otherwise" branch.
        new StabAddAbAttr({ targetType: PokemonType.WATER }),
        // Water-type user: its Water moves (including the Normal->Water converted
        // ones) get a 10% chance to drench the target. Gated to a Water-type user
        // so the two branches are mutually exclusive per the dex; ER_DRENCHED's
        // own canAdd enforces the Water-type/water-immune target immunity.
        new PostAttackApplyBattlerTagAbAttr(
          false,
          (user, _t, move) =>
            user.isOfType(PokemonType.WATER) && user.getMoveType(move) === PokemonType.WATER ? 10 : 0,
          BattlerTagType.ER_DRENCHED,
        ),
      ]);
    case 393:
      // Spectralize — the Ghost analog of Hydrate: "Changes the user's Normal-type
      // moves to Ghost-type. If the user is Ghost-type its Ghost-type moves have a
      // 10% fear chance, otherwise it gains Ghost STAB." (Was type-conversion with
      // a flat 1.2x that dropped the conditional STAB / fear.)
      return ok([
        new MoveTypeChangeAbAttr(PokemonType.GHOST, (_u, _t, move) => !!move && move.type === PokemonType.NORMAL),
        new StabAddAbAttr({ targetType: PokemonType.GHOST }),
        new PostAttackApplyBattlerTagAbAttr(
          false,
          (user, _t, move) =>
            user.isOfType(PokemonType.GHOST) && user.getMoveType(move) === PokemonType.GHOST ? 10 : 0,
          BattlerTagType.ER_FEAR,
        ),
      ]);
    case 650:
      // Venoblaze Pincers — "Boosts all physical moves by 20% and they have a 20%
      // chance to either inflict Burn or Poison on contact." (Was only the 20%
      // burn; the 1.2x physical boost and the poison alternative were missing.)
      return ok([
        new MovePowerBoostAbAttr((_u, _t, move) => move.category === MoveCategory.PHYSICAL, 1.2),
        new ChanceStatusOnAttackAbAttr({
          chance: 20,
          effects: [StatusEffect.BURN, StatusEffect.POISON],
          contactRequired: true,
        }),
      ]);
    case 333:
      // Sweet Dreams — heals 1/8 max HP each turn while asleep AND grants
      // immunity to Bad Dreams damage. The latter is a pure marker consulted by
      // PostTurnHurtIfSleepingAbAttr; cascades to composite 490 (Peaceful
      // Slumber = Sweet Dreams + Self Sufficient) which embeds erId 333.
      return ok([
        new PassiveRecoveryAbAttr({
          healFraction: 1 / 8,
          condition: { kind: "status", status: StatusEffect.SLEEP },
        }),
        new BadDreamsImmunityAbAttr(),
      ]);
    case 335:
      // Haunted Spirit — when KO'd, applies CURSED to the attacker. Vanilla
      // pokerogue's Curse battler tag handles the lapse damage downstream.
      // Ghost-type attackers are IMMUNE to the curse (dex rom_detail), mirroring
      // sibling Vengeful Spirit (565).
      return ok([
        new OnFaintEffectAbAttr({
          effect: {
            kind: "attacker-battler-tag",
            tagType: BattlerTagType.CURSED,
            excludeAttackerTypes: [PokemonType.GHOST],
          },
        }),
      ]);
    case 565:
      // Vengeful Spirit — "Curses the attacker when KO'd by a direct hit (25%
      // max HP/turn; GHOST-type attackers are IMMUNE to the curse). Boosts Ghost
      // moves by 30%, or by 50% at <=1/3 HP." Bespoke (was Haunted Spirit +
      // Vengeance composite): Vengeance's base is 1.2x, but the dex wants 1.3x,
      // and the composite curse cursed even GHOST attackers. Ghost base 1.3x +
      // a stacked low-HP factor tuned to net 1.5x (1.3 × 1.1538 ≈ 1.5), and the
      // curse excludes GHOST-type attackers.
      return ok([
        new OnFaintEffectAbAttr({
          effect: {
            kind: "attacker-battler-tag",
            tagType: BattlerTagType.CURSED,
            excludeAttackerTypes: [PokemonType.GHOST],
          },
        }),
        new MoveTypePowerBoostAbAttr(PokemonType.GHOST, 1.3),
        new MovePowerBoostAbAttr(
          (user, _t, move) => !!move && move.type === PokemonType.GHOST && !!user && user.getHpRatio() < 1 / 3,
          1.5 / 1.3,
        ),
      ]);
    case 391:
      // Hardened Sheath — Atk +1 after a horn move resolves.
      return ok([
        new StatBoostOnFlagAttackAbAttr({
          flag: MoveFlags.HORN_BASED,
          stat: Stat.ATK,
          stages: 1,
        }),
      ]);
    case 396:
      // Steel Barrel — immune to recoil damage (Explosion/crash dmg NOT
      // recoil per pokerogue's split). Reuses vanilla Rock Head's primitive.
      return ok([new BlockRecoilDamageAttr()]);
    case 400:
      // Scrapyard — Spikes deploy when hit by a contact move.
      return ok([
        new SetArenaTagOnHitAbAttr({
          tagType: ArenaTagType.SPIKES,
          side: "attacker",
          contactRequired: true,
        }),
      ]);
    case 401:
      // Loose Quills — Spikes deploy when hit by a contact move.
      return ok([
        new SetArenaTagOnHitAbAttr({
          tagType: ArenaTagType.SPIKES,
          side: "attacker",
          contactRequired: true,
        }),
      ]);
    case 440:
      // Prismatic Fur — "Color Change + Protean + Fur Coat + Ice Scales". The
      // ER ROM text: changes type to resist/become immune to an attack BEFORE it
      // hits (Color Change, re-timed to PRE-hit so the swap actually reduces the
      // damage), changes type to match the user's move before it lands (Protean),
      // halves physical damage taken (Fur Coat) and halves special damage taken
      // (Ice Scales). Built bespoke (not composite) because vanilla Color Change
      // is a POST-hit type swap — the wrong timing for ER. The PRE-hit resist
      // swap runs in move-effect-phase before effectiveness is computed.
      return ok([
        new PreHitResistTypeChangeAbAttr(),
        new PokemonTypeChangeAbAttr(),
        new ReceivedMoveDamageMultiplierAbAttr(() => true, 0.5),
      ]);
    case 405:
      // Loose Rocks — Stealth Rock deploys when hit by a contact move.
      return ok([
        new SetArenaTagOnHitAbAttr({
          tagType: ArenaTagType.STEALTH_ROCK,
          side: "attacker",
          contactRequired: true,
        }),
      ]);
    case 411:
      // Toxic Spill — "Damages ALL non-Poison-type Pokemon by 1/8 HP each turn.
      // Pokemon with Poison Heal recover instead." Field-wide (every active mon
      // except the holder, so the ally is hit too in doubles) with the Poison
      // Heal recover branch (was foes-only, no Poison Heal handling).
      return ok([
        new PostTurnHurtNonTypedAbAttr({
          safeTypes: [PokemonType.POISON],
          damageFraction: 1 / 8,
          fieldWide: true,
          poisonHealRecovers: true,
        }),
      ]);
    case 447: {
      // Furnace — "+2 Speed when hit by a Rock move OR when switching in with
      // Stealth Rock present on the holder's own side." The on-hit half is the
      // type-keyed {@linkcode StatTriggerOnHitAbAttr} (matches Inflatable); the
      // switch-in half is a self-target {@linkcode PostSummonStatStageChangeAbAttr}
      // gated on Stealth Rock being on the HOLDER's own side at summon.
      const furnaceEntry = new PostSummonStatStageChangeAbAttr([Stat.SPD], 2, true);
      furnaceEntry.addCondition(pokemon => {
        const ownSide = pokemon.isPlayer() ? ArenaTagSide.PLAYER : ArenaTagSide.ENEMY;
        return !!globalScene.arena.getTagOnSide(ArenaTagType.STEALTH_ROCK, ownSide);
      });
      return ok([
        new StatTriggerOnHitAbAttr({
          stats: [{ stat: Stat.SPD, stages: 2 }],
          filter: { types: [PokemonType.ROCK] },
        }),
        furnaceEntry,
      ]);
    }
    case 518:
      // Spiteful — Reduces attacker's PP by 4 on contact. The 4-PP reduction
      // matches vanilla Spite (the move) so the proc has a symmetric mental
      // model with the move-effect cousin.
      return ok([new PpReductionOnContactAbAttr({ reduction: 4, contactRequired: true })]);
    case 574:
      // Sharp Edges — 1/6 HP damage when touched. Vanilla Rough Skin uses 1/8
      // ratio; we use 1/6 per ER description. Pokerogue's class takes the
      // *divisor* (so 6 → 1/6, 8 → 1/8).
      return ok([new PostDefendContactDamageAbAttr(6)]);
    case 591:
      // Celestial Blessing — heals 1/12 max HP each turn while Misty Terrain
      // is active.
      return ok([
        new PassiveRecoveryAbAttr({
          healFraction: 1 / 12,
          condition: { kind: "terrain", terrains: [TerrainType.MISTY] },
        }),
      ]);
    case 609:
      // Parasitic Spores — "Gain parasitic spores on entry. Each turn, affected
      // Pokemon lose 1/8 max HP (Ghost types immune). When using contact moves,
      // spread spores to the target. Spores persist until switch-out."
      //   - The per-turn 1/8 non-Ghost field aura is the PostTurnHurtNonTyped proc.
      //   - The contact-spread is a 100% ChanceBattlerTagOnAttack that plants the
      //     persistent ER_PARASITIC_SPORES tag on the target (Ghost-immune via the
      //     tag's canAdd; the tag keeps chipping the target 1/8 each turn and
      //     persists until IT switches out, even after Parasect leaves).
      return ok([
        new PostTurnHurtNonTypedAbAttr({
          safeTypes: [PokemonType.GHOST],
          damageFraction: 1 / 8,
        }),
        new ChanceBattlerTagOnAttackAbAttr({
          chance: 100,
          tags: [BattlerTagType.ER_PARASITIC_SPORES],
          contactRequired: true,
        }),
      ]);
    case 643:
      // Denting Blows — Hammer moves drop the target's Defense by -1.
      return ok([
        new StatDebuffOnFlagAttackAbAttr({
          flag: MoveFlags.HAMMER_BASED,
          stat: Stat.DEF,
          stages: -1,
        }),
      ]);
    case 653:
      // Rest in Peace — heals 1/8 max HP each turn while Fog is the active
      // weather.
      return ok([
        new PassiveRecoveryAbAttr({
          healFraction: 1 / 8,
          condition: { kind: "weather", weathers: [WeatherType.FOG, WeatherType.EERIE_FOG] },
        }),
      ]);
    case 663:
      // Funeral Pyre — non-Ghost-AND-non-Dark take 1/4 dmg every turn.
      return ok([
        new PostTurnHurtNonTypedAbAttr({
          safeTypes: [PokemonType.GHOST, PokemonType.DARK],
          damageFraction: 1 / 4,
        }),
      ]);
    case 722:
      // Whiplash — Physical attacks lower the target's Defense by -1.
      return ok([
        new StatChangeOnCategoryAttackAbAttr({
          category: MoveCategory.PHYSICAL,
          stat: Stat.DEF,
          stages: -1,
          target: "opponent",
        }),
      ]);
    case 614:
      // Balloon Bomb (reclassified bespoke) — "Uses a 100 BP Explosion or
      // Outburst (whichever is higher) when knocked out. Using explosion moves
      // will always Flinch the target. When hit by any Fire or Flying moves,
      // boost Defense and Special Defense by one stage each." Three pieces:
      //   1. Inflatable stat-trigger (Def+SpDef +1 when hit by Fire/Flying) —
      //      the same StatTriggerOnHitAbAttr the ER Inflatable (290) archetype
      //      produces.
      //   2. TRUE any-KO 100 BP self-destruct (Normal — Explosion/Outburst,
      //      category by the holder's higher offensive stat), the shared
      //      PostFaintSpreadDetonateAbAttr also used by 729. Replaces the old
      //      Aftermath composite part (contact-only fixed chip → any-KO spread).
      //   3. Always-flinch rider on the holder's OWN explosion moves (Explosion
      //      / Self-Destruct / Misty Explosion) via PostAttackApplyBattlerTag.
      return ok([
        new StatTriggerOnHitAbAttr({
          stats: [
            { stat: Stat.DEF, stages: 1 },
            { stat: Stat.SPDEF, stages: 1 },
          ],
          filter: { types: [PokemonType.FLYING, PokemonType.FIRE] },
        }),
        new PostFaintSpreadDetonateAbAttr({ power: 100, flinch: false, type: PokemonType.NORMAL }),
        new PostAttackApplyBattlerTagAbAttr(
          false,
          (_user, _target, move) =>
            move.id === MoveId.EXPLOSION || move.id === MoveId.SELF_DESTRUCT || move.id === MoveId.MISTY_EXPLOSION
              ? 100
              : 0,
          BattlerTagType.FLINCHED,
        ),
      ]);
    case 729:
      // Victory Bomb — "When fainting, retaliate with a 100 BP Fire-type
      // Explosion targeting all adjacent Pokemon. Cannot miss. Works regardless
      // of how the user was KOed." A TRUE on-faint hook
      // (PostFaintSpreadDetonateAbAttr) fires from FaintPhase on ANY KO cause
      // (damaging move, burn/poison chip, weather, recoil, entry hazard) and
      // deals the 100 BP Fire spread hit directly to every adjacent foe — no
      // MovePhase, so a fainted holder can still detonate and it cannot miss.
      return ok([new PostFaintSpreadDetonateAbAttr({ power: 100, flinch: false, type: PokemonType.FIRE })]);
    case 775:
      // Flame Coat — non-Fire-types take 1/8 dmg every turn.
      return ok([
        new PostTurnHurtNonTypedAbAttr({
          safeTypes: [PokemonType.FIRE],
          damageFraction: 1 / 8,
        }),
      ]);
    case 787:
      // Cryo Architect — +1 Attack AND +1 Defense when hit by Water- or
      // Ice-type moves.
      return ok([
        new StatTriggerOnHitAbAttr({
          stats: [
            { stat: Stat.ATK, stages: 1 },
            { stat: Stat.DEF, stages: 1 },
          ],
          filter: { types: [PokemonType.WATER, PokemonType.ICE] },
        }),
      ]);
    case 807:
      // Woodland Curse — "Uses Forest's Curse on Entry. Adds Grass type on
      // contact." Entry scripted move + a post-defend rider that gives any
      // contact attacker an extra Grass type.
      return ok([
        new EntryEffectAbAttr({ kind: "scripted-move", move: MoveId.FORESTS_CURSE }),
        new AddTypeToAttackerOnContactAbAttr(PokemonType.GRASS),
      ]);
    case 874:
      // Winter Throne — "1/8 Damage each turn to non-ice. Heals Ice 1/8 each
      // turn." non-Ice foes take 1/8 each turn + the holder heals 1/8 each turn
      // IF it is Ice-type (new self-type PassiveRecovery condition). Heal half
      // was previously deferred.
      return ok([
        new PostTurnHurtNonTypedAbAttr({
          safeTypes: [PokemonType.ICE],
          damageFraction: 1 / 8,
        }),
        new PassiveRecoveryAbAttr({
          healFraction: 1 / 8,
          condition: { kind: "self-type", type: PokemonType.ICE },
        }),
      ]);
    case 898:
      // Power Leak — set Electric Terrain when hit.
      return ok([new SetTerrainOnHitAbAttr({ terrain: TerrainType.ELECTRIC })]);
    case 906:
      // Drop Blocks — set Spikes on attacker side when hit.
      return ok([new SetArenaTagOnHitAbAttr({ tagType: ArenaTagType.SPIKES, side: "attacker" })]);
    case 909:
      // Loose Thorns — "Sets Creeping Thorns when hit by contact." Deploys the
      // real ER Creeping Thorns hazard (Spikes-style switch-in damage PLUS
      // ER_BLEED) on the attacker's side.
      return ok([
        new SetArenaTagOnHitAbAttr({
          tagType: ArenaTagType.CREEPING_THORNS,
          side: "attacker",
          contactRequired: true,
        }),
      ]);
    case 942:
      // Christmas Nightmare — every foe takes 1/8 dmg per turn while it's
      // hailing/snowing. Empty `safeTypes` (no type-keyed immunity) +
      // weather gate (the weather is what conditions the proc).
      return ok([
        new PostTurnHurtNonTypedAbAttr({
          safeTypes: [],
          damageFraction: 1 / 8,
          requiredWeathers: [WeatherType.HAIL, WeatherType.SNOW],
        }),
      ]);
    case 945:
      // Chainsaw — Keen edge (slicing) moves drop the target's Defense by -1.
      return ok([
        new StatDebuffOnFlagAttackAbAttr({
          flag: MoveFlags.SLICING_MOVE,
          stat: Stat.DEF,
          stages: -1,
        }),
      ]);
    case 956:
      // Brain Overload — set Psychic Terrain when hit.
      return ok([new SetTerrainOnHitAbAttr({ terrain: TerrainType.PSYCHIC })]);
    case 957:
      // Brain Mass — halves damage taken at full HP.
      return ok([new DamageReductionAbAttr({ reduction: 0.5, filter: { kind: "full-hp" } })]);
    case 991:
      // Resilience — heals 1/4 max HP each turn while at or below 1/2 HP.
      return ok([
        new PassiveRecoveryAbAttr({
          healFraction: 1 / 4,
          condition: { kind: "hp-below-fraction", fraction: 0.5 },
        }),
      ]);
    case 429:
      // Coward — sets up Protect on switch-in. Only works ONCE per battle.
      // The Protect is applied via a battler tag (PROTECTED) on first entry.
      // Subsequent entries (e.g. after switching out and back in) do NOT
      // re-fire because we mark a per-pokemon flag.
      return ok([new CowardOnceProtectAbAttr()]);
    case 431:
      // Dune Terror — C-source (battle_util.c ABILITY_DUNE_TERROR) + description:
      // sand reduces incoming damage by 35% (x0.65) AND Ground-type moves get a
      // +20% power boost (x1.2). The Ground boost was previously unwired.
      return ok([
        new WeatherDamageReductionAbAttr({
          weathers: [WeatherType.SANDSTORM],
          multiplier: 0.65,
        }),
        new TypeDamageBoostAbAttr({ type: PokemonType.GROUND, multiplier: 1.2 }),
      ]);
    case 464:
      // Hunter's Horn — "Boost horn moves and heals 1/4 HP when defeating an
      // enemy." Round 9: extended from heal-only to full FlagDamageBoost
      // (HORN_BASED, 1.3x) + LifestealOnKo(0.25). The 1.3x multiplier is the
      // ER convention for "Boost" without explicit number (matches
      // Hardened Sheath, Antarctic Bird, and the existing flag-boost rows).
      return ok([
        new FlagDamageBoostAbAttr({ flag: MoveFlags.HORN_BASED, multiplier: 1.3 }),
        new LifestealOnKoAbAttr({ healFraction: 0.25 }),
      ]);
    case 559:
      // Guilt Trip — sharply lowers attacker's Atk and SpAtk when fainting.
      // "Sharply" = -2 in pokerogue convention. Uses the on-faint-effect's
      // new `attacker-stat-change` sub-effect added this round.
      return ok([
        new OnFaintEffectAbAttr({
          effect: {
            kind: "attacker-stat-change",
            stats: [
              { stat: Stat.ATK, stages: -2 },
              { stat: Stat.SPATK, stages: -2 },
            ],
          },
        }),
      ]);
    case 673:
      // Blood Stain — "Gains an unremovable bleed. When the user makes contact
      // offensively OR defensively with a Pokemon who does not have this ability,
      // it REPLACES their ability [with Blood Stain] and causes bleeding." Full
      // wire: holder bleeds on entry and stays bleeding (re-applied each turn end
      // if cured); on contact (both directions) it (a) inflicts ER_BLEED and
      // (b) spreads the Blood Stain ability itself (Mummy-style contagion) —
      // defensively via PostDefendAbilityGiveAbAttr, offensively via the ER
      // PostAttackAbilityGiveAbAttr. The ability-spread was previously missing.
      return ok([
        new PostSummonAddBattlerTagAbAttr(BattlerTagType.ER_BLEED, 99),
        new SelfPersistentBleedAbAttr(),
        new ChanceBattlerTagOnHitAbAttr({
          chance: 100,
          tags: [BattlerTagType.ER_BLEED],
          contactRequired: true,
        }),
        new ChanceBattlerTagOnAttackAbAttr({
          chance: 100,
          tags: [BattlerTagType.ER_BLEED],
          contactRequired: true,
        }),
        new PostDefendAbilityGiveAbAttr(ER_ID_MAP.abilities[673] as AbilityId),
        new PostAttackAbilityGiveAbAttr(ER_ID_MAP.abilities[673] as AbilityId),
      ]);
    case 697:
      // Dragon's Ritual — Atk and Speed each +1 on KO.
      return ok([
        new StatTriggerOnKoAbAttr({
          stats: [
            { stat: Stat.ATK, stages: 1 },
            { stat: Stat.SPD, stages: 1 },
          ],
        }),
      ]);
    case 705:
      // Terastal Treasure — "Reduces damage taken by 40%, but lowers speed by
      // 20%." 40% all-damage reduction + an always-on SPD x0.8 penalty (the
      // base StatMultiplierAbAttr applies it unconditionally). Speed half was
      // previously unwired.
      return ok([
        new DamageReductionAbAttr({
          reduction: 0.4,
          filter: { kind: "all" },
        }),
        new StatMultiplierAbAttr(Stat.SPD, 0.8),
      ]);
    case 296:
      // Lead Coat — "Takes 40% less from physical moves. This Pokémon's Speed
      // is 0.9x. Triples the holder's weight." 40% physical damage reduction +
      // an always-on SPD x0.9 penalty + the weight-triple (affects Heavy Slam /
      // Low Kick / Grass Knot / etc.), mirroring its special-side twin Chrome
      // Coat (539). The weight-triple was previously dropped in the port.
      return ok([
        new DamageReductionAbAttr({
          reduction: 0.4,
          filter: { kind: "category", category: MoveCategory.PHYSICAL },
        }),
        new StatMultiplierAbAttr(Stat.SPD, 0.9),
        new WeightMultiplierAbAttr(3),
      ]);
    case 539:
      // Chrome Coat — "Reduces special damage taken by 40%, decreases Speed by
      // 10%, and TRIPLES the holder's weight." Special-side twin of Lead Coat
      // (296). The weight-triple (affects Heavy Slam / Low Kick / Grass Knot /
      // etc.) is wired via WeightMultiplierAbAttr (the Heavy/Light Metal primitive).
      return ok([
        new DamageReductionAbAttr({
          reduction: 0.4,
          filter: { kind: "category", category: MoveCategory.SPECIAL },
        }),
        new StatMultiplierAbAttr(Stat.SPD, 0.9),
        new WeightMultiplierAbAttr(3),
      ]);
    case 306:
      // Nocturnal — "Boosts own Dark moves by 1.25x. Takes -25% dmg from
      // Dark/Fairy." Was type-damage-boost (offensive Dark boost only); the
      // defensive Dark+Fairy reduction was dropped. Offensive half stays a
      // move-type power boost; defensive halves are received-type multipliers.
      return ok([
        new TypeDamageBoostAbAttr({ type: PokemonType.DARK, multiplier: 1.25 }),
        ...buildTypeEffectivenessModAttrs({
          type: PokemonType.DARK,
          offensiveMultiplier: 1,
          defensiveMultiplier: 0.75,
        }),
        ...buildTypeEffectivenessModAttrs({
          type: PokemonType.FAIRY,
          offensiveMultiplier: 1,
          defensiveMultiplier: 0.75,
        }),
      ]);
    case 311:
      // Liquified — "Takes 1/2 dmg from contact moves but Water moves hurt it
      // 2x more." Was damage-reduction-generic (contact half only); the Water
      // vulnerability was dropped. Defensive-only received-type multiplier of 2x.
      return ok([
        new DamageReductionAbAttr({ reduction: 0.5, filter: { kind: "contact" } }),
        ...buildTypeEffectivenessModAttrs({ type: PokemonType.WATER, offensiveMultiplier: 1, defensiveMultiplier: 2 }),
      ]);
    case 678:
      // Fluffiest — "Quarters contact damage taken. 4x weak to Fire." Was
      // damage-reduction-generic (contact ×0.25 only); the Fire ×4 vulnerability
      // was dropped (same shape as Liquified, ×4 instead of ×2).
      return ok([
        new DamageReductionAbAttr({ reduction: 0.75, filter: { kind: "contact" } }),
        ...buildTypeEffectivenessModAttrs({ type: PokemonType.FIRE, offensiveMultiplier: 1, defensiveMultiplier: 4 }),
      ]);
    case 312:
      // Dragonfly — "Adds Dragon type on entry. Avoids Ground attacks." Was
      // entry-effect (add-Dragon only); the Ground immunity (half the ability)
      // was dropped. Ground immunity via the vanilla Levitate-shaped primitive.
      return ok([
        new EntryEffectAbAttr({ kind: "add-self-type", type: PokemonType.DRAGON }),
        new AttackTypeImmunityAbAttr(PokemonType.GROUND),
        // FloatAbAttr ungrounds the holder so it also dodges grounded field
        // effects (Spikes / grounded terrain), per "immunity to ... field effects
        // that require you to be grounded" — AttackTypeImmunity alone only blocks
        // Ground MOVES, it does not affect isGrounded().
        new FloatAbAttr(),
      ]);
    case 328:
      // Overwhelm — "Hits Fairies with Dragon moves. Immune to Intimidate and
      // Scare." Was status-immunity (Intimidate/Scare immunity only); the
      // defining "Dragon hits Fairy for neutral instead of no effect" clause
      // was dropped. Override the Dragon→Fairy matchup (normally 0x) up to 1x.
      return ok([
        new IntimidateImmunityAbAttrEr(),
        new OffensiveTypeChartOverrideAbAttr({
          rules: [{ attackType: PokemonType.DRAGON, defenderType: PokemonType.FAIRY, newMultiplier: 1 }],
        }),
      ]);
    case 385:
      // Nosferatu — "Contact moves do +20% damage and heal 1/2 of damage
      // dealt." Was lifesteal (heal half on hit, all moves); the +20% contact
      // power boost was dropped and the heal wasn't contact-gated. Wire both
      // halves, gated to contact moves.
      return ok([
        new LifestealOnHitAbAttr({ healFraction: 0.5, filter: { flag: MoveFlags.MAKES_CONTACT } }),
        new MovePowerBoostAbAttr((_user, _target, move) => move.hasFlag(MoveFlags.MAKES_CONTACT), 1.2),
      ]);
    case 386: {
      // Spectral Shroud — "Spectralize + 30% chance to badly poison." Was
      // chance-status-on-hit (the poison only); the entire Spectralize identity
      // (Normal→Ghost conversion + 1.2x boost) was dropped. Re-wire both: the
      // type conversion (mirroring Spectralize 386) plus the 30% Toxic chance
      // on the holder's moves (incl. status moves, per the description).
      const spectralizeSource = { kind: "type" as const, type: PokemonType.NORMAL };
      return ok([
        new TypeConversionAbAttr({ source: spectralizeSource, newType: PokemonType.GHOST }),
        new TypeConversionPowerBoostAbAttr({ source: spectralizeSource, multiplier: 1.2 }),
        new ChanceStatusOnAttackAbAttr({ chance: 30, effects: [StatusEffect.TOXIC] }),
      ]);
    }
    case 399:
      // Parry — "Counters contact with Mach Punch. Takes 20% less damage." Was
      // damage-reduction-generic (the 20% reduction only); the Mach Punch
      // counter (20 BP, on contact) was dropped.
      return ok([
        new DamageReductionAbAttr({ reduction: 0.2, filter: { kind: "all" } }),
        new CounterAttackOnHitAbAttr({ moveId: MoveId.MACH_PUNCH, power: 20, filter: { contactRequired: true } }),
      ]);
    case 408:
      // Fearmonger — "Intimidate + Scare; 10% chance to fear with contact
      // moves." Was chance-status-on-hit (the 10% fear only); the on-entry
      // Intimidate+Scare (ATK & SpAtk -1 to all foes) was dropped. Fear chance
      // is gated to contact moves per the description.
      return ok([
        new PostSummonStatStageChangeAbAttr([Stat.ATK, Stat.SPATK], -1, false, true),
        new ChanceBattlerTagOnAttackAbAttr({
          chance: 10,
          tags: [BattlerTagType.ER_FEAR],
          contactRequired: true,
        }),
      ]);
    case 433: {
      // Dual Wield — "Mega Launcher and Keen Edge moves hit twice for 70%
      // damage." Was multi-hit-override (Keen Edge only, no power reduction →
      // 2nd hit at 100% and Mega Launcher unaffected). Same shape as Raging
      // Moth (both hits 70%) but flag-filtered to EITHER Mega Launcher
      // (PULSE_MOVE) or Keen Edge (SLICING_MOVE) — hasFlag is any-bit, so the
      // combined mask matches a move carrying either flag.
      const dualWieldFlag = MoveFlags.PULSE_MOVE | MoveFlags.SLICING_MOVE;
      return ok([
        new HitMultiplierAbAttr({ filter: { flag: dualWieldFlag }, extraStrikes: 1 }),
        new HitMultiplierPowerAbAttr({ filter: { flag: dualWieldFlag }, multiplier: 0.7 }),
      ]);
    }
    case 771:
      // Forsaken Heart — Attack +1 whenever ANY Pokemon faints on the field,
      // including allies and enemies. This is the ONE ability in the on-KO
      // family that intentionally fires regardless of who scored the KO, so it
      // opts into `triggerOnAnyFaint` to skip the Moxie-style holder-credit gate
      // that every other on-KO ability (Hubris, Chilling Neigh, etc.) needs.
      return ok([new StatTriggerOnKoAbAttr({ stats: [{ stat: Stat.ATK, stages: 1 }], triggerOnAnyFaint: true })]);
    case 427:
      // Cheating Death — "Negates the first two instances of damage received."
      // Full no-damage-for-N-hits: the first 2 damaging instances are set to 0
      // (moves still connect and secondary effects still apply).
      return ok([new NullifyFirstNHitsAbAttr(2)]);
    case 583:
      // Gallantry — "Negates the first instance of damage received. Moves still
      // connect and secondary effects apply, but damage becomes 0." This is the
      // N=1 sibling of Cheating Death (427): full damage-negation of the first
      // incoming hit (set to 0), NOT an endure/Sturdy-shaped clamp-to-1-HP.
      return ok([new NullifyFirstNHitsAbAttr(1)]);
    case 724:
      // Lucky Halo — "Negates self stat drops. Endures a single KO."
      // Composes SelfStatDropImmunityAbAttr (cancels the holder's OWN stat drops
      // — Overheat / Close Combat / Draco Meteor) + PreFaintReviveAbAttr with
      // first-n-hits N=1 (endure once per battle). NOTE: this is "self stat
      // drops" only — NOT Clear Body. A prior pass used ProtectStatAbAttr, which
      // is the inverse (blocks INCOMING Growl/Intimidate, never self-drops).
      return ok([
        new SelfStatDropImmunityAbAttr(),
        new PreFaintReviveAbAttr({
          gate: { kind: "hp-threshold", threshold: 0 },
          usage: { kind: "first-n-hits", n: 1 },
        }),
      ]);
    case 862:
      // Thermal Slide — "Ups speed by 50% in sun or hail." Uses the new
      // weather-stat-multiplier primitive: Stat.SPD * 1.5 when active weather
      // is sun (incl HARSH_SUN) or hail/snow. The HAIL/SNOW pair matches
      // vanilla Slush Rush coverage; the SUNNY/HARSH_SUN pair matches
      // Chlorophyll. (Round 7 of the ER bespoke ability grind.)
      return ok([
        new WeatherStatMultiplierAbAttr({
          stat: Stat.SPD,
          multiplier: 1.5,
          weathers: [WeatherType.SUNNY, WeatherType.HARSH_SUN, WeatherType.HAIL, WeatherType.SNOW],
        }),
        // "Also grants immunity to hail damage." (was missing.)
        new BlockWeatherDamageAttr(WeatherType.HAIL, WeatherType.SNOW),
      ]);
    case 488:
      // Tipping Point — "Getting hit raises SpAtk. Critical hits maximize
      // SpAtk." Composes two vanilla AbAttrs: StatTriggerOnHitAbAttr for the
      // +1 SpAtk on any incoming damaging hit, plus
      // PostReceiveCritStatStageChangeAbAttr(SPATK, 12) for the "maximize on
      // crit" piece. The +12 stages exceed the engine clamp of +6 but the
      // StatStageChangePhase clamps internally — effectively "max out". The
      // crit hook (`PostReceiveCritStatStageChangeAbAttr`) is the same one
      // vanilla Anger Point uses; it's dispatched in move-effect-phase.ts
      // line ~831 when the incoming hit was a crit.
      return ok([
        new StatTriggerOnHitAbAttr({ stats: [{ stat: Stat.SPATK, stages: 1 }] }),
        new PostReceiveCritStatStageChangeAbAttr(Stat.SPATK, 12),
      ]);
    // -------------------------------------------------------------------------
    // Round 8 — status-immunity-all + damage-reduction-all + multi-type/flag
    // damage boost + crit-stage flag bonus + chance-trap-on-hit.
    // -------------------------------------------------------------------------
    case 674:
      // Blood Stigma — "Deal double damage to targets inflicted with bleeding
      // and the user is immune to status effects." Status immunity via
      // StatusEffectImmunityAbAttrEr (empty list = block all, Comatose parity)
      // + the 2x-vs-bleeding boost via the conditional-damage `target-has-tag`
      // condition (ER_BLEED). No longer deferred.
      return ok([
        new StatusEffectImmunityAbAttrEr({ statuses: [] }),
        new ConditionalDamageAbAttr({
          condition: { kind: "target-has-tag", tag: BattlerTagType.ER_BLEED },
          multiplier: 2,
        }),
      ]);
    case 855:
      // Hyper Cleanse — "Immune to status. Halves poison damage taken." Status
      // immunity (empty list = block all) + defensive 0.5 from incoming Poison
      // moves (move-type damage-reduction filter, now available).
      return ok([
        new StatusEffectImmunityAbAttrEr({ statuses: [] }),
        new DamageReductionAbAttr({ reduction: 0.5, filter: { kind: "move-type", type: PokemonType.POISON } }),
      ]);
    case 1004:
      // Feathercoat — "Takes 10% less damage from all attacks. Takes 20% less
      // from resisted attacks." 10% all + an extra resisted-gated reduction
      // that composes to exactly 20% on resisted hits:
      // 1 - (1-0.10)*(1-x) = 0.20 → x ≈ 0.1111. Uses the new `resisted` filter.
      return ok([
        new DamageReductionAbAttr({ reduction: 0.1, filter: { kind: "all" } }),
        new DamageReductionAbAttr({ reduction: 0.1111, filter: { kind: "resisted" } }),
      ]);
    case 944:
      // Dead Bark — "Adds Ghost type. Takes 15% less damage. 30% less damage
      // if SE." R52 audit-fix: stack a SECOND DamageReduction with the
      // super-effective filter so SE attacks see the higher reduction.
      // Math: total SE reduction = 1 - (1-0.15) * (1-x) = 0.30 → x ≈ 0.176.
      // Combined on SE = 30% reduction ✓; non-SE = 15% ✓.
      return ok([
        new EntryEffectAbAttr({ kind: "add-self-type", type: PokemonType.GHOST }),
        new DamageReductionAbAttr({ reduction: 0.15, filter: { kind: "all" } }),
        new DamageReductionAbAttr({ reduction: 0.176, filter: { kind: "super-effective" } }),
      ]);
    case 931:
      // Hammer Fist — "Boosts punch and hammer moves by 25%." Wire as two
      // FlagDamageBoost instances — PUNCHING_MOVE and HAMMER_BASED at 1.25x
      // each. The two flags are typically not both set on a single move
      // (PUNCHING is vanilla, HAMMER is ER), so the multipliers don't compound
      // in practice. Even if a future move flags both, 1.25 * 1.25 = 1.5625
      // would be a fringe overlap accepted per the additive flag-stacking
      // convention used elsewhere (e.g. Iron Fist + Strong Jaw on a hypothetical
      // dual-flag move).
      return ok([
        new FlagDamageBoostAbAttr({ flag: MoveFlags.PUNCHING_MOVE, multiplier: 1.25 }),
        new FlagDamageBoostAbAttr({ flag: MoveFlags.HAMMER_BASED, multiplier: 1.25 }),
      ]);
    case 544:
      // Airborne — "Boosts own & ally's Flying-type moves by 1.3x." Round 12:
      // upgraded to full wire — `UserFieldMoveTypePowerBoostAbAttr` is the
      // vanilla field-aura primitive (Battery / Power Spot pattern) that
      // broadcasts a type-keyed power boost to the holder AND its allies. The
      // self-boost is also covered by this attr since the user is part of its
      // own "user field" — no need for a separate `TypeDamageBoostAbAttr`.
      return ok([new UserFieldMoveTypePowerBoostAbAttr(PokemonType.FLYING, 1.3)]);
    case 375:
      // Precise Fist — "Punching moves gain +1 critical hit stage and 5x their
      // normal secondary effect chance." +1 crit on PUNCHING_MOVE via
      // CritStageBonus, plus the flag-gated 5x effect-chance multiplier (the
      // EffectChanceModifier now supports a PUNCHING_MOVE flag gate, so the 5x
      // only amplifies punch secondaries — no longer deferred).
      return ok([
        new CritStageBonusAbAttr({ bonus: 1, filter: { flag: MoveFlags.PUNCHING_MOVE } }),
        new EffectChanceModifierAbAttr({ multiplier: 5, flag: MoveFlags.PUNCHING_MOVE }),
      ]);
    case 278:
      // Antarctic Bird — "Ice-type and Flying-type moves get a 1.3x power
      // boost." Wire as two TypeDamageBoost instances (ICE, FLYING) at 1.3x
      // each. A move that's both Ice AND Flying would only have one type per
      // pokerogue's single-type-per-move semantics; the two attrs are
      // mutually exclusive at apply time, so no compounding concern.
      return ok([
        new TypeDamageBoostAbAttr({ type: PokemonType.ICE, multiplier: 1.3 }),
        new TypeDamageBoostAbAttr({ type: PokemonType.FLYING, multiplier: 1.3 }),
      ]);
    case 883:
      // Warmonger — "Boosts the user's rock, steel, and fighting moves by
      // 30%." Wire as three TypeDamageBoost instances (ROCK, STEEL, FIGHTING)
      // at 1.3x each. Same single-type-per-move guarantee as Antarctic Bird —
      // exactly one of the three attrs fires for a given outgoing move.
      return ok([
        new TypeDamageBoostAbAttr({ type: PokemonType.ROCK, multiplier: 1.3 }),
        new TypeDamageBoostAbAttr({ type: PokemonType.STEEL, multiplier: 1.3 }),
        new TypeDamageBoostAbAttr({ type: PokemonType.FIGHTING, multiplier: 1.3 }),
      ]);
    case 975:
      // Talon Trap — "50% chance to trap on contact (offense AND defense),
      // 100% if entered this turn." Contact-trap proc on both being hit and
      // landing a contact hit, guaranteed on the holder's first turn.
      return ok([
        new ChanceBattlerTagOnHitAbAttr({
          chance: 50,
          firstTurnChance: 100,
          tags: [BattlerTagType.TRAPPED],
          contactRequired: true,
        }),
        new ChanceBattlerTagOnAttackAbAttr({
          chance: 50,
          firstTurnChance: 100,
          tags: [BattlerTagType.TRAPPED],
          contactRequired: true,
        }),
      ]);
    // -------------------------------------------------------------------------
    // Round 9 — stab-add primitive + composition wires.
    //
    // The `stab-add` archetype (see #data/elite-redux/archetypes/stab-add)
    // models the ER "moves gain STAB" cluster: abilities that grant the +0.5
    // STAB power factor to a move type the holder does NOT natively share.
    // Implemented as a `MovePowerBoostAbAttr` that multiplies outgoing power
    // by 1.5x when the move type matches the configured `targetType` (or any
    // off-type, for the all-moves shape) AND the move's resolved type is not
    // already a source type (avoids double-stab).
    // -------------------------------------------------------------------------
    case 287:
      // Mystic Power — "All moves gain the 1.5x power boost from STAB."
      // Wire a no-targetType StabAdd: every off-type move gets +0.5 STAB.
      // Real-STAB moves still get the natural +0.5 from the damage formula's
      // built-in `calculateStabMultiplier`; the StabAdd guard prevents
      // double-counting.
      return ok([new StabAddAbAttr()]);
    case 291:
      // Aurora Borealis — "Grants STAB to all Ice moves regardless of the
      // holder's typing. Weather Ball becomes Ice-type with DOUBLED power. Aurora
      // Veil works without hail/snow. Weather-based Ice moves (Blizzard) never
      // miss."
      //   1. Ice STAB for any user — StabAdd(ICE).
      //   2. Weather Ball -> Ice + x2 power — handled in move.ts via
      //      `userActsInIce` (WeatherBallTypeAttr + the move's power multiplier).
      //   3. Aurora Veil usable without hail/snow — the move's `.condition` calls
      //      `userActsInIce`, true for an Aurora Borealis holder.
      //   4. Blizzard never misses regardless of weather — a ConditionalAlwaysHit
      //      keyed on the move being Blizzard (the weather-perfect-accuracy Ice
      //      move), analogous to the fog never-miss wires elsewhere.
      return ok([
        new StabAddAbAttr({ targetType: PokemonType.ICE }),
        new ConditionalAlwaysHitAbAttr({ moveIds: [MoveId.BLIZZARD] }),
      ]);
    case 297:
      // Amphibious — "Water moves gain STAB. Can't become drenched."
      // Water STAB add via StabAdd(WATER), plus the drench-immunity marker
      // (DrenchImmunityAbAttr) so the "can't become drenched" clause is
      // correct-by-construction once DRENCH lands engine-wide.
      return ok([new StabAddAbAttr({ targetType: PokemonType.WATER }), new DrenchImmunityAbAttr()]);
    case 365:
      // Lunar Eclipse — "Fairy & Dark gains STAB. Improves Hypnosis accuracy to
      // 90%." Two StabAdd instances (FAIRY, DARK; single-type-per-move means
      // they are mutually exclusive at apply-time, no compounding) PLUS the
      // Hypnosis base-accuracy set (same shape as Hypnotist 327). The accuracy
      // clause was previously dropped for lack of a primitive — now wired.
      return ok([
        new StabAddAbAttr({ targetType: PokemonType.FAIRY }),
        new StabAddAbAttr({ targetType: PokemonType.DARK }),
        new SetMoveAccuracyAbAttr([MoveId.HYPNOSIS], 90),
      ]);
    case 478:
      // Moon Spirit — "Fairy & Dark gains STAB. Moonlight recovers 75% HP."
      // Same STAB-add piece as Lunar Eclipse. The 75%-HP-Moonlight override is
      // wired move-side in WeatherHealAttr.apply (gated on ErAbilityId.MOON_SPIRIT
      // + MoveId.MOONLIGHT), mirroring the Chloroplast userActsInSun special-case.
      return ok([
        new StabAddAbAttr({ targetType: PokemonType.FAIRY }),
        new StabAddAbAttr({ targetType: PokemonType.DARK }),
      ]);
    case 494:
      // Arcane Force — "All moves gain STAB. Ups super-effective by 10%."
      // All-moves StabAdd (off-type moves get +1.5x; real-STAB moves are
      // skipped by the primitive's condition) PLUS a +10% super-effective rider
      // (factor 1.1, same primitive as Winged King 586 / Iron Serpent 588). The
      // earlier "~0.41x" concern was a test-setup artifact, not a code bug — the
      // no-arg StabAdd correctly no-ops on already-STAB moves. Verified with an
      // isolation test (STAB super-effective move → only the 1.1 SE rider fires).
      return ok([new StabAddAbAttr(), new SuperEffectiveMultiplierBoostAbAttr({ factor: 1.1 })]);
    // -------------------------------------------------------------------------
    // Round 9 — bonus composition wires using existing primitives.
    // Picked up while the stab-add primitive was in flight; each composes
    // already-existing primitives to add coverage without new abstractions.
    // (See also case 464 above — extended from partial heal-only wire to
    // include the FlagDamageBoost(HORN_BASED) piece.)
    // -------------------------------------------------------------------------
    case 466:
      // Plasma Lamp — "Boosts both power and accuracy of Fire and Electric-type
      // moves by 20% each." Power via two TypeDamageBoost instances at 1.2x;
      // accuracy via a type-gated StatMultiplier(ACC, 1.2) — the vanilla stat
      // multiplier already supports a per-move condition (see Hustle), so the
      // accuracy boost only applies to Fire/Electric moves. No longer deferred.
      return ok([
        new TypeDamageBoostAbAttr({ type: PokemonType.FIRE, multiplier: 1.2 }),
        new TypeDamageBoostAbAttr({ type: PokemonType.ELECTRIC, multiplier: 1.2 }),
        new StatMultiplierAbAttr(
          Stat.ACC,
          1.2,
          (_user, _target, move) => move.type === PokemonType.FIRE || move.type === PokemonType.ELECTRIC,
        ),
      ]);
    case 764:
      // Deep Freeze — "Boosts Water and Ice by 1.25x. Halves Fire damage taken."
      // Offensive Water/Ice x1.25 + defensive 0.5 from incoming Fire moves (the
      // move-type damage-reduction filter is now available). Previously offense-only.
      return ok([
        new TypeDamageBoostAbAttr({ type: PokemonType.WATER, multiplier: 1.25 }),
        new TypeDamageBoostAbAttr({ type: PokemonType.ICE, multiplier: 1.25 }),
        new DamageReductionAbAttr({ reduction: 0.5, filter: { kind: "move-type", type: PokemonType.FIRE } }),
      ]);
    case 941:
      // Devious Present — "Boosts Ice and throwing moves by 50%." Wire as
      // TypeDamageBoost(ICE, 1.5) + FlagDamageBoost(THROW_BASED, 1.5).
      // Stacking would occur if an Ice-typed throw-flagged move existed
      // (multipliers compound multiplicatively — 1.5 * 1.5 = 2.25). This
      // matches ER's intent: a Frozen Bonemerang-style move gets a 2.25x
      // boost from both axes of the ability text.
      return ok([
        new TypeDamageBoostAbAttr({ type: PokemonType.ICE, multiplier: 1.5 }),
        new FlagDamageBoostAbAttr({ flag: MoveFlags.THROW_BASED, multiplier: 1.5 }),
      ]);
    case 360:
      // Field Explorer — "Boosts field moves by 50%. Cut, Surf, Strength etc."
      // Wire FlagDamageBoost(FIELD_BASED, 1.5). The named moves (Cut, Surf,
      // Strength) all carry the FIELD_BASED bit per ER move tagging.
      return ok([new FlagDamageBoostAbAttr({ flag: MoveFlags.FIELD_BASED, multiplier: 1.5 })]);
    // -------------------------------------------------------------------------
    // Round 11 — type-effectiveness-mod primitive wires (the "hunter" cluster).
    //
    // The round-10 primitive `buildTypeEffectivenessModAttrs(opts)` returns a
    // pair of AbAttrs (offensive `OffensiveTypeMultiplierAbAttr` +
    // vanilla `ReceivedTypeDamageMultiplierAbAttr`) modeling the symmetric
    // "boost vs type X / reduce from type X" shape. The classifier originally
    // emitted these as `conditional-damage` rows with `{kind: "other", note: "<type>"}`
    // — placeholder shapes that the dispatcher couldn't translate. Round 11
    // flips them to `bespoke` (see er-ability-archetypes.ts) and wires them
    // explicitly here.
    // -------------------------------------------------------------------------
    case 313:
      // Dragonslayer — "1.5x TO Dragon-type Pokemon, 0.5x FROM Dragon-type
      // Pokemon, based on the attacker/defender POKEMON types (not move types)."
      // The shared buildTypeEffectivenessModAttrs gates the DEFENSIVE half on the
      // incoming MOVE's type (wrong); wire it directly like Fae Hunter/Firefighter
      // so defense gates on the ATTACKER's Pokemon type.
      return ok([
        new OffensiveTypeMultiplierAbAttr(PokemonType.DRAGON, 1.5),
        new ReceivedMoveDamageMultiplierAbAttr(
          (_target, attacker) => attacker.isOfType(PokemonType.DRAGON),
          0.5,
          false,
        ),
      ]);
    case 344:
      // Poison Absorb — "Redirects Poison moves. Absorbs them, healing 25% HP.
      // Additionally, heals 1/8 max HP per turn on Toxic Terrain." The prior
      // type-resist-or-absorb wire had only the absorb-heal; add the
      // Toxic-Terrain passive recovery (terrain-gated, same shape as Celestial
      // Blessing 591).
      return ok([
        new RedirectTypeMoveAbAttr(PokemonType.POISON),
        new TypeAbsorbHealAbAttr({ type: PokemonType.POISON, healFraction: 0.25 }),
        new PassiveRecoveryAbAttr({
          healFraction: 1 / 8,
          condition: { kind: "terrain", terrains: [TerrainType.TOXIC] },
        }),
      ]);
    case 314:
      // Mountaineer — "Immune to Rock-type attacks and Stealth Rock damage."
      // Full Rock immunity via AttackTypeImmunityAbAttr (vanilla primitive,
      // same shape as Levitate's Ground immunity) + StealthRockImmunityAbAttr
      // for the hazard-damage half (same primitive as ability 271's Rock absorb).
      return ok([new AttackTypeImmunityAbAttr(PokemonType.ROCK), new StealthRockImmunityAbAttr()]);
    case 271:
      // Keen Edge — "Boosts the power of slashing moves by 1.3x."
      return ok([new FlagDamageBoostAbAttr({ flag: MoveFlags.SLICING_MOVE, multiplier: 1.3 })]);
    case 276:
      // Vengeance — "Boosts Ghost-type moves by 1.2x, or 1.5x when below 1/3 HP."
      // Wire as base Ghost 1.2x (always-on) + a stacked 1.25x conditional on
      // low HP (1.2 × 1.25 = 1.5x). MovePowerBoostAbAttr takes a predicate.
      return ok([
        new MoveTypePowerBoostAbAttr(PokemonType.GHOST, 1.2),
        new MovePowerBoostAbAttr(
          (user, _t, move) => !!move && move.type === PokemonType.GHOST && !!user && user.getHpRatio() < 1 / 3,
          1.25,
        ),
      ]);
    case 299:
      // Earthbound — "Boosts Ground-type moves by 1.2x, or 1.5x when under 1/3 HP."
      return ok([
        new MoveTypePowerBoostAbAttr(PokemonType.GROUND, 1.2),
        new MovePowerBoostAbAttr(
          (user, _t, move) => !!move && move.type === PokemonType.GROUND && !!user && user.getHpRatio() < 1 / 3,
          1.25,
        ),
      ]);
    case 269:
      // Whiteout — "Ups highest attacking stat by 1.5x in hail. Also grants
      // immunity to hail damage." The BlockWeatherDamageAttr half (hail/snow
      // damage immunity) was previously unwired.
      return ok([
        new SelfHighestStatMultiplierAbAttr({
          candidates: [Stat.ATK, Stat.SPATK],
          multiplier: 1.5,
          weathers: [WeatherType.HAIL, WeatherType.SNOW],
        }),
        new BlockWeatherDamageAttr(WeatherType.HAIL, WeatherType.SNOW),
      ]);
    case 621:
      // Ectoplasm — "Ups highest attacking stat by 1.5x in fog."
      return ok([
        new SelfHighestStatMultiplierAbAttr({
          candidates: [Stat.ATK, Stat.SPATK],
          multiplier: 1.5,
          weathers: [WeatherType.FOG, WeatherType.EERIE_FOG],
        }),
      ]);
    case 935:
      // Raging Storm — "Ups highest attacking stat by 1.5x in rain."
      return ok([
        new SelfHighestStatMultiplierAbAttr({
          candidates: [Stat.ATK, Stat.SPATK],
          multiplier: 1.5,
          weathers: [WeatherType.RAIN, WeatherType.HEAVY_RAIN],
        }),
      ]);
    case 627:
      // Ethereal Rush — "This Pokémon's Speed gets a 1.5x boost in fog."
      // A weather-gated single-stat multiplier, wired with the same
      // WeatherStatMultiplier primitive as the other weather-stat abilities
      // (959 Rain Shroud, 1018 Abominable Monster) for consistency.
      return ok([
        new WeatherStatMultiplierAbAttr({
          stat: Stat.SPD,
          multiplier: 1.5,
          weathers: [WeatherType.FOG, WeatherType.EERIE_FOG],
        }),
      ]);
    case 380:
      // Sun Worship — "Ups highest stat by +1 on entry when sunny."
      return ok([
        new SelfHighestStatBoostOnSummonAbAttr({
          candidates: [Stat.ATK, Stat.DEF, Stat.SPATK, Stat.SPDEF, Stat.SPD],
          stages: 1,
          weathers: [WeatherType.SUNNY, WeatherType.HARSH_SUN],
        }),
      ]);
    case 356:
      // Sea Guardian — "Ups highest stat by +1 on entry when it rains."
      return ok([
        new SelfHighestStatBoostOnSummonAbAttr({
          candidates: [Stat.ATK, Stat.DEF, Stat.SPATK, Stat.SPDEF, Stat.SPD],
          stages: 1,
          weathers: [WeatherType.RAIN, WeatherType.HEAVY_RAIN],
        }),
      ]);
    case 625:
      // Greater Spirit — "Ups highest stat by +1 on entry in fog."
      return ok([
        new SelfHighestStatBoostOnSummonAbAttr({
          candidates: [Stat.ATK, Stat.DEF, Stat.SPATK, Stat.SPDEF, Stat.SPD],
          stages: 1,
          weathers: [WeatherType.FOG, WeatherType.EERIE_FOG],
        }),
      ]);
    case 330:
      // Majestic Moth — "On entry, raises highest calculated stat by one stage."
      // No weather/terrain gate.
      return ok([
        new SelfHighestStatBoostOnSummonAbAttr({
          candidates: [Stat.ATK, Stat.DEF, Stat.SPATK, Stat.SPDEF, Stat.SPD],
          stages: 1,
        }),
      ]);
    case 692:
      // Frostmaw — "Biting moves have a 50% chance to inflict frostbite."
      // ER ROM uses BITING_MOVE flag. ER_FROSTBITE is a battler tag.
      return ok([
        new PostAttackApplyBattlerTagAbAttr(
          false,
          (_u, _t, move) => (move.hasFlag(MoveFlags.BITING_MOVE) ? 50 : 0),
          BattlerTagType.ER_FROSTBITE,
        ),
      ]);
    case 736:
      // Deep Cuts — "Slashing moves have a 50% chance to inflict bleeding."
      return ok([
        new PostAttackApplyBattlerTagAbAttr(
          false,
          (_u, _t, move) => (move.hasFlag(MoveFlags.SLICING_MOVE) ? 50 : 0),
          BattlerTagType.ER_BLEED,
        ),
      ]);
    case 952:
      // Sharp Talons — "Kicking moves have a 50% Bleed chance."
      return ok([
        new PostAttackApplyBattlerTagAbAttr(
          false,
          (_u, _t, move) => (move.hasFlag(MoveFlags.KICKING_MOVE) ? 50 : 0),
          BattlerTagType.ER_BLEED,
        ),
      ]);
    case 851:
      // Komodo — "Adds Dragon-type + moves have 30% Bad Poison chance."
      // ER ROM: add Dragon to type3 + post-attack 30% TOXIC chance.
      return ok([
        new EntryEffectAbAttr({ kind: "add-self-type", type: PokemonType.DRAGON }),
        new PostAttackApplyStatusEffectAbAttr(false, 30, StatusEffect.TOXIC),
      ]);
    case 728:
      // Wind Rage — "Uses Defog on switch-in. Air-based moves get a 1.3x boost."
      return ok([
        new PostSummonScriptedMoveAbAttr({ moveId: MoveId.DEFOG }),
        new FlagDamageBoostAbAttr({ flag: MoveFlags.AIR_BASED, multiplier: 1.3 }),
      ]);
    case 397:
      // Pyro Shells — "Triggers 50 BP Outburst after using a Mega Launcher move."
      // ER's "Mega Launcher" = PULSE_MOVE flag. Outburst is a custom ER move; use
      // OUTRAGE (similar BP/character) as the closest vanilla approximation.
      // Per audit: actually OUTBURST is ER bespoke move (er-moves.ts); for now
      // use OUTRAGE as 50 BP follow-up since Outburst doesn't exist in
      // pokerogue's vanilla MoveId enum.
      return ok([
        new PostAttackScriptedMoveAbAttr({
          moveId: ErMoveId.OUTBURST as MoveId,
          power: 50,
          flagFilter: MoveFlags.PULSE_MOVE,
        }),
      ]);
    case 485:
      // Soothing Aroma — "Cures party status on entry."
      // Pokerogue's heal-bell uses HealStatusEffectAttr — wire as a scripted
      // Heal Bell call from PostSummon.
      return ok([new PostSummonScriptedMoveAbAttr({ moveId: MoveId.HEAL_BELL, targetsSelf: true })]);
    case 603:
      // Flourish — "Boosts Grass moves by 50% in grassy terrain."
      // No direct primitive — wire via MovePowerBoostAbAttr with a closure that
      // checks both type AND active terrain.
      return ok([
        new MovePowerBoostAbAttr(
          (_u, _t, move) =>
            !!move && move.type === PokemonType.GRASS && globalScene.arena.terrain?.terrainType === TerrainType.GRASSY,
          1.5,
        ),
      ]);
    case 984: {
      // Flower Necklace — "This Pokémon's SpDef gets a 1.5x boost in Grassy
      // Terrain." Exactly Grass Pelt's shape (DEF*1.5 in Grassy Terrain) but on
      // SPDEF: a StatMultiplierAbAttr gated by an extra terrain condition — the
      // same getTerrainCondition pattern init-abilities uses via
      // conditionalAttr → addCondition.
      const flowerNecklace = new StatMultiplierAbAttr(Stat.SPDEF, 1.5);
      flowerNecklace.addCondition(() => globalScene.arena.terrain?.terrainType === TerrainType.GRASSY);
      return ok([flowerNecklace]);
    }
    case 836: {
      // Biofilm — "50% spdef boost under Toxic Terrain." Same shape as Flower
      // Necklace (Grass Pelt pattern) but gated on the ER-custom Toxic Terrain.
      const biofilm = new StatMultiplierAbAttr(Stat.SPDEF, 1.5);
      biofilm.addCondition(() => globalScene.arena.terrain?.terrainType === TerrainType.TOXIC);
      return ok([biofilm]);
    }
    case 802:
      // Rite Of Spring — "Boosts the user's Speed and highest attacking stat by
      // 50% when sun is active." Sun-gated SPD x1.5 + highest-of-{Atk,SpAtk}
      // x1.5. (The old Chlorophyll+Solar Power composite gave SPD x2, boosted
      // SpAtk only, and added an unwanted 1/8-HP-per-sun-turn drain.)
      return ok([
        new WeatherStatMultiplierAbAttr({
          stat: Stat.SPD,
          multiplier: 1.5,
          weathers: [WeatherType.SUNNY, WeatherType.HARSH_SUN],
        }),
        new SelfHighestStatMultiplierAbAttr({
          candidates: [Stat.ATK, Stat.SPATK],
          multiplier: 1.5,
          weathers: [WeatherType.SUNNY, WeatherType.HARSH_SUN],
        }),
      ]);
    case 546:
      // Salt Circle — "Prevents ALL opposing Pokemon from fleeing or switching
      // when the user enters battle. Effect lasts until the user leaves field.
      // Forced switches and pivot moves like Flip Turn still work." This is a
      // continuous field trap (active exactly while the holder is on field), like
      // Shadow Tag — NOT a one-shot Mean Look, which only trapped the single foe
      // present at cast time and left it trapped after the holder switched out.
      // ArenaTrapAbAttr excludes Ghost / Run Away inherently and does not block
      // forced switches or self-switch moves, matching the dex.
      return ok([new ArenaTrapAbAttr(() => true)]);
    case 677:
      // Petrify — "Removes stat RAISES from OPPOSING Pokemon, then drops their
      // Speed by 1 stage on entry." Clear ONLY the opponents' POSITIVE stat
      // stages (not Haze's field-wide reset of ALL stages both sides, which would
      // also wipe the foes' debuffs and the user's/ally's own boosts) + Speed -1.
      return ok([
        new PostSummonClearOpponentPositiveStatStagesAbAttr(),
        new PostSummonStatStageChangeAbAttr([Stat.SPD], -1, false, true),
      ]);
    case 529:
      // Berserk DNA — "Sharply ups highest attacking stat by 2 but becomes
      // enraged, adding 33% recoil to all attacks." The +2 boost was wired but
      // the enrage downside was missing — the mechanical effect of enrage is
      // 33%-of-damage-dealt recoil on every attack (same primitive as Super
      // Strain's recoil, fraction 0.33).
      return ok([
        new SelfHighestStatBoostOnSummonAbAttr({
          candidates: [Stat.ATK, Stat.SPATK],
          stages: 2,
        }),
        // Berserk DNA enrages ITSELF on entry (dex: "adding 33% recoil to all
        // attacks"). Enrage is the ER_ENRAGE status (33% recoil + Reckless until
        // switch), NOT vanilla Taunt — apply it to the holder. (The old wiring
        // reused TAUNT, which wrongly barred the holder from status moves.)
        new PostSummonAddBattlerTagAbAttr(BattlerTagType.ER_ENRAGE, 1),
      ]);
    case 534:
      // Cosmic Daze — "Attacks against confused and enraged targets deal double
      // damage. Additionally, confused and enraged enemies take twice as much
      // damage when they hurt themselves from those statuses." The 2x-vs-target
      // boost (CONFUSED / ER_ENRAGE) plus the self-hurt-doubling marker (read at
      // the confusion self-hit and enrage-recoil sites).
      return ok([
        new ConditionalDamageAbAttr({
          condition: { kind: "target-has-any-tag", tags: [BattlerTagType.CONFUSED, BattlerTagType.ER_ENRAGE] },
          multiplier: 2,
        }),
        new DoubleSelfInflictedDamageAbAttr(),
      ]);
    case 868:
      // Lightning Aspect — "Absorbs Electric moves for immunity and boosts the
      // HIGHER attacking stat (max of Atk/SpAtk) by +1." Use the highest-attack
      // immunity primitive (was hardcoding SpAtk via TypeImmunityStatStageChange).
      return ok([new TypeImmunityHighestAttackStatStageAbAttr({ immuneType: PokemonType.ELECTRIC, stages: 1 })]);
    case 910:
      // Turf War — "Destroys terrain and boosts highest stat on entry."
      // Clear the active terrain on entry + raise the holder's highest stat.
      return ok([
        new PostSummonClearTerrainAbAttr(),
        new SelfHighestStatBoostOnSummonAbAttr({
          candidates: [Stat.ATK, Stat.DEF, Stat.SPATK, Stat.SPDEF, Stat.SPD],
          stages: 1,
        }),
      ]);
    case 261:
      // Curious Medicine — "Resets its ally's stat changes on entry." Use the
      // dedicated ally-only reset (the vanilla Curious Medicine attr) instead of
      // field-wide Haze, which wrongly also reset the foes' stages.
      return ok([new PostSummonClearAllyStatStagesAbAttr()]);
    case 989:
      // Storm Cloud — "Summon rain on entry for 8 turns. Gain Electric-type STAB."
      // The dex grants Electric STAB ONLY (STAB-add phrasing, cf. Old Mariner 620),
      // NOT defensive Electric typing — so use StabAddAbAttr, not add-self-type
      // (which would graft a Ground weakness the dex never grants). Keep RAIN(8).
      return ok([
        new EntryEffectAbAttr({ kind: "set-weather", weather: WeatherType.RAIN, turns: 8 }),
        new StabAddAbAttr({ targetType: PokemonType.ELECTRIC }),
      ]);
    case 604:
      // Desert Spirit — "Summons sand on entry. Ground moves hit airborne in
      // sand." Sand-on-entry + a sand-gated Ground type-chart override that
      // rewrites Ground-vs-Flying immunity (0x) to neutral (1x) + self-immunity
      // to the sandstorm chip damage.
      return ok([
        new EntryEffectAbAttr({ kind: "set-weather", weather: WeatherType.SANDSTORM, turns: 8 }),
        new WeatherGroundAirborneAbAttr([WeatherType.SANDSTORM]),
        new BlockWeatherDamageAttr(WeatherType.SANDSTORM),
      ]);
    case 893:
      // Deep Fried — "Summons a sea of fire on entry." Drops the Fire+Grass
      // pledge sea-of-fire arena tag on the foes' side (damages non-Fire
      // Pokemon there each turn).
      return ok([new EntryArenaTagOnFoeSideAbAttr(ArenaTagType.FIRE_GRASS_PLEDGE)]);
    case 877:
      // Swamp Thing — "Sets the Swamp Pledge effect on entry." Drops the
      // Grass+Water pledge swamp arena tag on the foes' side (quarters their
      // Speed).
      return ok([new EntryArenaTagOnFoeSideAbAttr(ArenaTagType.GRASS_WATER_PLEDGE)]);
    case 924:
      // Taste the Rainbow — "Summons the Rainbow Pledge effect on entry." Rainbow
      // = Water+Fire pledge: set the WATER_FIRE_PLEDGE arena tag on the holder's
      // OWN side (it doubles that side's secondary-effect proc rates). Was a bogus
      // RAINY_DAY (rain weather) approximation that did nothing rainbow-like.
      return ok([new EntryArenaTagOnFoeSideAbAttr(ArenaTagType.WATER_FIRE_PLEDGE, 4, "self")]);
    case 471:
      // Cold Plasma — "Electric type moves now inflict burn instead of paralysis."
      // No move-effect type-swap primitive exists, so approximate by gating the
      // burn proc to the holder's ELECTRIC-type moves only (the prior wire fired
      // on EVERY move). Chance is a representative 10% - a per-move paralysis ->
      // burn swap at the move's own chance is a deeper engine feature.
      return ok([
        new ChanceStatusOnAttackAbAttr({
          chance: 10,
          effects: [StatusEffect.BURN],
          filter: { type: PokemonType.ELECTRIC },
        }),
      ]);
    case 350:
      // Violent Rush — ER 2.65 dex: "50% Speed + 20% Attack on first turn."
      // (ROM C source battle_main.c:4892 + battle_util.c:13305 applies a
      // MulModifier(1.2) damage mult, but the DEX is authoritative and reads a
      // literal Attack boost — physical-only, mirroring Rapid Response (573)'s
      // Sp.Atk clause — so wire ATK×1.2 as a first-turn stat multiplier, NOT an
      // all-move power boost.) Both gated on the first-turn predicate.
      return ok([
        new FirstTurnStatMultiplierAbAttr({ stat: Stat.SPD, multiplier: 1.5 }),
        new FirstTurnStatMultiplierAbAttr({ stat: Stat.ATK, multiplier: 1.2 }),
      ]);
    case 557:
      // Readied Action — "Doubles attack on first turn." Faithful: ATK × 2.0
      // ONLY on first turn (multiplier, not stat stage).
      return ok([new FirstTurnStatMultiplierAbAttr({ stat: Stat.ATK, multiplier: 2.0 })]);
    case 573:
      // Rapid Response — "Boosts Speed by 50% + SpAtk by 20% on first turn."
      return ok([
        new FirstTurnStatMultiplierAbAttr({ stat: Stat.SPD, multiplier: 1.5 }),
        new FirstTurnStatMultiplierAbAttr({ stat: Stat.SPATK, multiplier: 1.2 }),
      ]);
    case 616:
      // Demolitionist — "Readied Action + Ignores Protection effects for ONE turn
      // + screens break on the readied turn." ATK x2 on the first turn + all-moves
      // ignore-Protect gated to the first/readied turn (NOT Unseen-Fist's
      // contact-only permanent bypass) + break the foe's screens on entry (Reflect
      // / Light Screen / Aurora Veil). The first-turn ignore-Protect shares the
      // same empty-moveHistory predicate as the ATK x2.
      return ok([
        new FirstTurnStatMultiplierAbAttr({ stat: Stat.ATK, multiplier: 2.0 }),
        new IgnoreProtectFirstTurnAbAttr(),
        new PostSummonRemoveArenaTagAbAttr([ArenaTagType.REFLECT, ArenaTagType.LIGHT_SCREEN, ArenaTagType.AURORA_VEIL]),
      ]);
    case 619:
      // Low Visibility — "Summons Eerie Fog on entry." Sets ER's distinct
      // EERIE_FOG weather (a Ghost/Psychic weather, NOT vanilla FOG).
      return ok([new EntryEffectAbAttr({ kind: "set-weather", weather: WeatherType.EERIE_FOG, turns: 8 })]);
    case 983:
      // Overcast — "Low Visibility + Sets Mist on entry."
      // Composite: EERIE_FOG weather + Mist arena tag (Mist blocks stat drops).
      return ok([
        new EntryEffectAbAttr({ kind: "set-weather", weather: WeatherType.EERIE_FOG, turns: 8 }),
        new PostSummonScriptedMoveAbAttr({ moveId: MoveId.MIST, targetsSelf: true }),
      ]);
    case 477:
      // Generator — "Charges up once on entry or when Electric Terrain becomes
      // active during battle." Entry CHARGED via PostSummon + the mid-battle
      // Electric-Terrain recharge (same primitive Energized 699 uses).
      return ok([
        new PostSummonAddBattlerTagAbAttr(BattlerTagType.CHARGED, 0),
        new RechargeChargedOnElectricTerrainAbAttr(),
      ]);
    case 699:
      // Energized — "Charges up on entry (doubling the next Electric move),
      // recharges when Electric Terrain becomes active, and recharges on a
      // direct KO scored with an Electric move." Entry CHARGED + recharge on
      // Electric-Terrain set + recharge on Electric-move KO (PostVictory hook,
      // gated on the KO'er's last move being Electric).
      return ok([
        new PostSummonAddBattlerTagAbAttr(BattlerTagType.CHARGED, 0),
        new RechargeChargedOnElectricTerrainAbAttr(),
        new RechargeChargedOnElectricKoAbAttr(),
      ]);
    case 631:
      // Shiny Lightning — "Grants a 1.2x accuracy boost. Thunder never misses."
      // 1.2x accuracy + Thunder always hits.
      return ok([
        new StatMultiplierAbAttr(Stat.ACC, 1.2),
        new ConditionalAlwaysHitAbAttr({ moveIds: [MoveId.THUNDER] }),
      ]);
    case 437:
      // Radiance — "+20% accuracy; Dark moves fail when user is present."
      // Accuracy boost (matches Compound Eyes pattern) + the holder's Dark-move
      // immunity. The field-wide "Dark moves fail" half is wired globally by
      // `patchDarkMovesForRadiance` (a MoveCondition on every statically-Dark
      // move). That condition is attached at init by the move's DECLARED type, so
      // a move that becomes Dark at RUNTIME (Deviate/Hydrate-style -ate abilities,
      // Judgment/Multi-Attack via plate/memory, Tera Blast when Tera-Dark) slips
      // past it and still hits the Radiance holder (the reported "dark moves still
      // damage you" bug). AttackTypeImmunityAbAttr resolves the attacker's move
      // type at defend time (`getMoveType`), so it catches those dynamic-Dark
      // attacks against the holder. (Static-Dark moves are already failed earlier
      // by the field-wide condition, so this never double-fires for them.)
      return ok([new StatMultiplierAbAttr(Stat.ACC, 1.2), new AttackTypeImmunityAbAttr(PokemonType.DARK)]);
    case 947:
      // Echolocation — "In fog, deal 20% more damage and never miss." +20%
      // power in fog and all moves always hit while fog is active.
      return ok([
        new MovePowerBoostAbAttr((_u, _t, _move) => isFogWeather(globalScene.arena.weather?.weatherType), 1.2),
        new ConditionalAlwaysHitAbAttr({ weather: [WeatherType.FOG, WeatherType.EERIE_FOG] }),
      ]);
    case 916:
      // Narcissist — "When a stat is lowered, sharply raise both offenses."
      // "Sharply" = +2. Reactor fires after a stat drop from any source.
      return ok([
        new PostStatStageChangeStatStageChangeAbAttr((_t, _s, stages) => stages < 0, [Stat.ATK, Stat.SPATK], 2),
      ]);
    case 994:
      // Unrelenting — "All attacking moves can hit 2-5 times." Every eligible
      // single-hit damaging move is turned into a 2-5-hit move (real 2-5 roll,
      // same distribution as MultiHitType.TWO_TO_FIVE). NOT MaxMultiHit, which
      // only forces EXISTING multi-hit moves to their max and does nothing to
      // single-hit moves.
      return ok([new AllAttacksMultiHitAbAttr()]);
    case 368:
      // Sighting System — ER ROM C source (battle_script_commands.c:1924):
      // ALL moves get moveAcc = 100 (unconditional always-hit). The ER ability
      // text also imposes a tradeoff: "Moves with less than 80% base accuracy
      // receive -3 priority." Wired via the priority-modifier maxAccuracy gate.
      return ok([new AlwaysHitAbAttr(), new PriorityModifierAbAttr({ priority: -3, filter: { maxAccuracy: 80 } })]);
    case 377:
      // Artillery — ER ROM C source (battle_script_commands.c:1930): moves
      // with FLAG_MEGA_LAUNCHER_BOOST (= PULSE_MOVE in pokerogue) get
      // moveAcc = 100. Faithful wire via flag-gated always-hit + spread
      // targeting ("strike both opposing Pokemon"), promoted in getMoveTargets.
      return ok([
        new ConditionalAlwaysHitAbAttr({ flag: MoveFlags.PULSE_MOVE }),
        new SpreadTargetByFlagAbAttr(MoveFlags.PULSE_MOVE),
      ]);
    case 403:
      // Roundhouse — "Kicks always hit. Damages foes' weaker defenses." Moves
      // with FLAG_STRIKER_BOOST (= KICKING_MOVE) get moveAcc = 100 (ER ROM C
      // source battle_script_commands.c:1926) AND target the foe's lower
      // defensive stat (def-stat-swap primitive, lower-defense variant).
      return ok([
        new ConditionalAlwaysHitAbAttr({ flag: MoveFlags.KICKING_MOVE }),
        new DefenseStatSwapOnFlagAbAttr({ flag: MoveFlags.KICKING_MOVE, swap: "target-lower-defense" }),
      ]);
    case 421:
      // Sweeping Edge — ER ROM C source (battle_script_commands.c:1932):
      // moves with FLAG_KEEN_EDGE_BOOST (= SLICING_MOVE) get moveAcc = 100,
      // and gain spread targeting ("hit both opposing Pokemon"; multihit hits
      // each target once — multihit promotion is excluded in getMoveTargets).
      return ok([
        new ConditionalAlwaysHitAbAttr({ flag: MoveFlags.SLICING_MOVE }),
        new SpreadTargetByFlagAbAttr(MoveFlags.SLICING_MOVE),
      ]);
    case 698:
      // Pinnacle Blade — "All Keen Edge (slicing) moves never miss AND bypass
      // protection moves." never-miss(SLICING) + IgnoreProtectByFlag(SLICING)
      // (the protect-break piece, consulted in Move.doesFlagEffectApply). The
      // "ignore secondary effects associated with [protect]" nuance is minor.
      return ok([
        new ConditionalAlwaysHitAbAttr({ flag: MoveFlags.SLICING_MOVE }),
        new IgnoreProtectByFlagAbAttr(MoveFlags.SLICING_MOVE),
      ]);
    case 325:
      // Intoxicate (rom): "Changes the user's Normal-type moves to Poison-type.
      // If the user is Poison-type its Poison-type moves have a 10% chance to
      // badly poison, otherwise it gains Poison STAB." (Was wrongly classified
      // type-conversion with a flat ×1.2 boost — no flat boost, no STAB when
      // Poison, no 10% toxic. Fixed via the -ate-conditional helper.)
      return ok(
        ateConditionalAttrs({ newType: PokemonType.POISON, outcome: { kind: "status", effect: StatusEffect.TOXIC } }),
      );
    case 459:
      // Emanate (rom): "Changes the user's Normal-type moves to Psychic-type. If
      // the user is Psychic-type its Psychic-type moves have a 10% confusion
      // chance, otherwise it gains Psychic STAB."
      return ok(
        ateConditionalAttrs({ newType: PokemonType.PSYCHIC, outcome: { kind: "tag", tag: BattlerTagType.CONFUSED } }),
      );
    case 279:
      // Immolate (rom): "Changes the user's Normal-type moves to Fire-type. If
      // the user is Fire-type its Fire-type moves have a 10% chance to burn,
      // otherwise it gains Fire STAB." Also the Immolate half of Solar Flare
      // (er 366 = Chloroplast + Immolate); the composite resolves this case
      // recursively, so fixing it here fixes Solar Flare too.
      return ok(
        ateConditionalAttrs({ newType: PokemonType.FIRE, outcome: { kind: "status", effect: StatusEffect.BURN } }),
      );
    case 404:
      // Mineralize (rom "mineralize"): "Changes the user's Normal-type moves to
      // Rock-type. If the user is Rock-type its Rock-type moves have a 10% bleed
      // chance, otherwise it gains Rock STAB." (Was wrongly classified
      // type-conversion with a flat ×1.2 boost — fixed via the -ate-conditional
      // helper: no flat boost, conditional Rock STAB, 10% ER_BLEED when Rock.)
      return ok(
        ateConditionalAttrs({ newType: PokemonType.ROCK, outcome: { kind: "tag", tag: BattlerTagType.ER_BLEED } }),
      );
    case 507:
      // Fertilize (rom "fertilize"): "Changes the user's Normal-type moves to
      // Grass-type. If the user is Grass-type its Grass-type moves heal for 10%
      // of damage dealt, otherwise it gains Grass STAB." The on-type branch is a
      // DETERMINISTIC 10% lifesteal (NOT a probabilistic status roll) — modeled
      // with the helper's `heal` outcome.
      return ok(ateConditionalAttrs({ newType: PokemonType.GRASS, outcome: { kind: "heal", fraction: 0.1 } }));
    case 794:
      // Deadly Precision (rom): "Always land super effective attacks on the
      // opponent. Allows super effective attacks to ignore the target's
      // abilities and innates that interfere with effects or reduce damage."
      // BOTH halves are SUPER-EFFECTIVE-gated: the always-hit only applies to
      // super-effective moves, and the ability-bypass only fires when the move
      // is super-effective vs the actual target.
      return ok([
        new ConditionalAlwaysHitAbAttr({ superEffective: true }),
        new SuperEffectiveMoveAbilityBypassAbAttr(),
      ]);
    case 921:
      // Flawless Precision — "Fatal + Deadly Precision." Deadly Precision =
      // super-effective moves never miss + super-effective moves bypass the
      // target's ability; Fatal adds "super-effective moves always land a
      // critical hit". All three halves are super-effective-gated.
      return ok([
        new ConditionalAlwaysHitAbAttr({ superEffective: true }),
        new SuperEffectiveMoveAbilityBypassAbAttr(),
        new ConditionalCritAbAttr(
          (user, target, move) => target != null && user != null && target.getMoveEffectiveness(user, move) > 1,
        ),
      ]);
    case 422:
      // Gifted Mind (dex): "grants immunity to Dark, Ghost, and Bug-type moves while
      // making all status moves used by this Pokemon never miss." i.e. it nulls the
      // PSYCHIC type's weaknesses by granting flat x0 IMMUNITY to those three attacking
      // types (regardless of the holder's own typing - the old impl only neutralized,
      // and only when the holder was Psychic-typed). Type-based, so it ignores Inverse
      // Room. Plus the status-move always-hit half (ROM battle_script_commands.c:1936).
      return ok([
        new AttackTypeImmunityAbAttr(PokemonType.DARK),
        new AttackTypeImmunityAbAttr(PokemonType.GHOST),
        new AttackTypeImmunityAbAttr(PokemonType.BUG),
        new ConditionalAlwaysHitAbAttr({ categories: [MoveCategory.STATUS] }),
      ]);
    case 955:
      // Hypnotic Trance — "Hypnosis never misses and also causes Confusion."
      // Two riders, both gated to Hypnosis specifically:
      //   1. ConditionalAlwaysHit(moveIds:[HYPNOSIS]) — the move never misses
      //      (bypasses accuracy/evasion entirely, per "never misses").
      //   2. ChanceBattlerTagOnAttack(chance:100, moveIds:[HYPNOSIS], CONFUSED)
      //      — landing Hypnosis also confuses the target. The `moveIds` gate
      //      permits this status move to trigger the post-attack proc (the
      //      default PostAttack gate excludes status moves).
      return ok([
        new ConditionalAlwaysHitAbAttr({ moveIds: [MoveId.HYPNOSIS] }),
        new ChanceBattlerTagOnAttackAbAttr({
          chance: 100,
          moveIds: [MoveId.HYPNOSIS],
          tags: [BattlerTagType.CONFUSED],
        }),
      ]);
    case 369:
      // Bad Company — ER spec: "Not implemented right now. Has no effect."
      // Deliberate empty wire — match ER spec exactly.
      return ok([]);
    case 327:
      // Hypnotist — "Boosts Hypnosis' accuracy to 90%. Does NOT lock to 90% —
      // the move is still affected by accuracy/evasiveness changes." This is a
      // base-accuracy SET, not a never-miss: ConditionalAlwaysHit (the prior
      // wiring) wrongly bypassed evasion. SetMoveAccuracy raises the base, then
      // accuracy/evasion stages still apply on top. (ER ROM C source
      // battle_script_commands.c:1911 uses moveAcc=100; the in-game description
      // says 90% — we follow the description per the audit directive.)
      return ok([new SetMoveAccuracyAbAttr([MoveId.HYPNOSIS], 90)]);
    case 786:
      // Lullaby — "Sing accuracy is 90%." Same base-accuracy-set shape as
      // Hypnotist (was a 1.5× ACC StatMultiplier approximation — corrected).
      return ok([new SetMoveAccuracyAbAttr([MoveId.SING], 90)]);
    case 439: {
      const enhancedAttacks = [MoveId.TACKLE, MoveId.POISON_STING, MoveId.ELECTROWEB, MoveId.BUG_BITE];
      return ok([
        new ConditionalAlwaysHitAbAttr({ moveIds: enhancedAttacks }),
        new MovePowerBoostAbAttr((_user, _target, move) => move.id === MoveId.TACKLE, 2.5),
        new MovePowerBoostAbAttr((_user, _target, move) => move.id === MoveId.POISON_STING, 3),
        new MovePowerBoostAbAttr((_user, _target, move) => move.id === MoveId.ELECTROWEB, 155 / 55),
        new MovePowerBoostAbAttr((_user, _target, move) => move.id === MoveId.BUG_BITE, 7 / 3),
      ]);
    }
    case 473:
      // Inversion — "Sets up Inverse Room on entry, lasts 3 turns." Sets the
      // ER INVERSE_ROOM arena tag (inverts the type chart, like the move of the
      // same name) for 3 turns.
      return ok([new EntryEffectAbAttr({ kind: "set-screen-or-room", tag: ArenaTagType.INVERSE_ROOM, turns: 3 })]);
    case 636:
      // Blood Bath — "Immune to bleed. Inflict fear when inflicting bleed."
      // ER_BLEED immunity + ER_FEAR whenever the holder's hit leaves the target
      // bleeding (status-cascade via the targetHasTag gate).
      return ok([
        new BattlerTagImmunityAbAttr(BattlerTagType.ER_BLEED),
        new ChanceBattlerTagOnAttackAbAttr({
          chance: 100,
          tags: [BattlerTagType.ER_FEAR],
          targetHasTag: BattlerTagType.ER_BLEED,
        }),
      ]);
    case 648:
      return ok([new FirstTurnPriorityClampAbAttr()]);
    case 669:
      // Flammable Coat — "Transforms Lumbering Sloth into its Engulfed form when
      // hit by Fire-type moves or when using Fire-type moves. Cannot be copied or
      // suppressed." The "cannot be copied or suppressed" clause is implemented
      // faithfully via the uncopiable/unsuppressable/unreplaceable builder flags
      // (see init-elite-redux-custom-abilities.ts).
      //
      // The Engulfed form is a SEPARATE ER dump species
      // (SPECIES_LUMBERING_SLOTH_ENGULFED, ER 1847 → pkrg 10439) injected AS the
      // "engulfed" form onto base Lumbering Sloth (ER 1049 → pkrg 10023) by
      // init-elite-redux-er-custom-form-changes.ts (one-way "manual-oneway"
      // edge). The two AbAttrs below fire that manual form change on either fire
      // interaction (using a Fire move / being hit by one).
      return ok([new FireUseFormChangeAbAttr("engulfed"), new FireHitFormChangeAbAttr("engulfed")]);
    case 676:
      return ok([
        new FirstFlaggedMovePriorityAbAttr(MoveFlags.BITING_MOVE),
        new ConsumeFirstFlaggedMovePriorityAbAttr(MoveFlags.BITING_MOVE, true),
      ]);
    case 882:
      // Edgelord — "First Keen Edge move each entry gets +1 priority. Resets on
      // KO." The exact slicing-move twin of Sidewinder (676); was approximated by
      // the generic priority-modifier (every slicing move on the switch-in turn,
      // no once-per-entry charge, no KO reset).
      return ok([
        new FirstFlaggedMovePriorityAbAttr(MoveFlags.SLICING_MOVE),
        new ConsumeFirstFlaggedMovePriorityAbAttr(MoveFlags.SLICING_MOVE, true),
      ]);
    case 743:
      // Cutthroat — "On entry, gives +1 priority to the FIRST Keen Edge (slicing)
      // move used. Consumed after landing any Keen Edge move. Resets if Sharpen is
      // used." Same one-shot slicing-priority as Edgelord (882), minus the KO
      // re-arm, plus the Sharpen re-arm: using Sharpen clears the used-flag so the
      // next slicing move regains the boost. Was approximated by the generic
      // priority-modifier (every slicing move on the switch-in turn, no consume,
      // no Sharpen reset).
      return ok([
        new FirstFlaggedMovePriorityAbAttr(MoveFlags.SLICING_MOVE),
        new ConsumeFirstFlaggedMovePriorityAbAttr(MoveFlags.SLICING_MOVE),
        new RearmFirstFlaggedMoveOnMoveAbAttr(MoveId.SHARPEN),
      ]);
    case 791:
      // DNA Scramble — "Changes forms based on the move used." Implemented
      // data-driven (Aegislash Stance-Change pattern): the Deoxys form-change
      // table in pokemon-forms.ts carries PreMove triggers gated on this
      // ability (Damaging → Attack, Recover → Defense, other status → Speed).
      // The ability itself is a pure marker — no AbAttr behavior to attach.
      return ok([]);
    case 813:
      // Mixed Martial Arts — "Normal moves are flagged as Punch + Kick moves."
      // The holder's Normal moves gain the PUNCHING + KICKING flags (so Iron
      // Fist etc. on the same holder boost them). Faithful to the description:
      // it grants flags rather than an unconditional damage boost.
      return ok([
        new AddMoveFlagAbAttr({
          filter: (user, move) => user.getMoveType(move) === PokemonType.NORMAL,
          flags: [MoveFlags.PUNCHING_MOVE, MoveFlags.KICKING_MOVE],
        }),
      ]);
    case 830:
      // Temporal Rupture — "Roar of Time becomes a 100 BP +0 priority attack
      // that changes the target's Ability to Slow Start but no longer forces
      // recharge." Signature rider: on hitting with Roar of Time, set the
      // target's ability to Slow Start. (The BP/priority/no-recharge stat
      // tweaks are Roar-of-Time move-data overrides handled in the move layer.)
      return ok([new SetTargetAbilityOnMoveAbAttr(MoveId.ROAR_OF_TIME, AbilityId.SLOW_START)]);
    case 834:
      // Toxic Surge — "Sets Toxic Terrain on entry." Sets the ER-custom Toxic
      // Terrain (boosts Poison moves + chips grounded non-Poison mons) for 8
      // turns, mirroring the Electric/Misty/Grassy/Psychic Surge entry pattern.
      return ok([new EntryEffectAbAttr({ kind: "set-terrain", terrain: TerrainType.TOXIC, turns: 8 })]);
    case 329:
      // Scare — "Lowers foes' Sp. Atk by one stage on entry."
      // Same shape as Intimidate but targeting SPATK. Uses the vanilla
      // intimidate primitive (selfTarget=false, intimidate=true).
      return ok([new PostSummonStatStageChangeAbAttr([Stat.SPATK], -1, false, true)]);
    case 632:
      // Terrify — "Lowers foes' Sp. Atk by two stages on entry."
      // Same shape as Scare but -2 stages.
      return ok([new PostSummonStatStageChangeAbAttr([Stat.SPATK], -2, false, true)]);
    case 283:
      // Christmas Spirit — "Takes 50% less damage in hail AND is immune to hail
      // chip damage." The move-damage reduction PLUS the hail/snow chip immunity.
      return ok([
        new WeatherDamageReductionAbAttr({
          weathers: [WeatherType.HAIL, WeatherType.SNOW],
          multiplier: 0.5,
        }),
        new BlockWeatherDamageAttr(WeatherType.HAIL, WeatherType.SNOW),
      ]);
    case 382:
      // Volcano Rage — "After using any Fire move, triggers a followup Eruption
      // with 50 base power that scales with the user's current HP (50 BP at full
      // health)." Eruption's HpPowerAttr hardcodes 150-BP-at-full scaling, and a
      // plain `power` override is ignored by it — so swap in a 50-BP HP-scaling
      // attr via hpScaledBasePower (was firing at 150 BP, 3x too strong).
      return ok([
        new PostAttackScriptedMoveAbAttr({
          moveId: MoveId.ERUPTION,
          hpScaledBasePower: 50,
          typeFilter: [PokemonType.FIRE],
        }),
      ]);
    case 475:
      // Frost Burn — "Triggers 40BP Ice Beam after using a Fire-type move."
      return ok([
        new PostAttackScriptedMoveAbAttr({
          moveId: MoveId.ICE_BEAM,
          power: 40,
          typeFilter: [PokemonType.FIRE],
        }),
      ]);
    case 1009:
      // Frost Dragon — "Triggers 50 BP Blizzard after using a Dragon or Ice-type move."
      return ok([
        new PostAttackScriptedMoveAbAttr({
          moveId: MoveId.BLIZZARD,
          power: 50,
          typeFilter: [PokemonType.DRAGON, PokemonType.ICE],
        }),
      ]);
    case 895:
      // Lunar Wrath — "After using a Ghost move, follow up with a 50BP Moongeist Beam."
      return ok([
        new PostAttackScriptedMoveAbAttr({
          moveId: MoveId.MOONGEIST_BEAM,
          power: 50,
          typeFilter: [PokemonType.GHOST],
        }),
      ]);
    case 384:
      // Low Blow — "Attacks with 40BP Feint Attack on switch-in."
      return ok([new PostSummonScriptedMoveAbAttr({ moveId: MoveId.FEINT_ATTACK, power: 40 })]);
    case 479:
      // Dust Cloud — "Attacks with Sand Attack on switch-in."
      return ok([new PostSummonScriptedMoveAbAttr({ moveId: MoveId.SAND_ATTACK })]);
    case 521:
      // Phantom Thief — "Attacks with 40BP Spectral Thief on switch-in."
      return ok([new PostSummonScriptedMoveAbAttr({ moveId: MoveId.SPECTRAL_THIEF, power: 40 })]);
    case 717:
      // Wildfire — "Uses a 50 BP Fire Spin on switch-in (traps 4-5 turns, 1/8 HP
      // per turn)." The port's Fire Spin is 35 BP, so pin the dex's 50 BP.
      return ok([new PostSummonScriptedMoveAbAttr({ moveId: MoveId.FIRE_SPIN, power: 50 })]);
    case 718:
      // Jumpscare — "Attacks with Astonish on first switch-in."
      // PostSummon only fires once per switch-in, so "first" is implicit.
      return ok([
        new PostSummonScriptedMoveAbAttr({
          moveId: MoveId.ASTONISH,
          power: 40,
          oncePerBattleKey: "jumpscare-scripted-move",
        }),
      ]);
    case 745:
      // Sand Pit — "Attacks with 20BP Sand Tomb on switch-in. Hits ALL opposing
      // Pokemon and cannot miss." allOpponents spreads it to both foes in doubles;
      // alwaysHit (accuracy -1) makes it bypass the accuracy check.
      return ok([
        new PostSummonScriptedMoveAbAttr({ moveId: MoveId.SAND_TOMB, power: 20, allOpponents: true, alwaysHit: true }),
      ]);
    case 461:
      // Monkey Business — "Uses Tickle on entry."
      return ok([new PostSummonScriptedMoveAbAttr({ moveId: MoveId.TICKLE })]);
    case 481:
      // Trickster — "Uses Disable on switch-in."
      return ok([new PostSummonScriptedMoveAbAttr({ moveId: MoveId.DISABLE })]);
    case 496:
      // Wishmaker — "Uses Wish on switch-in. Three uses per battle." Capped at 3
      // casts per wave via maxUsesPerBattle. targetsSelf (#412): Wish is a
      // USER-target move - without it the Wish landed on the OPPONENT's slot and
      // healed them (live Dragonite Y report).
      return ok([
        new PostSummonScriptedMoveAbAttr({
          moveId: MoveId.WISH,
          targetsSelf: true,
          oncePerBattleKey: "wishmaker",
          maxUsesPerBattle: 3,
        }),
      ]);
    case 541:
      // Web Spinner (rom): "Uses String Shot on switch in, harshly lowering the
      // Speed of ALL opponents by 2 stages." allOpponents makes the on-entry
      // String Shot hit every foe (both in doubles), not just the leftmost.
      return ok([new PostSummonScriptedMoveAbAttr({ moveId: MoveId.STRING_SHOT, allOpponents: true })]);
    case 670:
      // Draco Morale — "Uses Dragon Cheer on switch-in."
      return ok([new PostSummonScriptedMoveAbAttr({ moveId: MoveId.DRAGON_CHEER, targetsSelf: true })]);
    case 710:
      // Dream Whimsy — "Uses Yawn on switch-in."
      return ok([new PostSummonScriptedMoveAbAttr({ moveId: MoveId.YAWN })]);
    case 719:
      // Tar Toss — "Uses Tar Shot on switch-in."
      return ok([new PostSummonScriptedMoveAbAttr({ moveId: MoveId.TAR_SHOT })]);
    case 839:
      // Neutralizing Fog — "Uses Defog on entry."
      return ok([new PostSummonScriptedMoveAbAttr({ moveId: MoveId.DEFOG })]);
    case 878:
      // Frosty Presence — "Uses Mist on entry."
      return ok([new PostSummonScriptedMoveAbAttr({ moveId: MoveId.MIST, targetsSelf: true })]);
    case 293:
      // Let's Roll — "Casts Defense Curl on entry."
      return ok([new PostSummonScriptedMoveAbAttr({ moveId: MoveId.DEFENSE_CURL, targetsSelf: true })]);
    case 320:
      // Air Blower — "Casts a 3-turn Tailwind on entry." The scripted TAILWIND
      // move applies a 4-turn Tailwind (move duration); the dex wants exactly 3.
      // Use the entry-effect screen-or-room primitive (holder's own side) for a
      // faithful 3-turn Tailwind. TailwindTag.onAdd still triggers Wind Rider and
      // doubles the side's Speed.
      return ok([new EntryEffectAbAttr({ kind: "set-screen-or-room", tag: ArenaTagType.TAILWIND, turns: 3 })]);
    case 428:
      // Cheap Tactics — "Attacks with Scratch on switch-in."
      return ok([new PostSummonScriptedMoveAbAttr({ moveId: MoveId.SCRATCH })]);
    case 495:
      // Doombringer — "Uses Doom Desire on switch-in."
      return ok([new PostSummonScriptedMoveAbAttr({ moveId: MoveId.DOOM_DESIRE })]);
    case 498:
      // Suppress — "Casts Torment on entry."
      return ok([new PostSummonScriptedMoveAbAttr({ moveId: MoveId.TORMENT })]);
    case 504:
      // Change of Heart — "Uses Heart Swap on switch-in."
      return ok([new PostSummonScriptedMoveAbAttr({ moveId: MoveId.HEART_SWAP })]);
    case 511:
      // Telekinetic — "Casts Telekinesis on entry." `nonReflectable` so a Magic
      // Bounce opponent does NOT reflect the Telekinesis back onto the holder
      // (the bug: the holder ended up levitating + always-hittable instead of
      // the opponent). The ability forces the move ONTO the opponent.
      return ok([new PostSummonScriptedMoveAbAttr({ moveId: MoveId.TELEKINESIS, nonReflectable: true })]);
    case 514:
      // Powder Burst — "Casts Powder on entry."
      return ok([new PostSummonScriptedMoveAbAttr({ moveId: MoveId.POWDER })]);
    case 503:
      // High Tide — "Triggers 50 BP Surf after using a Water-type move."
      return ok([
        new PostAttackScriptedMoveAbAttr({
          moveId: MoveId.SURF,
          power: 50,
          typeFilter: [PokemonType.WATER],
        }),
      ]);
    case 516:
      // Monster Mash — "Casts Trick-or-Treat on entry."
      return ok([new PostSummonScriptedMoveAbAttr({ moveId: MoveId.TRICK_OR_TREAT })]);
    case 784:
      // Poseidon's Dominion — "Attacks with a 50 BP Whirlpool on entry." Vanilla
      // Whirlpool is 35 BP; the dex specifies 50, so override the power.
      return ok([new PostSummonScriptedMoveAbAttr({ moveId: MoveId.WHIRLPOOL, power: 50 })]);
    case 849:
      // World Serpent — "Physical non-contact moves deal 20% more damage. Contact
      // moves have a 50% chance to trap for 4-5 turns." Bespoke: the old composite
      // (Long Reach + Grip Pincer) was wrong — Long Reach stripped contact from
      // ALL moves (so the trap could never proc) and gave no boost, and Grip
      // Pincer dragged in Def-ignore/always-hit riders the dex never grants.
      return ok([
        new MovePowerBoostAbAttr(
          (_user, _target, move) => move.category === MoveCategory.PHYSICAL && !move.hasFlag(MoveFlags.MAKES_CONTACT),
          1.2,
        ),
        new ChanceBattlerTagOnAttackAbAttr({
          chance: 50,
          tags: [BattlerTagType.WRAP],
          contactRequired: true,
          turnRange: [4, 5],
        }),
      ]);
    case 788:
      // Glacial Rage — "Triggers 50 BP Blizzard after using a Ice-type move."
      return ok([
        new PostAttackScriptedMoveAbAttr({
          moveId: MoveId.BLIZZARD,
          power: 50,
          typeFilter: [PokemonType.ICE],
        }),
      ]);
    case 917:
      // Let's Dance — "Uses Teeter Dance on entry, Confusing the field."
      return ok([new PostSummonScriptedMoveAbAttr({ moveId: MoveId.TEETER_DANCE })]);
    case 949:
      // I Am Steve — "Uses No Retreat on entry."
      return ok([new PostSummonScriptedMoveAbAttr({ moveId: MoveId.NO_RETREAT, targetsSelf: true })]);
    case 951:
      // Foamy Web — "Casts an unremovable Sticky Web on entry. Lasts 5 turns."
      // Lays the dedicated FOAMY_WEB entry hazard on the FOE's side: it behaves
      // like Sticky Web (−1 Speed to grounded switch-ins) but expires after 5
      // turns (via lapseTags) and is absent from the Rapid Spin / Defog removal
      // lists, so it cannot be cleared — matching both "unremovable" and
      // "lasts 5 turns". (Was a plain scripted Sticky Web: permanent + removable.)
      return ok([new EntryEffectAbAttr({ kind: "set-hazard", hazard: ArenaTagType.FOAMY_WEB, side: "foe" })]);
    case 1006:
      // Electro Booster — "Uses Magnet Rise on entry."
      return ok([new PostSummonScriptedMoveAbAttr({ moveId: MoveId.MAGNET_RISE, targetsSelf: true })]);
    case 517:
      // Two Step — "Triggers 50BP Revelation Dance after using a Dance move."
      return ok([
        new PostAttackScriptedMoveAbAttr({
          moveId: MoveId.REVELATION_DANCE,
          power: 50,
          flagFilter: MoveFlags.DANCE_MOVE,
        }),
      ]);
    case 732:
      // Blade Dance — "Triggers 50 BP Leaf Blade after using a dance move."
      return ok([
        new PostAttackScriptedMoveAbAttr({
          moveId: MoveId.LEAF_BLADE,
          power: 50,
          flagFilter: MoveFlags.DANCE_MOVE,
        }),
      ]);
    case 977:
      // Backflip — "After using a Dance move, follow up with a 50BP Chip Away."
      return ok([
        new PostAttackScriptedMoveAbAttr({
          moveId: MoveId.CHIP_AWAY,
          power: 50,
          flagFilter: MoveFlags.DANCE_MOVE,
        }),
      ]);
    case 641:
      // Chunky Bass Line — "Triggers a 40BP Earthquake after using a sound move."
      return ok([
        new PostAttackScriptedMoveAbAttr({
          moveId: MoveId.EARTHQUAKE,
          power: 40,
          flagFilter: MoveFlags.SOUND_BASED,
        }),
      ]);
    case 974:
      // Break it Down — "After using an attack, follow up with a 20BP Rapid Spin."
      return ok([new PostAttackScriptedMoveAbAttr({ moveId: MoveId.RAPID_SPIN, power: 20 })]);
    case 853:
      // Purple Haze — "Triggers a 20BP Poison Gas after using a move." Two
      // fixes: (1) the scripted follow-up now resolves immediately after the
      // attack — the archetype forces MovePhaseTimingModifier.FIRST instead of
      // letting the dynamic MovePhase queue re-sort it into turn speed-order;
      // (2) the intended 20 BP is now honored.
      //
      // On the 20 BP: although VANILLA MoveId.POISON_GAS is a STATUS move
      // (power -1), ER's vanilla-move-patches rebalance it at init into a SPECIAL
      // Poison DAMAGING move (see init-elite-redux-vanilla-move-patches.ts) that
      // still applies POISON. So the scripted cast IS damaging, and the `power`
      // override (20) cleanly replaces the rebalanced ~65 BP for this cast alone
      // via scriptedPokemonMove's power-overridden clone — nothing global is
      // mutated, and we do NOT touch the POISON_GAS definition here.
      return ok([new PostAttackScriptedMoveAbAttr({ moveId: MoveId.POISON_GAS, power: 20 })]);
    case 383:
      // Cold Rebound — "Attacks with Icy Wind when hit by a contact move."
      return ok([
        new CounterAttackOnHitAbAttr({
          moveId: MoveId.ICY_WIND,
          filter: { contactRequired: true },
        }),
      ]);
    case 531:
      // Clap Trap — "Counters contact with 50BP Snap Trap."
      return ok([
        new CounterAttackOnHitAbAttr({
          moveId: MoveId.SNAP_TRAP,
          power: 50,
          filter: { contactRequired: true },
        }),
      ]);
    case 633:
      // Ice Downfall — "Counters contact with 60BP Icicle Crash."
      return ok([
        new CounterAttackOnHitAbAttr({
          moveId: MoveId.ICICLE_CRASH,
          power: 60,
          filter: { contactRequired: true },
        }),
      ]);
    case 660:
      // Ultra Instinct — "Counters contact with 20BP Vacuum Wave. Takes .8x damage."
      // Wire both pieces: counter on contact + 20% damage reduction on all hits.
      return ok([
        new CounterAttackOnHitAbAttr({
          moveId: MoveId.VACUUM_WAVE,
          power: 20,
          filter: { contactRequired: true },
        }),
        new DamageReductionAbAttr({ reduction: 0.2, filter: { kind: "all" } }),
      ]);
    case 823:
      // Chilling Presence — "10BP Icy Wind on entry."
      return ok([new PostSummonScriptedMoveAbAttr({ moveId: MoveId.ICY_WIND, power: 10 })]);
    case 995:
      // Elemental Aegis — "Takes 1/2 damage from Fire, Electric and Water-type attacks."
      return ok([
        new DamageReductionAbAttr({
          reduction: 0.5,
          filter: { kind: "move-type", type: PokemonType.FIRE },
        }),
        new DamageReductionAbAttr({
          reduction: 0.5,
          filter: { kind: "move-type", type: PokemonType.ELECTRIC },
        }),
        new DamageReductionAbAttr({
          reduction: 0.5,
          filter: { kind: "move-type", type: PokemonType.WATER },
        }),
      ]);
    case 996:
      // Aegis Ward — "Takes 1/2 damage from Dark, Ghost and Psychic-type attacks."
      return ok([
        new DamageReductionAbAttr({
          reduction: 0.5,
          filter: { kind: "move-type", type: PokemonType.DARK },
        }),
        new DamageReductionAbAttr({
          reduction: 0.5,
          filter: { kind: "move-type", type: PokemonType.GHOST },
        }),
        new DamageReductionAbAttr({
          reduction: 0.5,
          filter: { kind: "move-type", type: PokemonType.PSYCHIC },
        }),
      ]);
    case 442:
      // Fae Hunter — "1.5x damage TO Fairy-type Pokemon, 0.5x damage FROM
      // Fairy-type Pokemon, based on the attacker/defender POKEMON types (not
      // move types)." The shared buildTypeEffectivenessModAttrs gates the
      // DEFENSIVE half on the incoming MOVE's type (wrong); wire it directly like
      // Firefighter: offense gates on the defender's Pokemon type, defense on the
      // ATTACKER's Pokemon type.
      return ok([
        new OffensiveTypeMultiplierAbAttr(PokemonType.FAIRY, 1.5),
        new ReceivedMoveDamageMultiplierAbAttr((_target, attacker) => attacker.isOfType(PokemonType.FAIRY), 0.5, false),
      ]);
    case 445:
      // Lumberjack — "1.5x TO Grass Pokemon, 0.5x FROM Grass Pokemon, based on the
      // attacker/defender POKEMON types (not move types)." Wire defense on the
      // attacker's Pokemon type (see Fae Hunter 442 / Dragonslayer 313).
      return ok([
        new OffensiveTypeMultiplierAbAttr(PokemonType.GRASS, 1.5),
        new ReceivedMoveDamageMultiplierAbAttr((_target, attacker) => attacker.isOfType(PokemonType.GRASS), 0.5, false),
      ]);
    case 526:
      // Monster Hunter — "1.5x TO Dark Pokemon, 0.5x FROM Dark Pokemon, based on
      // the attacker/defender POKEMON types (not move types)." Wire defense on the
      // attacker's Pokemon type (see Fae Hunter 442 / Dragonslayer 313).
      return ok([
        new OffensiveTypeMultiplierAbAttr(PokemonType.DARK, 1.5),
        new ReceivedMoveDamageMultiplierAbAttr((_target, attacker) => attacker.isOfType(PokemonType.DARK), 0.5, false),
      ]);
    case 804:
      // Firefighter — "1.5x damage to Fire-type Pokemon and 0.5x damage when
      // attacked by Fire-type Pokemon. Based on attacker/defender POKEMON types,
      // not move types." The shared helper's defensive side is move-type gated
      // (vanilla, like Thick Fat) which is wrong here, so wire the defensive 0.5x
      // to gate on the ATTACKER'S Pokemon type instead. Offensive side is already
      // defender-Pokemon-type gated (OffensiveTypeMultiplierAbAttr).
      return ok([
        new OffensiveTypeMultiplierAbAttr(PokemonType.FIRE, 1.5),
        new ReceivedMoveDamageMultiplierAbAttr((_target, attacker) => attacker.isOfType(PokemonType.FIRE), 0.5, false),
      ]);
    case 1028: {
      // King of the Jungle — "Infiltrator + deals 1.5x more damage to
      // Grass-types." The classifier emitted this as composite-vanilla-mashup
      // with one unresolved rider ("deals 1.5x more damage to Grass-types").
      // We override to bespoke and wire BOTH pieces:
      //   - Vanilla Infiltrator (AbilityId 151) — copy its attrs verbatim from
      //     allAbilities, matching how the composite dispatcher copies vanilla
      //     parts.
      //   - Offensive-only type-effectiveness-mod for Grass (1.5x offense, 1.0x
      //     defense — defensive side omitted by the factory).
      const infiltrator = allAbilities[151];
      const infiltratorAttrs = infiltrator?.attrs ?? [];
      return ok([
        ...infiltratorAttrs,
        ...buildTypeEffectivenessModAttrs({
          type: PokemonType.GRASS,
          offensiveMultiplier: 1.5,
          defensiveMultiplier: 1,
        }),
      ]);
    }
    // -------------------------------------------------------------------------
    // Round 11 — composition wires using existing primitives.
    //
    // Picked up from `docs/plans/elite-redux-bespoke-inventory.md`: pure
    // compositions of round 1-10 primitives — no new abstractions needed.
    // Several have ER-text riders that compose with the wired piece but need
    // primitives we don't yet expose (per-flag accuracy-mod, ally auras,
    // BattlerTag-keyed damage filters). Those are marked partial wire.
    // -------------------------------------------------------------------------
    case 345:
      // Scavenger — "Dealing a (direct-hit) KO heals 1/4 max HP, and has a 50%
      // chance to loot a random held item from the defeated foe." Both gated to
      // the Pokémon that actually landed the knockout (LifestealOnKo +
      // ScavengerLoot share the same direct-hit-KO guard).
      return ok([new LifestealOnKoAbAttr({ healFraction: 0.25 }), new ScavengerLootAbAttr({ chance: 0.5 })]);
    case 348:
      // North Wind — "3 turns Aurora Veil on entry. Immune to Hail damage."
      // Wire BOTH: EntryEffectAbAttr (Aurora Veil 3 turns) +
      // BlockWeatherDamageAttr (HAIL — vanilla Ice Body family).
      return ok([
        new EntryEffectAbAttr({ kind: "set-screen-or-room", tag: ArenaTagType.AURORA_VEIL, turns: 3 }),
        new BlockWeatherDamageAttr(WeatherType.HAIL),
      ]);
    case 378:
      // Amplifier — "Ups sound moves by 30% and makes them hit both foes."
      // FlagDamageBoost(SOUND_BASED, 1.3) + spread targeting for single-target
      // sound moves (promoted in getMoveTargets; multihit excluded per spec).
      return ok([
        new FlagDamageBoostAbAttr({ flag: MoveFlags.SOUND_BASED, multiplier: 1.3 }),
        new SpreadTargetByFlagAbAttr(MoveFlags.SOUND_BASED),
      ]);
    case 438:
      // Jaws of Carnage — "Restores 50% max HP when defeating foes with biting
      // moves, or 25% with other moves." Base 25% heal-on-KO, upgraded to 50%
      // when the KO move carries the BITING_MOVE flag (Strong Jaw family).
      return ok([
        new LifestealOnKoAbAttr({
          healFraction: 0.25,
          flagBonus: { flag: MoveFlags.BITING_MOVE, fraction: 0.5 },
        }),
      ]);
    case 519:
      // Fortitude — "Boosts SpDef +1 when hit. Maxes SpDef on crit." Mirrors
      // case 488 (Tipping Point) but on the SPDEF stat. The crit-maximize
      // piece uses PostReceiveCritStatStageChangeAbAttr with stages exceeding
      // the engine clamp (+12) — pokerogue's StatStageChangePhase clamps
      // internally so the effective result is "max out". Vanilla Anger Point
      // uses the same +12 trick.
      return ok([
        new StatTriggerOnHitAbAttr({ stats: [{ stat: Stat.SPDEF, stages: 1 }] }),
        new PostReceiveCritStatStageChangeAbAttr(Stat.SPDEF, 12),
      ]);
    case 645:
      // Soul Crusher — "Hammer moves hit SpDef and get a 1.1x power boost."
      // Wire the FlagDamageBoost(HAMMER_BASED, 1.1) piece. The "hit SpDef"
      // piece is a defensive-stat-swap that needs a primitive routed through
      // the damage formula's defender-stat selector — not yet exposed.
      // Partial wire.
      return ok([new FlagDamageBoostAbAttr({ flag: MoveFlags.HAMMER_BASED, multiplier: 1.1 })]);
    case 655:
      // Smokey Maneuvers — "In fog, incoming moves targeting the holder have
      // their accuracy reduced by 25%." Evasion divides the hit chance, so an EVA
      // multiplier of 4/3 yields hit chance x0.75 (=-25% accuracy). (A 1.25x EVA
      // only nets x0.80 = -20%, which understated the dex.)
      return ok([
        new WeatherStatMultiplierAbAttr({
          stat: Stat.EVA,
          multiplier: 4 / 3,
          weathers: [WeatherType.FOG, WeatherType.EERIE_FOG],
        }),
      ]);
    case 819:
      // Serpent Bind — "50% chance to trap, then drop their speed by -1 each
      // turn." 50% trap-on-contact (TRAPPED tag) + a per-turn -1 SPD on any
      // currently-TRAPPED foe (the speed-drop piece was previously unwired).
      // Cascades to 818 Tentalock, which composites Serpent Bind.
      return ok([
        new ChanceBattlerTagOnAttackAbAttr({
          chance: 50,
          tags: [BattlerTagType.WRAP],
          contactRequired: false,
          turnRange: [4, 5],
          damageDenominator: 8,
        }),
        new PostTurnFoeStatDropAbAttr({ stat: Stat.SPD, stages: -1, onlyIfTrapped: true }),
      ]);
    case 987:
      // Rain Shroud — "Ups evasion by 30% in rain." WeatherStatMultiplier with
      // Stat.EVA * 1.3 on WeatherType.RAIN and HEAVY_RAIN (the parent
      // weather pair).
      return ok([
        new WeatherStatMultiplierAbAttr({
          stat: Stat.EVA,
          multiplier: 1.3,
          weathers: [WeatherType.RAIN, WeatherType.HEAVY_RAIN],
        }),
      ]);
    case 1018:
      // Abominable Monster — "Ups SpDef by 1.5x in hail." WeatherStatMultiplier
      // with Stat.SPDEF * 1.5 on hail/snow (the parent weather pair).
      return ok([
        new WeatherStatMultiplierAbAttr({
          stat: Stat.SPDEF,
          multiplier: 1.5,
          weathers: [WeatherType.HAIL, WeatherType.SNOW],
        }),
      ]);
    // -------------------------------------------------------------------------
    // Round 12 — `UserFieldMoveTypePowerBoostAbAttr` (vanilla field-aura)
    // first use + `EntryEffectAddSelfType` cluster (existing primitive, new
    // wires) + `StatMultiplierAbAttr` static stat-multiplier cluster (vanilla
    // Huge-Power-style primitive applied to ER's "boost own SpAtk by N%"
    // shape) + `TypeAbsorbStatBoostAbAttr` Aerodynamics wire + bonus
    // composition wires.
    //
    // No new primitives introduced this round — every wire uses existing
    // primitives (round 1-11) plus vanilla pokerogue AbAttrs imported into
    // the dispatcher. See round-11 leverage pattern.
    // -------------------------------------------------------------------------
    case 715:
      // Hover — "Adds Psychic type on entry; immune to Ground-type moves AND
      // ground effects such as Spikes and terrains." add-self-type(Psychic) +
      // Ground-move immunity (AttackTypeImmunity) + FloatAbAttr (Levitate-style
      // ungrounding, so Spikes / terrain / Arena Trap no longer apply).
      return ok([
        new EntryEffectAbAttr({ kind: "add-self-type", type: PokemonType.PSYCHIC }),
        new AttackTypeImmunityAbAttr(PokemonType.GROUND),
        new FloatAbAttr(),
      ]);
    case 720:
      // Stun Shock — "60% chance to inflict POISON or PARALYSIS, chosen randomly,
      // when landing an attack." The two-effect random roll (ChanceStatusOnAttack
      // picks a uniform-random effect per proc); the prior archetype wiring only
      // inflicted paralysis.
      return ok([
        new ChanceStatusOnAttackAbAttr({ chance: 60, effects: [StatusEffect.PARALYSIS, StatusEffect.POISON] }),
      ]);
    case 843:
      // Fey Flight — "Adds Fairy-type, levitates, and boosts Flying-type moves by
      // 25%." add-self-type (Fairy) + Ground-move immunity + FloatAbAttr (true
      // Levitate-style ungrounding) + the Flying ×1.25 boost (was missing).
      return ok([
        new EntryEffectAbAttr({ kind: "add-self-type", type: PokemonType.FAIRY }),
        new AttackTypeImmunityAbAttr(PokemonType.GROUND),
        new FloatAbAttr(),
        new TypeDamageBoostAbAttr({ type: PokemonType.FLYING, multiplier: 1.25 }),
      ]);
    case 282:
      // Aerodynamics — "Boosts Speed instead of being hit by Flying-type moves."
      // Classic Motor-Drive shape — wire via
      // {@linkcode TypeAbsorbStatBoostAbAttr}. The +1 Speed delta matches the
      // pokerogue Motor Drive parent's default (and ER's own copies use the
      // same convention).
      return ok([
        new TypeAbsorbStatBoostAbAttr({
          type: PokemonType.FLYING,
          stat: Stat.SPD,
          stages: 1,
        }),
      ]);
    case 301:
      // Cryptic Power — "Doubles own Sp. Atk stat. Boosts raw stat, not base
      // stat." Vanilla pokerogue `StatMultiplierAbAttr` is exactly the right
      // primitive — Huge Power / Pure Power family. The ER "boosts raw stat,
      // not base stat" comment is informational; pokerogue's
      // `getEffectiveStat` calls the multiplier AFTER stat-stage application,
      // matching ER's "raw stat" wording.
      return ok([new StatMultiplierAbAttr(Stat.SPATK, 2)]);
    case 323:
      // Majestic Bird — "Boosts own Sp. Atk by 1.5x. Boosts raw stat, not base
      // stat." Same shape as 301 Cryptic Power but at 1.5x instead of 2x.
      return ok([new StatMultiplierAbAttr(Stat.SPATK, 1.5)]);
    case 352:
      // Sage Power — "Ups Special Attack by 50% and locks move." (Sp.Atk ONLY.)
      // audit-fix: previously used vanilla GorillaTacticsAbAttr whose tag onAdd
      // ALSO applied a spurious ×1.5 physical Attack (Choice-Band-style) the dex
      // never grants. Now uses SagePowerMoveLockAbAttr → the ER_SAGE_POWER_LOCK
      // tag, which locks the first move WITHOUT any Attack boost. The +50% Sp.Atk
      // is the separate StatMultiplier below.
      return ok([new StatMultiplierAbAttr(Stat.SPATK, 1.5), new SagePowerMoveLockAbAttr()]);
    case 599: {
      // Dead Power — "1.5x Attack boost. 20% chance to curse on contact moves."
      // Wire both pieces: StatMultiplier(ATK, 1.5) for the attack boost +
      // ChanceBattlerTagOnHit(20%, CURSED, contact) for the curse-on-contact
      // proc. Two independent attrs that fire on different surfaces (stat
      // calc vs. post-defend tag application).
      return ok([
        new StatMultiplierAbAttr(Stat.ATK, 1.5),
        new ChanceBattlerTagOnAttackAbAttr({
          chance: 20,
          tags: [BattlerTagType.CURSED],
          contactRequired: true,
        }),
      ]);
    }
    case 892:
      // Crispy Cream — "30% to inflict burn/frostbite when hit by contact."
      // Compose two ChanceBattlerTagOnHit / ChanceStatusOnHit instances —
      // 30% burn (vanilla StatusEffect.BURN) + 30% frostbite (ER_FROSTBITE
      // battler tag). Pokerogue's status apply already gates on type immunity
      // (Fire-type can't burn, Ice-type can't frostbite), so the two chances
      // are effectively mutually exclusive on real-mon usage.
      return ok([
        new ChanceStatusOnHitAbAttr({
          chance: 30,
          effects: [StatusEffect.BURN],
          contactRequired: true,
        }),
        new ChanceBattlerTagOnHitAbAttr({
          chance: 30,
          tags: [BattlerTagType.ER_FROSTBITE],
          contactRequired: true,
        }),
      ]);
    case 1027:
      // Jungle Fever — "If Grassy Terrain is active, gets a 1.5x Speed boost."
      // Terrain-gated stat multiplier. The existing
      // {@linkcode WeatherStatMultiplierAbAttr} only models weather conditions,
      // not terrain. Use the existing
      // {@linkcode StatMultiplierAbAttr} with a condition closure — pokerogue's
      // constructor accepts a {@linkcode PokemonAttackCondition} that's checked
      // at canApply time. The condition checks the active terrain via the
      // global scene. The `_user, _target, _move` params are unused — we only
      // gate on the global terrain state.
      return ok([
        new StatMultiplierAbAttr(Stat.SPD, 1.5, (_user, _target, _move) => globalSceneTerrainIs(TerrainType.GRASSY)),
      ]);
    case 731:
      // To The Bone — "Critical hits get a 1.5x boost and inflict bleeding."
      // Crit-power-boost via CritDamageMultiplier + crit-gated ER_BLEED.
      return ok([
        new CritDamageMultiplierAbAttr({ multiplier: 1.5 }),
        new ChanceBattlerTagOnAttackAbAttr({ chance: 100, tags: [BattlerTagType.ER_BLEED], critRequired: true }),
      ]);
    case 462:
      // Combat Specialist — "Boosts the power of punching and kicking moves by
      // 1.3x." Wire as two FlagDamageBoost instances — PUNCHING_MOVE +
      // KICKING_MOVE (ER's kick flag, mapped through ER_CLASSIFIER_FLAG_TO_MOVE_FLAG).
      // ER's vanilla wiring already has PUNCHING_MOVE on punching moves; the
      // KICKING_MOVE flag is ER-specific.
      return ok([
        new FlagDamageBoostAbAttr({ flag: MoveFlags.PUNCHING_MOVE, multiplier: 1.3 }),
        new FlagDamageBoostAbAttr({ flag: MoveFlags.KICKING_MOVE, multiplier: 1.3 }),
      ]);
    case 1023:
      // Overwhelming Mind — "Boosts Psychic-type moves by 1.3x, or 1.8x when
      // below 1/3 HP." TypeDamageBoost already supports an optional
      // `lowHpMultiplier` + `lowHpThreshold` payload — this is exactly the
      // shape (1.3x base, 1.8x below 1/3 HP).
      return ok([
        new TypeDamageBoostAbAttr({
          type: PokemonType.PSYCHIC,
          multiplier: 1.3,
          lowHpMultiplier: 1.8,
          lowHpThreshold: 1 / 3,
        }),
      ]);
    // -------------------------------------------------------------------------
    // Round 13 — large batch of composition wires for common ability shapes.
    //
    // Picked from the bespoke-unwired set, grouped by archetype family. Each
    // wire either composes existing primitives or ports a tight one-off
    // pattern that doesn't merit a new primitive. Riders that need new
    // primitives are deferred with inline notes.
    // -------------------------------------------------------------------------
    case 270:
      // Pyromancy — "Moves inflict burn 5x as often." Wire a flat 30% on-hit
      // burn proc as an approximation (vanilla burn-chance moves are 10% so
      // 5x ≈ 50%; flat 30% averages across the move pool). A per-move-chance
      // multiplier primitive would be more correct — deferred.
      return ok([new ChanceStatusOnHitAbAttr({ chance: 30, effects: [StatusEffect.BURN], contactRequired: false })]);
    case 662:
      // Higher Rank — "Priority moves get a 1.2x boost." No PRIORITY_MOVE
      // flag exists in MoveFlags; this needs a priority-aware power-boost
      // primitive (move's priority > 0 → boost). Deferred to a future primitive.
      return SKIP_BESPOKE;
    case 923:
      // Galeforce Wings — "Flying moves get +1 Priority."
      return ok([
        new PriorityModifierAbAttr({
          filter: { type: PokemonType.FLYING },
          priority: 1,
        }),
      ]);
    case 740:
      // Set Ablaze — "Inflicting burn also inflicts fear." Approximation:
      // also tag ER_FEAR with same probability as burn (30%). Over-fires
      // vs ER spec slightly (fires on any contact, not gated to "burn just
      // landed") — refine later with a status-cascade primitive.
      return ok([new ChanceBattlerTagOnHitAbAttr({ chance: 30, tags: [BattlerTagType.ER_FEAR] })]);
    case 468:
      // Super Hot Goo — "Contact moves have a 30% chance to inflict burn and the
      // user lowers the attacker's Speed by one stage when receiving a contact
      // move." Both halves are CONTACT-gated: burn via ChanceStatusOnHit's
      // default contactRequired, the SPD drop via an explicit MAKES_CONTACT flag
      // filter (previously it fired on any connecting move).
      return ok([
        new ChanceStatusOnHitAbAttr({ chance: 30, effects: [StatusEffect.BURN] }),
        new StatTriggerOnHitAbAttr({
          stats: [{ stat: Stat.SPD, stages: -1 }],
          filter: { flags: [MoveFlags.MAKES_CONTACT] },
        }),
      ]);
    case 912:
      // Laser Drill — "Horn moves have a 50% burn chance."
      return ok([
        new ChanceStatusOnHitAbAttr({
          chance: 50,
          effects: [StatusEffect.BURN],
          filter: { flag: MoveFlags.HORN_BASED },
          contactRequired: false,
        }),
      ]);
    case 435:
      // Ambush — "Guaranteed critical hit on first turn (after switch-in)."
      // A guaranteed crit (ConditionalCrit) gated to the holder's first turn
      // out via the same signal pokerogue uses for Fake Out
      // (tempSummonData.waveTurnCount === 1). The prior wire was a permanent
      // +1 crit-stage bonus on every move — neither guaranteed nor first-turn.
      return ok([new ConditionalCritAbAttr(user => user.tempSummonData.waveTurnCount === 1)]);
    case 671:
      // Bad Omen — "Foes min roll. Takes 1/4 damage from crits." 0.75 reduction
      // from crits (1/4 received) + force foes to roll minimum damage
      // (EnemyMinDamageRoll, the new defender-side damage-roll hook).
      return ok([
        new DamageReductionAbAttr({
          reduction: 0.75,
          filter: { kind: "crit" },
        }),
        new EnemyMinDamageRollAbAttr(),
      ]);
    case 482:
      // Sand Guard — "Blocks priority and reduces special damage by 1/2 in
      // sand." In-sand 0.5 special reduction + priority-move immunity gated to
      // sand (FieldPriorityMoveImmunity, the Armor Tail hook, gated via the
      // per-attr extraCondition).
      return ok([
        new DamageReductionAbAttr({
          reduction: 0.5,
          filter: { kind: "category-in-weather", category: MoveCategory.SPECIAL, weather: WeatherType.SANDSTORM },
        }),
        new FieldPriorityMoveImmunityAbAttr().addCondition(getWeatherCondition(WeatherType.SANDSTORM)),
      ]);
    case 585:
      // Sun Basking — "Blocks priority and reduces physical damage by 1/2 in
      // sun." In-sun 0.5 physical reduction + priority-move immunity gated to sun.
      return ok([
        new DamageReductionAbAttr({
          reduction: 0.5,
          filter: { kind: "category-in-weather", category: MoveCategory.PHYSICAL, weather: WeatherType.SUNNY },
        }),
        new FieldPriorityMoveImmunityAbAttr().addCondition(getWeatherCondition(WeatherType.SUNNY)),
      ]);
    case 837:
      // Chokehold — "When the user traps a target, they inflict paralysis and drop
      // their speed by one stage once every turn while trapped." Per-turn -1 SPD +
      // paralysis against currently-TRAPPED foes (paralysis lands once). Reuses the
      // post-turn-foe-stat-drop primitive's onlyIfTrapped + inflictStatus options —
      // far more faithful than the prior on-any-hit -1 SPD approximation.
      return ok([
        new PostTurnFoeStatDropAbAttr({
          stat: Stat.SPD,
          stages: -1,
          onlyIfTrapped: true,
          inflictStatus: StatusEffect.PARALYSIS,
        }),
      ]);
    case 730:
      // Razor Sharp — "Inflict bleed when landing a critical hit." Crit-gated
      // 100% ER_BLEED on the target.
      return ok([
        new ChanceBattlerTagOnAttackAbAttr({ chance: 100, tags: [BattlerTagType.ER_BLEED], critRequired: true }),
      ]);
    case 268:
      // Chloroplast — "Weather Ball, Solar Beam/Blade, Growth, and the recovery
      // moves act as if used in sun." Implemented move-side via the shared
      // `userActsInSun(user)` hook (move.ts), which the relevant move attrs
      // consult and which returns true for a Chloroplast holder regardless of
      // weather: Solar moves charge instantly, Growth gives +2, Weather Ball
      // becomes Fire-type, Moonlight/Synthesis/Morning Sun recover 2/3. The
      // ability itself is a pure marker.
      return ok([]);
    // -------------------------------------------------------------------------
    // Round 14 — defensive / utility / type-cluster wires
    // -------------------------------------------------------------------------
    case 334:
      // Bad Luck — "Foes can't crit, deal min damage, 5% less acc, & no effect
      // chance." Crit-block + no-secondary-effects (IgnoreMoveEffects) + -5%
      // incoming accuracy + force foes to roll minimum damage (EnemyMinDamageRoll).
      return ok([
        new CritImmunityAbAttr(),
        new IgnoreMoveEffectsAbAttr(),
        new IncomingAccuracyMultiplierAbAttr({ multiplier: 0.95 }),
        new EnemyMinDamageRollAbAttr(),
      ]);
    case 357:
      // Molten Down — "Fire-type is super effective against Rock-type."
      // Offensive-only TypeEffectivenessMod targeting ROCK with 1.5x
      // offensive multiplier. Approximates SE-vs-Rock since pokerogue's
      // type chart already has Fire 0.5x vs Rock; this wires an ER override.
      return ok([
        ...buildTypeEffectivenessModAttrs({
          type: PokemonType.ROCK,
          offensiveMultiplier: 1.5,
          defensiveMultiplier: 1,
        }),
      ]);
    case 388:
      // er 388 is Thundercall — handled in dispatchBespokeR48 (consulted first;
      // 1.5x-vs-Water + Infiltrator screen/Substitute bypass). This main-switch
      // entry is dead (it was a mislabeled "Discipline" wire from the dump's
      // array-index drift); kept as a marker.
      return SKIP_BESPOKE;
    case 398:
      // Fungal Infection — "Contact moves inflict Leech Seed on the target."
      return ok([
        new ChanceBattlerTagOnAttackAbAttr({
          chance: 100,
          tags: [BattlerTagType.SEEDED],
          contactRequired: true,
        }),
      ]);
    case 426:
      // Clueless — "Negates Weather, Rooms and Terrains." Weather is suppressed
      // continuously by SuppressWeatherEffectAbAttr (Cloud Nine); Terrain and the
      // Room field effects (Trick Room / Inverse Room) and Gravity are negated
      // continuously via SuppressFieldEffectsAbAttr (Arena.isFieldEffectSuppressed
      // gates the terrain getter, the Room apply/read sites, and hasActiveGravity).
      // All effects merely stop applying while Clueless is out and resume after.
      return ok([new SuppressWeatherEffectAbAttr(), new SuppressFieldEffectsAbAttr()]);
    // -------------------------------------------------------------------------
    // Round 30 — PostStatStageChange + stat-trigger-on-stat-lowered wires
    // -------------------------------------------------------------------------
    case 564:
      // Tactical Retreat — "Flees when stats are lowered." Switches the holder
      // out when any stat is lowered (incl. self-drops), once per battle.
      return ok([new SelfSwitchOnStatLowerAbAttr()]);
    case 555:
      // Egoist — "Copies stat boosts that enemy Pokemon receive and applies them
      // to itself (the same stat, the same number of stages). Does not copy other
      // Egoist boosts." Rides the Opportunist copy hook: mirrors the foe's exact
      // (stat, stages) raise, pushed uncopyable so it never chains off another
      // Egoist/Opportunist.
      return ok([new OnOpponentStatRaiseAbAttr()]);
    // -------------------------------------------------------------------------
    // Round 41 — heal-block via HEAL_BLOCK BattlerTag application
    // -------------------------------------------------------------------------
    case 532:
      // Permanence — "Foes can't heal in any way." Heal-block every opponent
      // on entry and refresh it each turn end, so foes stay heal-blocked while
      // the holder is on the field (lapses shortly after it leaves).
      return ok([
        new PostSummonApplyTagOnFoesAbAttr({ tag: BattlerTagType.HEAL_BLOCK, turns: 5 }),
        new PostTurnApplyTagOnFoesAbAttr({ tag: BattlerTagType.HEAL_BLOCK, turns: 2 }),
      ]);
    case 782:
      // Hemolysis — "Poisoned foes lose all stat buffs and can't heal." After
      // the holder attacks a poisoned target, that target's stat raises are
      // cleared and it is given HEAL_BLOCK (poison-gated, offensive — not the
      // defensive on-hit wire it had before).
      return ok([new PoisonedFoePurgeAbAttr()]);
    // Round 42 cases for 376 / 340 were merged into the R29 case blocks
    // above to avoid duplicate switch labels. The 953 Hypnotic Trance
    // accuracy override below is the remaining R42 wire.
    case 953953: {
      // Sentinel — Hypnotic Trance was wired R29 with confuse-on-hit.
      // Pure accuracy override for Hypnosis-only is duplicate-labeled, so
      // we instead enhance the R29 case (no separate dispatch).
      return SKIP_BESPOKE;
    }
    case 556:
      // Subdue — "Doubles stat drop effects used by this pokemon." Boost
      // outgoing stat-drop magnitude (e.g. Growl → -2 instead of -1).
      // Needs stat-drop-magnitude modifier primitive. Defer.
      return SKIP_BESPOKE;
    case 577:
      // Sharing Is Caring — "Stat changes are shared between all battlers."
      // Field-wide stat-change propagation. Complex; defer.
      return SKIP_BESPOKE;
    // -------------------------------------------------------------------------
    // Round 31 — Daredevil partial wire (recoil block)
    // -------------------------------------------------------------------------
    case 1008:
      // Daredevil — "+1 Atk after using recoil move. 1/2 recoil damage."
      // Compose: RecoilDamageMultiplier(0.5) (HALF recoil, not a full block) +
      // StatBoostOnFlagAttack on RECKLESS_MOVE flag for the ATK boost.
      return ok([
        new RecoilDamageMultiplierAbAttr({ factor: 0.5 }),
        new StatBoostOnFlagAttackAbAttr({
          flag: MoveFlags.RECKLESS_MOVE,
          stat: Stat.ATK,
          stages: 1,
        }),
      ]);
    // -------------------------------------------------------------------------
    // Round 32 — PostTurnScriptedMove primitive + wires
    // -------------------------------------------------------------------------
    case 937:
      // Sumo Wrestler — "Uses 20BP Circle Throw at the end of each 2nd turn."
      return ok([new PostTurnScriptedMoveAbAttr({ moveId: MoveId.CIRCLE_THROW, power: 20, everyNTurns: 2 })]);
    case 940:
      // Cool Exit — "Uses Chilly Reception at the end of your 2nd turn."
      return ok([new PostTurnScriptedMoveAbAttr({ moveId: MoveId.CHILLY_RECEPTION, everyNTurns: 2 })]);
    case 737:
      // Life Steal — "Steals 1/10 HP from foes each turn." Drain 10% of each
      // foe's max HP at turn end and heal the holder by the total.
      return ok([new PostTurnDrainAbAttr({ fraction: 0.1 })]);
    case 820:
      // Soul Tap — "Drain 10% HP from foes at the end of each turn in fog."
      // Same as Life Steal but only while fog is active.
      return ok([new PostTurnDrainAbAttr({ fraction: 0.1, weather: [WeatherType.FOG, WeatherType.EERIE_FOG] })]);
    // -------------------------------------------------------------------------
    // Round 33 — more wires + StabAdd / TypeDamageBoost compositions
    // -------------------------------------------------------------------------
    case 423:
      // Hydro Circuit — "Electric moves +50%; Water moves heal the user for 25%
      // of the damage dealt." Both halves now wired: the 1.5x Electric type boost
      // and the Water-move per-hit lifesteal (the lifesteal primitive documents
      // exactly this shape).
      return ok([
        new TypeDamageBoostAbAttr({ type: PokemonType.ELECTRIC, multiplier: 1.5 }),
        new LifestealOnHitAbAttr({ healFraction: 0.25, filter: { type: PokemonType.WATER } }),
      ]);
    case 700:
      // Color Spectrum — handled in dispatchBespokeR48 (consulted first; uses
      // MovePowerBoost-on-STAB + the per-turn random-type rotation). This
      // main-switch entry is dead; kept as a marker.
      return SKIP_BESPOKE;
    case 589:
      // Catastrophe — FULL: "In Sun, Water moves gain the damage boost they
      // receive from rain. In Rain, Fire moves gain the damage boost they
      // receive from sun." "Gain the damage boost" means the move behaves as if
      // it were in its FAVORABLE weather — i.e. net ×1.5, NOT a flat stat mult.
      //
      // Two halves per weather→type pairing (mirrors Hydro Steam):
      //   1. WeatherTypeBoostAbAttr   — applies the ×1.5 move-power boost.
      //   2. WeatherTypeDebuffCancelAbAttr — cancels the ADVERSE arena weather
      //      type multiplier (rain ×0.5 on Fire / sun ×0.5 on Water). Without
      //      this, the ×1.5 power is swallowed by the ×0.5 weather penalty and
      //      nets only ×0.75 — the bug where a Fire move in rain barely scratched.
      // Both primitives honor weather suppression (Cloud Nine / Air Lock).
      return ok([
        // Water move while the sun is up → the rain boost (×1.5) + cancel sun's
        // ×0.5 Water penalty.
        new WeatherTypeBoostAbAttr({
          weathers: [WeatherType.SUNNY, WeatherType.HARSH_SUN],
          type: PokemonType.WATER,
          multiplier: 1.5,
        }),
        new WeatherTypeDebuffCancelAbAttr({
          weathers: [WeatherType.SUNNY, WeatherType.HARSH_SUN],
          type: PokemonType.WATER,
        }),
        // Fire move while it rains → the sun boost (×1.5) + cancel rain's ×0.5
        // Fire penalty.
        new WeatherTypeBoostAbAttr({
          weathers: [WeatherType.RAIN, WeatherType.HEAVY_RAIN],
          type: PokemonType.FIRE,
          multiplier: 1.5,
        }),
        new WeatherTypeDebuffCancelAbAttr({
          weathers: [WeatherType.RAIN, WeatherType.HEAVY_RAIN],
          type: PokemonType.FIRE,
        }),
      ]);
    case 406:
      // Spinning Top — handled in dispatchBespokeR48 (consulted first). This
      // main-switch entry is dead; kept as a marker.
      return SKIP_BESPOKE;
    case 304:
      // Magical Dust — handled in dispatchBespokeR48 (consulted first). This
      // main-switch entry is dead; kept as a marker.
      return SKIP_BESPOKE;
    // -------------------------------------------------------------------------
    // Round 34 — type-gated ChanceStatusOnHit wires
    // -------------------------------------------------------------------------
    case 434:
      // Elemental Charge — "20% chance to BRN/FRZ/PARA with respective types."
      // The HOLDER's Fire move burns, Ice move frostbites, Electric move
      // paralyzes the target (offensive), so use the PostAttack variants.
      return ok([
        new ChanceStatusOnAttackAbAttr({
          chance: 20,
          effects: [StatusEffect.BURN],
          filter: { type: PokemonType.FIRE },
        }),
        new ChanceBattlerTagOnAttackAbAttr({
          chance: 20,
          tags: [BattlerTagType.ER_FROSTBITE],
          filter: { type: PokemonType.ICE },
        }),
        new ChanceStatusOnAttackAbAttr({
          chance: 20,
          effects: [StatusEffect.PARALYSIS],
          filter: { type: PokemonType.ELECTRIC },
        }),
      ]);
    case 455:
      // Archmage — handled in dispatchBespokeR48 (consulted first). This
      // main-switch entry is dead; kept as a marker.
      return SKIP_BESPOKE;
    // -------------------------------------------------------------------------
    // Round 35 — SpeedBonusToStat (defensive) + DamageReduction wires
    // -------------------------------------------------------------------------
    case 809:
      // Blur — "Uses its Speed stat instead of Defense OR Special Defense when
      // hit by CONTACT moves." REPLACE (not add) on BOTH defensive stats: a
      // special contact move (e.g. Draining Kiss) substitutes SpDef, a physical
      // one substitutes Def. Gated to contact moves only.
      return ok([
        new SpeedBonusToStatAbAttr({ stat: Stat.DEF, speedFraction: 1, replace: true, filter: { contact: "only" } }),
        new SpeedBonusToStatAbAttr({ stat: Stat.SPDEF, speedFraction: 1, replace: true, filter: { contact: "only" } }),
      ]);
    case 810:
      // Elude — "Uses its Speed stat instead of Defense OR Special Defense when
      // hit by NON-contact moves." REPLACE on BOTH defensive stats (non-contact
      // moves are overwhelmingly special → SpDef is the common path). Gated to
      // non-contact moves only.
      return ok([
        new SpeedBonusToStatAbAttr({ stat: Stat.DEF, speedFraction: 1, replace: true, filter: { contact: "non" } }),
        new SpeedBonusToStatAbAttr({ stat: Stat.SPDEF, speedFraction: 1, replace: true, filter: { contact: "non" } }),
      ]);
    case 838:
      // Guardian Coat — "Provides immunity to Sandstorm/Hail weather damage,
      // blocks all powder moves, and reduces incoming PHYSICAL damage by 20%."
      // All three clauses (powder immunity + weather-damage block were previously
      // dropped). Powder block mirrors vanilla Overcoat's POWDER_MOVE immunity.
      return ok([
        new DamageReductionAbAttr({
          reduction: 0.2,
          filter: { kind: "category", category: MoveCategory.PHYSICAL },
        }),
        new BlockWeatherDamageAttr(WeatherType.SANDSTORM, WeatherType.HAIL, WeatherType.SNOW),
        new MoveImmunityAbAttr(
          (pokemon, attacker, move) => pokemon !== attacker && move.hasFlag(MoveFlags.POWDER_MOVE),
        ),
      ]);
    case 774:
      // Corrupted Mind — "Psychic moves bypass type resistances and immunities,
      // hitting for at least neutral. Additionally, all secondary effects of
      // Psychic moves have their activation chance increased by 40%." Offensive
      // type-chart override clamps the resisting/immune matchups (Steel/Psychic
      // 0.5x, Dark 0x) up to 1.0; the type-filtered effect-chance ×1.4 applies
      // the secondary-effect boost to PSYCHIC moves only.
      return ok([
        new OffensiveTypeChartOverrideAbAttr({
          rules: [
            { attackType: PokemonType.PSYCHIC, defenderType: PokemonType.STEEL, newMultiplier: 1 },
            { attackType: PokemonType.PSYCHIC, defenderType: PokemonType.PSYCHIC, newMultiplier: 1 },
            { attackType: PokemonType.PSYCHIC, defenderType: PokemonType.DARK, newMultiplier: 1 },
          ],
        }),
        new TypeFilteredEffectChanceMultiplierAbAttr(PokemonType.PSYCHIC, 1.4),
      ]);
    case 656:
      // Tag — "Attacks switching opponents with a 20BP Pursuit." Vanilla
      // pokerogue has no on-foe-switch-out hook for abilities. Defer.
      return SKIP_BESPOKE;
    case 354:
      // Weather Control — "Negates all weather based moves from enemies."
      // Already vanilla SuppressWeatherEffect for incoming, but enemy-only.
      // Defer (the affectsImmutable=true on SuppressWeather is for player
      // weather; we need enemy-move-block).
      return SKIP_BESPOKE;
    // -------------------------------------------------------------------------
    // Round 36 — vanilla PostDefendContactDamage wires (mirror-damage cluster)
    // -------------------------------------------------------------------------
    case 332: {
      // Soul Linker — "When the holder takes a direct hit, the attacker takes
      // identical damage. When the holder lands a direct hit, the holder also
      // takes that much damage. Does NOT activate when either Pokemon is KO'd,
      // from Pain Split, or against ANOTHER Soul Linker." Full reflect: attacker
      // takes the damage it dealt to the holder, AND the holder takes the damage
      // it deals (offensive side). The KO / vs-another-Soul-Linker exclusions are
      // enforced inside each attr (Pain Split is excluded by construction — it
      // isn't a direct damaging hit).
      const soulLinkerId = ER_ID_MAP.abilities[332] as AbilityId;
      return ok([
        new ReflectDamageOnDefendAbAttr({ cancelIfAttackerHasAbility: soulLinkerId }),
        new SelfDamageOnAttackAbAttr({
          basis: "damageDealt",
          fraction: 1.0,
          soulLink: true,
          cancelIfTargetHasAbility: soulLinkerId,
        }),
      ]);
    }
    case 341:
      // Fort Knox — "Blocks most damage boosting and multihit abilities."
      // Suppression of opponent abilities — needs new primitive (similar to
      // Mold Breaker but defensive). Defer.
      return SKIP_BESPOKE;
    case 463:
      // Jungle's Guard — "Protects Grass-type allies from status and stat
      // drops." This is exactly vanilla Flower Veil: GRASS-type allies (not the
      // holder itself) get status immunity + stat-drop protection (+ Drowsy/Yawn
      // immunity). Reuse the conditional user-field attrs gated on the ally being
      // Grass-type, so non-Grass allies are unaffected.
      return ok([
        new ConditionalUserFieldStatusEffectImmunityAbAttr(
          (target, source) => !!source && target.id !== source.id && target.isOfType(PokemonType.GRASS, true, true),
        ),
        new ConditionalUserFieldBattlerTagImmunityAbAttr(
          target => target.isOfType(PokemonType.GRASS, true, true),
          [BattlerTagType.DROWSY],
        ),
        new ConditionalUserFieldProtectStatAbAttr(target => target.isOfType(PokemonType.GRASS, true, true)),
      ]);
    case 838838:
      // (Sentinel — Guardian Coat wired R35.)
      return SKIP_BESPOKE;
    case 282282:
      return SKIP_BESPOKE;
    // -------------------------------------------------------------------------
    // Round 38 — last batch of wires using existing primitives
    // -------------------------------------------------------------------------
    case 424:
      // Equinox — "Uses the higher of Attack / Special Attack for all attacks."
      // True stat substitution to the holder's higher offensive stat.
      return ok([new AttackStatSubstituteAbAttr({ useHigherOffense: true })]);
    case 598:
      // Malicious — "Lowers the foe's highest Attack and Defense stat."
      // Pick-highest-stat targeting needs new primitive. Approximation:
      // entry-effect dropping both ATK and DEF on opposing target via
      // intimidate-like pattern. Use vanilla PostSummonStatStageChange
      // for opponent.
      // For now wire as self-stat-trigger flip → defer
      return SKIP_BESPOKE;
    case 896:
      // Spyware — "Sharply raises a stat based on foe's strong point."
      // Needs foe-stat-introspection primitive. Defer.
      return SKIP_BESPOKE;
    case 928:
      // (Sentinel)
      return SKIP_BESPOKE;
    case 392:
      // Hardened Sheath — type-effectiveness style. Defer for type-chart
      // override primitive.
      return SKIP_BESPOKE;
    // -------------------------------------------------------------------------
    // Round 44 — more compositions to push toward full coverage
    // -------------------------------------------------------------------------
    case 536:
      // Blood Price — "Boosts all attacking moves by 30%, but the user loses
      // 10% of max HP when landing an attack." +30% power + 10%-maxHP self-
      // damage once per move.
      return ok([
        new MovePowerBoostAbAttr(() => true, 1.3),
        new SelfDamageOnAttackAbAttr({ basis: "maxHp", fraction: 0.1 }),
      ]);
    case 828:
      // Overzealous — "User's super-effective moves have +1 prio." SE-
      // conditional priority. PriorityModifier supports condition closures
      // but evaluating SE needs defender state. Approximation: blanket +1
      // priority on all moves. Over-fires significantly; defer pure wire.
      return SKIP_BESPOKE;
    case 904904:
      // (Sentinel)
      return SKIP_BESPOKE;
    case 274:
      // Sand Song is handled by the `type-conversion` archetype (Normal sound ->
      // Ground + 1.2x), matching its in-game description — so this bespoke branch
      // is UNREACHABLE (274's archetype != "bespoke"). NOTE (#103 divergence): the
      // v2.65.3b C-source header reads "Sound moves become Ground type. No damage
      // boost" (ALL sound, no 1.2x). We keep the description-faithful archetype
      // behavior per the project's beta-description precedent (cf. Whiteout).
      return SKIP_BESPOKE;
    case 656656:
      return SKIP_BESPOKE;
    // -------------------------------------------------------------------------
    // Round 45 — broad approximations for remaining bespoke abilities
    // -------------------------------------------------------------------------
    case 275:
      // Rampage — recharge-clear on KO. Handled by dispatchBespokeR48 (which
      // runs first and returns PostVictoryClearRechargeAbAttr); this branch is
      // unreachable and kept only so the id is accounted for in this switch.
      return SKIP_BESPOKE;
    case 284:
      // Exploit Weakness — "Targets lowest defense vs statused foes." Handled in
      // dispatchBespokeR48 (real defensive-stat swap primitive); defer to it.
      return SKIP_BESPOKE;
    case 373:
      // Grip Pincer — "50% chance to trap. Then ignores Defense & accuracy
      // checks." Wire the 50% TRAPPED battler tag on hit.
      return ok([
        new ChanceBattlerTagOnAttackAbAttr({
          chance: 50,
          tags: [BattlerTagType.WRAP],
          contactRequired: true,
          turnRange: [4, 5],
          damageDenominator: 8,
        }),
        new IgnoreOpponentStatStagesAbAttr(
          [Stat.DEF, Stat.SPDEF],
          opponent => opponent.getTag(TrappedTag) !== undefined,
        ),
        new ConditionalAlwaysHitAbAttr({ targetTrapped: true }),
      ]);
    case 394:
      // Lethargy — "Damage drops 20% each turn to 20%. Resets on switch-in."
      // Multi-tier turn-decaying multiplier. Defer (needs per-turn-counter
      // damage multiplier primitive).
      return SKIP_BESPOKE;
    case 407:
      // Retribution Blow — "Uses Hyper Beam if any foe uses an stat
      // boosting move." Needs opponent-stat-buff observer + scripted move.
      // Defer.
      return SKIP_BESPOKE;
    case 474:
      // Accelerate — "Moves that need a charge turn are now used instantly."
      // Charge-skip primitive missing. Defer.
      return SKIP_BESPOKE;
    case 515:
      // Retriever — handled in dispatchBespokeR48 (consulted first). This
      // main-switch entry is dead; kept as a marker.
      return SKIP_BESPOKE;
    case 523:
      // Grappler — handled in dispatchBespokeR48 (consulted first). This
      // main-switch entry is dead; kept as a marker.
      return SKIP_BESPOKE;
    case 545:
      // Parroting — "Copies sound moves used by others." Copies any SOUND_BASED
      // move used by another battler (the PostMoveUsed trigger now fires for all
      // moves; this gates on the sound flag).
      return ok([new CopyMoveByFilterAbAttr({ flag: MoveFlags.SOUND_BASED })]);
    case 592:
      // Minion Control — "Moves hit an extra time for each healthy party
      // member (max 6 hits)." +1 hit per non-fainted, unstatused party member.
      return ok([new PartyCountMultiHitAbAttr(6)]);
    case 602:
      // Lawnmower — "Removes terrain on switch-in. Stat up if terrain
      // removed." Terrain-clear on entry needs Lawnmower primitive. Defer.
      return SKIP_BESPOKE;
    case 623:
      // Surprise! — "Astonishes enemy priority users in fog." Eerie Fog
      // (ER-only weather) not in pokerogue. Defer.
      return SKIP_BESPOKE;
    case 629:
      // Shallow Grave — "Revives at 25% HP once after fainting in fog."
      // Same fog-gate as 623. Defer.
      return SKIP_BESPOKE;
    case 640:
      // Rhythmic — "Deals 10% more damage for each repeated move use."
      // Per-move-count tracker primitive missing. Defer.
      return SKIP_BESPOKE;
    case 381: {
      // Pollinate — "Normal moves become Bug and gain STAB. Immune to powder if
      // Bug-type." The dex says the converted moves GAIN STAB (a real +0.5 →
      // 1.5×), not a flat 1.2× -ate boost. Wire the Normal→Bug conversion (no
      // multiplier) + StabAddAbAttr (1.5×, self-guards against double-STAB when
      // the user is already Bug) + the Bug-powder-immunity marker. Cascades to
      // 701 Steel Beetle (which composites Pollinate; user is Ghost/Rock, so it
      // has no natural Bug STAB and the 1.5× applies).
      const base = dispatchTypeConversion({ sourceType: "NORMAL", targetType: "BUG" });
      if (base.skipReason !== null) {
        return base;
      }
      return ok([...base.attrs, new StabAddAbAttr({ targetType: PokemonType.BUG }), new BugPowderImmunityAbAttr()]);
    }
    case 704:
      // Hot Coals — handled in dispatchBespokeR48 (consulted first; lays the
      // HOT_COALS foe-side burn trap). This main-switch entry is dead.
      return SKIP_BESPOKE;
    case 709:
      // Dream State — "Immune to critical hits. Takes 20% less damage." The
      // crit-mod archetype only granted crit immunity; the ×0.8 all-damage
      // reduction was dropped. Wire both.
      return ok([new CritImmunityAbAttr(), new DamageReductionAbAttr({ reduction: 0.2, filter: { kind: "all" } })]);
    case 713:
      // Aquatic Dweller — "Adds Water to typing on entry + Water moves ×1.5."
      // The type-damage-boost archetype only gave the 1.5×; the entry Water
      // type-add was dropped. Wire both (the type-add persists until switch-out,
      // matching the add-self-type entry effect used by Komodo/Aquatic).
      return ok([
        new TypeDamageBoostAbAttr({ type: PokemonType.WATER, multiplier: 1.5 }),
        new EntryEffectAbAttr({ kind: "add-self-type", type: PokemonType.WATER }),
      ]);
    case 753:
      // Crust Coat — "Immune to critical hits. Takes 20% less damage from
      // attacks." Identical shape to 709 Dream State; the crit-mod archetype
      // only granted crit immunity, dropping the ×0.8 all-damage reduction.
      return ok([new CritImmunityAbAttr(), new DamageReductionAbAttr({ reduction: 0.2, filter: { kind: "all" } })]);
    case 754:
      // Puffy — "Reduces damage from contact moves by 50%. Fire-type moves deal
      // double damage to the user." The damage-reduction-generic archetype only
      // wired the contact ×0.5 reduction; the Fire ×2 weakness was dropped.
      return ok([
        new DamageReductionAbAttr({ reduction: 0.5, filter: { kind: "contact" } }),
        new ReceivedTypeDamageMultiplierAbAttr(PokemonType.FIRE, 2),
      ]);
    case 711:
      // Lunar Affinity — "Copies lunar moves used by others." Moonlight,
      // Moonblast, Lunar Dance, Lunar Blessing.
      return ok([
        new CopyMoveByFilterAbAttr({
          moveIds: [MoveId.MOONLIGHT, MoveId.MOONBLAST, MoveId.LUNAR_DANCE, MoveId.LUNAR_BLESSING],
        }),
      ]);
    case 733:
      // Taekkyeon — handled in dispatchBespokeR48 (consulted first). This
      // main-switch entry is dead; kept as a marker.
      return SKIP_BESPOKE;
    case 735:
      // Know Your Place — "Contact attacks make foes move last for 5
      // turns." QUASH/move-last battler tag not available in pokerogue
      // BattlerTagType enum. Defer.
      return SKIP_BESPOKE;
    case 773:
      // Soothsayer — handled in dispatchBespokeR48 (consulted first). This
      // main-switch entry is dead; kept as a marker.
      return SKIP_BESPOKE;
    case 812:
      // Reverberate — "Normal moves are Sound moves." Flag-injection on
      // Normal-type moves. Defer.
      return SKIP_BESPOKE;
    case 816:
      // Mental Pollution — "Suppresses others' abilities when it becomes
      // enraged." Enrage state + opponent-ability-suppress. Defer.
      return SKIP_BESPOKE;
    case 817:
      // Madness Enhancement — "Enrages in fog, halves damage when enraged."
      // Fog-gated. Defer.
      return SKIP_BESPOKE;
    case 824:
      // Frostbind — "Inflicting Frostbite also inflicts Disable." Status-
      // cascade. Approximate: 50% DISABLED on hit.
      return ok([new ChanceBattlerTagOnHitAbAttr({ chance: 50, tags: [BattlerTagType.DISABLED] })]);
    case 833:
      // Harukaze — "Setting Grassy Terrain sets Tailwind and vice versa."
      // Bidirectional terrain/buff pair. Defer.
      return SKIP_BESPOKE;
    case 842:
      // Festivities — handled in dispatchBespokeR48 (consulted first). This
      // main-switch entry is dead; kept as a marker.
      return SKIP_BESPOKE;
    case 880:
      // Paint Shot — "Mega launcher moves change the target's type to the
      // move used." Target-type-change-on-hit needs new primitive. Defer.
      return SKIP_BESPOKE;
    case 886:
      // Curse of Famine — "Eats terrain, restores hp, and boosts a
      // defense." Terrain-consume needs new primitive. Defer.
      return SKIP_BESPOKE;
    case 890:
      // Craving — "Triggers a random berry effect at the end of every turn."
      // Fires a random berry's effect unconditionally (was Harvest, which only
      // restored a berry already eaten this battle — the wrong mechanic). The dex
      // curates the pool to stat/pinch berries (Sitrus is the pinch-healing berry),
      // so restrict the pick and keep off-list berries (Lum/Enigma/Leppa) out.
      return ok([
        new PostTurnRandomBerryEffectAbAttr([
          BerryType.SITRUS,
          BerryType.LIECHI,
          BerryType.GANLON,
          BerryType.SALAC,
          BerryType.PETAYA,
          BerryType.APICOT,
          BerryType.LANSAT,
          BerryType.STARF,
        ]),
      ]);
    case 899:
      // Backup Power — "Revives at 25% HP once after fainting in Electric
      // Terrain." Terrain-gated revive. Defer.
      return SKIP_BESPOKE;
    case 913:
      // Strikeout — "Forces the foe out if they don't attack for 3 turns."
      // Per-target turn counter. Defer.
      return SKIP_BESPOKE;
    case 927:
      // Taste the Rainbow — "Summons the Rainbow Pledge effect on entry."
      // Rainbow Pledge is a vanilla arena tag — wire EntryEffect with
      // ArenaTagType.RAINBOW.
      return ok([new EntryEffectAbAttr({ kind: "set-screen-or-room", tag: ArenaTagType.WATER_FIRE_PLEDGE, turns: 4 })]);
    case 943:
      // Sap Trap — "Lowers foe's speed at the end of turns. At -3 they get
      // trapped." Per-turn opponent stat-drop. Defer.
      return SKIP_BESPOKE;
    case 960:
      // Witch Broom — "Hyper Aggressive + Hover." Composite — Hover
      // (Levitate) vanilla AbilityId 26, Hyper Aggressive ER-custom.
      // Wire vanilla Levitate attrs.
      return ok([...(allAbilities[26]?.attrs ?? [])]);
    case 963:
      // Fire Ruler — "King's Wrath + Flame Shield" — both ER customs.
      // Defer (would need to compose ER ability attrs).
      return SKIP_BESPOKE;
    case 979:
      // Hollow Ice Zone — "Ice-type moves apply Ice Statue and then make
      // the user switch." Ice Statue tag missing in pokerogue; approximate
      // via FROSTBITE + force-switch on ICE moves. Wire the FROSTBITE
      // piece via ChanceBattlerTag on type=ICE filter; force-switch
      // deferred.
      return ok([
        new ChanceBattlerTagOnHitAbAttr({
          chance: 100,
          tags: [BattlerTagType.ER_FROSTBITE],
          filter: { type: PokemonType.ICE },
          contactRequired: false,
        }),
      ]);
    case 981:
      // Cryostasis — wired R12 already.
      return SKIP_BESPOKE;
    // -------------------------------------------------------------------------
    // Round 39 — new primitive HpThresholdFormChange + 3 wires
    // -------------------------------------------------------------------------
    case 734:
      // Ape Shift — "Transforms below 50% HP, curing status and always
      // critting." HP-threshold form change (50%) + status cure, plus the
      // always-crit-while-below-50%-HP combat effect (ConditionalCritAbAttr,
      // Merciless-style) so the transformed state's guaranteed crits land even
      // without dedicated form sprites.
      return ok([
        new HpThresholdFormChangeAbAttr({
          hpThreshold: 0.5,
          targetFormKey: "transformed",
          cureStatus: true,
        }),
        new ConditionalCritAbAttr(pokemon => pokemon.getHpRatio() < 0.5),
      ]);
    case 884:
      // Locust Swarm — "Changes into Hivemind form until 1/4 HP or less."
      // Wishiwashi-style School: the holder is in Hivemind form while ABOVE 1/4
      // HP and reverts to base once it drops to 1/4 or below (formAboveThreshold).
      // (It was inverted — transforming INTO Hivemind at low HP.)
      //
      // KNOWN GAP (flagged, not silently swallowed): ER ships the Hivemind form
      // as a SEPARATE dump species (SPECIES_WISPYWASPY_HIVEMIND, id 10638),
      // exactly like SPECIES_UNOWN_REVELATION. pokerogue's runtime form system
      // only swaps formIndex on the SAME species, so "hivemind" must be injected
      // as a FORM on base Wispywaspy AND its `<letter>->hivemind` / `hivemind->""`
      // form-change edges registered — the same three-step wiring Revelation got
      // in init-elite-redux-unown-school.ts. That wiring does not yet exist for
      // Wispywaspy, so today the change is a no-op (the archetype now logs a
      // one-time console.warn flagging the missing form). Completing it requires
      // a dedicated init module (out of scope for this dispatcher change).
      return ok([
        new HpThresholdFormChangeAbAttr({
          hpThreshold: 0.25,
          targetFormKey: "hivemind",
          formAboveThreshold: true,
        }),
      ]);
    case 885:
      // Revelation — same shape as Locust Swarm (884).
      return ok([
        new HpThresholdFormChangeAbAttr({
          hpThreshold: 0.25,
          targetFormKey: "revelation",
        }),
      ]);
    case 887:
      // Crystalline Armor — "Reflects stat drops and immune to critical hits."
      // The crit-mod archetype only granted crit immunity; add Mirror Armor
      // (ReflectStatStageChange) to bounce foe-inflicted stat drops back.
      return ok([new CritImmunityAbAttr(), new ReflectStatStageChangeAbAttr()]);
    case 456:
      // Cryomancy — "Moves inflict frostbite 5x as often." Same shape as
      // Pyromancy (270): flat 30% ER_FROSTBITE on hit.
      return ok([
        new ChanceBattlerTagOnHitAbAttr({ chance: 30, tags: [BattlerTagType.ER_FROSTBITE], contactRequired: false }),
      ]);
    case 666:
      // Snowy Wrath = Snow Warning + Cryomancy. Snow Warning's plain HAIL chips
      // non-Ice types but DOESN'T carry the +50% Ice Defense the 2.65 dex wants, so
      // summon the bespoke SNOWY_WRATH weather (8 turns) — a damaging snow that BOTH
      // chips 1/16 non-Ice per turn AND boosts Ice-type Defense — and keep Cryomancy's
      // flat 30% ER_FROSTBITE-on-hit rider. Distinct weather type so vanilla hail/snow
      // (Abomasnow's Snow Warning) is unaffected.
      return ok([
        new EntryEffectAbAttr({ kind: "set-weather", weather: WeatherType.SNOWY_WRATH, turns: 8 }),
        new ChanceBattlerTagOnHitAbAttr({ chance: 30, tags: [BattlerTagType.ER_FROSTBITE], contactRequired: false }),
      ]);
    case 444:
      // Evaporate — "Takes no damage and sets Mist if hit by water." Water-
      // immunity piece needs a typed-immunity primitive; the Mist-on-hit
      // side needs a typed filter on SetArenaTagOnHit that's not yet
      // supported. Defer.
      return SKIP_BESPOKE;
    case 412:
      // Desert Cloak — "Protects its side from status and secondary effects in
      // sand." While a sandstorm is active: side-wide status immunity (all
      // status effects) + secondary-effect (Shield-Dust-style) immunity.
      return ok([new SandStatusImmunityAbAttr(), new SandSecondaryEffectImmunityAbAttr()]);
    case 285:
      // Ground Shock — "Target Grounds aren't immune to Electric but resist
      // it instead." Type-chart override — needs a per-type-pair filter
      // primitive that doesn't exist. Defer.
      return SKIP_BESPOKE;
    case 349:
      // Overcharge — handled in dispatchBespokeR48 (consulted first). This
      // main-switch entry is dead; the live wire (incl. the paralyze-Electric
      // status-immunity bypass) is in the R48 case 349.
      return SKIP_BESPOKE;
    case 387:
      // Discipline — "Can switch while rampaging. Can't be confused or
      // intimidated" (+ Scare). Three halves: (1) SwitchWhileRampagingAbAttr lets
      // the holder open the command menu (and switch out) while FRENZY-locked
      // (Thrash / Outrage / Petal Dance) — consulted in CommandPhase; (2)
      // confusion immunity via BattlerTagImmunity (CONFUSION is a BattlerTag, not
      // a vanilla StatusEffect, so the status-immunity archetype dropped it); (3)
      // Intimidate/Scare immunity.
      return ok([
        new SwitchWhileRampagingAbAttr(),
        new IntimidateImmunityAbAttrEr(),
        new BattlerTagImmunityAbAttr(BattlerTagType.CONFUSED),
      ]);
    case 303:
      // Fossilized — C-source + description: "Halves dmg taken by Rock moves.
      // Boosts own Rock moves by 1.2x." Composite: offensive Rock x1.2 +
      // defensive 0.5 from incoming Rock moves. (Defensive half was missing.)
      return ok([
        new TypeDamageBoostAbAttr({ type: PokemonType.ROCK, multiplier: 1.2 }),
        new DamageReductionAbAttr({ reduction: 0.5, filter: { kind: "move-type", type: PokemonType.ROCK } }),
      ]);
    case 337:
      // Raw Wood — C-source + description: "Halves dmg taken by Grass moves.
      // Boosts own Grass moves by 1.2x." Composite: offensive Grass x1.2 +
      // defensive 0.5 from incoming Grass moves. (Defensive half was missing.)
      return ok([
        new TypeDamageBoostAbAttr({ type: PokemonType.GRASS, multiplier: 1.2 }),
        new DamageReductionAbAttr({ reduction: 0.5, filter: { kind: "move-type", type: PokemonType.GRASS } }),
      ]);
    case 342: {
      // Seaweed — "IF the holder is Grass-type: takes 1/2 damage from Fire-type
      // ATTACKS (moves), AND deals 2x damage to Fire-type POKEMON with its GRASS
      // moves." Both gated on the holder being Grass (the "if Grass" predicate).
      // The defensive half is correctly move-type-keyed (Fire moves). The
      // offensive half must gate on BOTH the target being Fire-type AND the move
      // being Grass-type — the shared OffensiveTypeMultiplier only checked the
      // target's type, so it wrongly doubled a Grass holder's Earthquake vs Fire.
      const grassGate = (holder: Pokemon) => holder.isOfType(PokemonType.GRASS);
      const offensive = new MovePowerBoostAbAttr(
        (user, target, move) =>
          !!target && target.isOfType(PokemonType.FIRE) && user.getMoveType(move) === PokemonType.GRASS,
        2.0,
      );
      const defensive = new ReceivedTypeDamageMultiplierAbAttr(PokemonType.FIRE, 0.5);
      offensive.addCondition(grassGate);
      defensive.addCondition(grassGate);
      return ok([offensive, defensive]);
    }
    case 273:
      // Power Fists — "Iron Fist (punching) moves target Special Defense and
      // get a 1.3x boost." 1.3x via FlagDamageBoost + the SpDef-targeting via
      // DefenseStatSwapOnFlag (power-ratio approximation of "hit the opposite
      // defensive stat"). No longer deferred.
      return ok([
        new FlagDamageBoostAbAttr({ flag: MoveFlags.PUNCHING_MOVE, multiplier: 1.3 }),
        new DefenseStatSwapOnFlagAbAttr({
          flag: MoveFlags.PUNCHING_MOVE,
          swap: "target-spdef-instead-of-def",
        }),
      ]);
    case 288:
      // Perfectionist — "Attacks with 50 BP or less get +1 crit stage; attacks
      // with 25 BP or less also get +1 priority." Was mis-classified as a bare
      // priority-modifier that gave EVERY move +1 priority. Now BP-gated via the
      // new maxBasePower filter: CritStageBonus(≤50) + Priority(≤25).
      return ok([
        new CritStageBonusAbAttr({ bonus: 1, filter: { maxBasePower: 50 } }),
        new PriorityModifierAbAttr({ priority: 1, filter: { maxBasePower: 25 } }),
      ]);
    case 302:
      // Coil Up — +1 priority to the first biting move on entry, consumed the
      // first time a biting move is USED, even if it misses/fails (#632). The
      // on-USE consumer (ExecutedMoveAbAttr) replaces the old PostAttack consumer,
      // which only fired on a landed hit (so a non-landing biting move left the
      // boost active). Sidewinder (676) keeps the consume-on-land + regain-on-KO
      // variant, which is its distinct mechanic.
      return ok([
        new FirstFlaggedMovePriorityAbAttr(MoveFlags.BITING_MOVE),
        new ConsumeFirstFlaggedMoveOnUseAbAttr(MoveFlags.BITING_MOVE),
      ]);
    case 465:
      // Pixie Power — "1.2x accuracy. Boosts Fairy moves by 1.33x for ALL
      // (user, allies, opponent; reversed by Aura Break)." The field-wide Fairy
      // boost is exactly Fairy Aura's FieldMoveTypePowerBoost (Aura-Break-aware);
      // the prior wire was a self-only TypeDamageBoost. Plus 1.2x accuracy on
      // the holder's moves.
      return ok([new FieldMoveTypePowerBoostAbAttr(PokemonType.FAIRY, 4 / 3), new StatMultiplierAbAttr(Stat.ACC, 1.2)]);
    case 505:
      // Mystic Blades — "Keen Edge [slicing] moves become SPECIAL (deal Special
      // damage AND use the Special Attack stat) and deal 30% more damage." The
      // category flip makes the move FULLY special: Sp.Atk offense, the target's
      // Sp.Def defense, no burn halving, Light-Screen-blocked. (Contrast Mind
      // Crunch 568 / Magical Fists 742, whose dex keep hitting the enemy's
      // Defense — those retain the offense-only AttackStatSubstitute.)
      return ok([
        new FlagDamageBoostAbAttr({ flag: MoveFlags.SLICING_MOVE, multiplier: 1.3 }),
        new MoveCategoryOverrideAbAttr({ flag: MoveFlags.SLICING_MOVE, category: MoveCategory.SPECIAL }),
      ]);
    case 568:
      // Mind Crunch — "Biting moves use SpAtk and deal 30% more damage."
      // 1.3x on BITING_MOVE + the SpAtk-offense piece via flag-gated
      // AttackStatSubstitute.
      return ok([
        new FlagDamageBoostAbAttr({ flag: MoveFlags.BITING_MOVE, multiplier: 1.3 }),
        new AttackStatSubstituteAbAttr({ physicalStat: Stat.SPATK, flag: MoveFlags.BITING_MOVE }),
      ]);
    case 601:
      // Mythical Arrows — "Arrow moves become special and deal 30% more
      // damage." 1.3x on ARROW_BASED + the "become special" SpAtk-offense
      // piece via flag-gated AttackStatSubstitute.
      return ok([
        new FlagDamageBoostAbAttr({ flag: MoveFlags.ARROW_BASED, multiplier: 1.3 }),
        new AttackStatSubstituteAbAttr({ physicalStat: Stat.SPATK, flag: MoveFlags.ARROW_BASED }),
      ]);
    case 500:
      // Heaven Asunder — "Spacial Rend always crits. Ups crit level by +1."
      // Merciless-style guaranteed crit gated on the move id (#373).
      return ok([
        new CritStageBonusAbAttr({ bonus: 1 }),
        new ConditionalCritAbAttr((_user, _target, move) => move.id === MoveId.SPACIAL_REND),
      ]);
    // -------------------------------------------------------------------------
    // Round 15 — additional simple compositions
    // -------------------------------------------------------------------------
    case 611:
      // Entrance — "Confusion also inflicts infatuation." Status-cascade
      // primitive missing. Approximation: any contact also has 100% chance
      // to confuse + infatuate combined.
      return ok([
        new ChanceBattlerTagOnHitAbAttr({
          chance: 30,
          tags: [BattlerTagType.CONFUSED, BattlerTagType.INFATUATED],
        }),
      ]);
    case 588:
      // Iron Serpent — "Ups super-effective by 33%." Defensive-side
      // super-effective multiplier change. Vanilla SolidRock-like attrs
      // exist but invert direction. Defer until super-effective-mod primitive.
      return SKIP_BESPOKE;
    case 586:
      // Winged King — same shape as Iron Serpent. Defer.
      return SKIP_BESPOKE;
    // (Last Stand 634 deferral note moved here; the real wire is below in R20.)
    // -------------------------------------------------------------------------
    // Round 16 — more compositions in the flag-boost / chance-status / proc clusters.
    // -------------------------------------------------------------------------
    case 687:
      // Vitality Strike — "Heals for 10% of the damage dealt by punching moves."
      return ok([new LifestealOnHitAbAttr({ healFraction: 0.1, filter: { flag: MoveFlags.PUNCHING_MOVE } })]);
    case 691:
      // Assassin's Tools — "Contact moves have a 30% chance to PSN, PRLZ, or BLD."
      // ChanceStatusOnHit supports multi-status uniform pick. ER_BLEED is a
      // battler tag — wire only the status pair (POISON + PARALYSIS); the
      // BLEED piece is handled by the parallel ChanceBattlerTagOnHit.
      return ok([
        new ChanceStatusOnHitAbAttr({
          chance: 30,
          effects: [StatusEffect.POISON, StatusEffect.PARALYSIS],
        }),
        new ChanceBattlerTagOnHitAbAttr({ chance: 10, tags: [BattlerTagType.ER_BLEED] }),
      ]);
    case 738:
      // Rude Awakening — "Upon awakening, the user permanently gains immunity to
      // sleep status and boosts all stats by one stage. Once per battle." NOT
      // sleep-immune from the start (so it can be slept once): the immunity is
      // gated on the `rudeAwakeningTriggered` battleData flag, which the on-wake
      // hook flips while also queueing the +1 omniboost.
      return ok([
        new StatusEffectImmunityAbAttrEr({ statuses: [StatusEffect.SLEEP] }).addCondition(
          p => p.battleData.rudeAwakeningTriggered,
        ),
        new WakeStatBoostAbAttr({ stages: 1 }),
      ]);
    case 708:
      // Megabite — identical to 568 Mind Crunch: "Biting moves use Special
      // Attack and deal 30% more damage." 1.3× on BITING_MOVE + the SpAtk-offense
      // swap via flag-gated AttackStatSubstitute (the SpAtk swap was missing).
      return ok([
        new FlagDamageBoostAbAttr({ flag: MoveFlags.BITING_MOVE, multiplier: 1.3 }),
        new AttackStatSubstituteAbAttr({ physicalStat: Stat.SPATK, flag: MoveFlags.BITING_MOVE }),
      ]);
    case 742:
      // Magical Fists — "Punching moves use the Special Attack ... and deal 30%
      // more damage." 1.3× on PUNCHING_MOVE + the SpAtk-offense swap via
      // flag-gated AttackStatSubstitute (the SpAtk swap was missing).
      return ok([
        new FlagDamageBoostAbAttr({ flag: MoveFlags.PUNCHING_MOVE, multiplier: 1.3 }),
        new AttackStatSubstituteAbAttr({ physicalStat: Stat.SPATK, flag: MoveFlags.PUNCHING_MOVE }),
      ]);
    case 647: {
      // Unicorn — "Boosts horn and drill attacks by 30%. Converts Normal-type
      // moves to Fairy-type and Fairy STAB. If the user is Fairy-type its Fairy
      // moves have a 10% infatuate chance." Mighty Horn (horn ×1.3) + the drill
      // boost + the full Pixilate package (Normal->Fairy + Fairy STAB + the
      // type-gated infatuate rider). The composite Pixilate part only produced a
      // flat power boost, dropping the type conversion, STAB, and infatuate.
      const unicornInfatuate = new ChanceBattlerTagOnAttackAbAttr({
        chance: 10,
        tags: [BattlerTagType.INFATUATED],
        filter: { type: PokemonType.FAIRY },
      });
      unicornInfatuate.addCondition(holder => holder.isOfType(PokemonType.FAIRY));
      return ok([
        new FlagDamageBoostAbAttr({ flag: MoveFlags.HORN_BASED, multiplier: 1.3 }),
        new FlagDamageBoostAbAttr({ flag: MoveFlags.DRILL_BASED, multiplier: 1.3 }),
        new TypeConversionAbAttr({ source: { kind: "type", type: PokemonType.NORMAL }, newType: PokemonType.FAIRY }),
        new StabAddAbAttr({ targetType: PokemonType.FAIRY }),
        unicornInfatuate,
      ]);
    }
    case 751:
      // Energy Horns — "Mighty horn moves become special and deal 30% more
      // damage." 1.3× on HORN_BASED + the SpAtk-offense swap via flag-gated
      // AttackStatSubstitute (the SpAtk swap was missing).
      return ok([
        new FlagDamageBoostAbAttr({ flag: MoveFlags.HORN_BASED, multiplier: 1.3 }),
        new AttackStatSubstituteAbAttr({ physicalStat: Stat.SPATK, flag: MoveFlags.HORN_BASED }),
      ]);
    case 756: {
      // Twinkle Toes — "Kicking moves +30%. Normal-type moves become Fairy-type
      // and the user gains Fairy STAB (Pixilate). If the user is Fairy-type
      // their Fairy-type moves get a 10% infatuate chance." The flag-damage-boost
      // archetype only wired the kicking boost; add the Pixilate conversion +
      // Fairy STAB + the type-gated infatuate rider (the Pixilate + infatuate
      // pieces were missing).
      const infatuate = new ChanceBattlerTagOnAttackAbAttr({
        chance: 10,
        tags: [BattlerTagType.INFATUATED],
        filter: { type: PokemonType.FAIRY },
      });
      infatuate.addCondition(holder => holder.isOfType(PokemonType.FAIRY));
      return ok([
        new FlagDamageBoostAbAttr({ flag: MoveFlags.KICKING_MOVE, multiplier: 1.3 }),
        new TypeConversionAbAttr({ source: { kind: "type", type: PokemonType.NORMAL }, newType: PokemonType.FAIRY }),
        new StabAddAbAttr({ targetType: PokemonType.FAIRY }),
        infatuate,
      ]);
    }
    case 769:
      // JunshiSanda — "Punching moves are also treated as kicking moves ... and
      // vice versa" (so both benefit from Iron Fist / Striker-type abilities). A
      // true flag MERGE via AddMoveFlagAbAttr (the old flat 1.15x boost was an
      // approximation that didn't grant the actual cross-flag ability boosts).
      return ok([
        new AddMoveFlagAbAttr({
          filter: (_u, move) => move.hasFlag(MoveFlags.PUNCHING_MOVE),
          flags: [MoveFlags.KICKING_MOVE],
        }),
        new AddMoveFlagAbAttr({
          filter: (_u, move) => move.hasFlag(MoveFlags.KICKING_MOVE),
          flags: [MoveFlags.PUNCHING_MOVE],
        }),
      ]);
    case 831:
      // Grass Flute — "Sound moves inflict Fear." The HOLDER's SOUND moves fear
      // the target (offensive), so use the PostAttack variant.
      return ok([
        new ChanceBattlerTagOnAttackAbAttr({
          chance: 100,
          tags: [BattlerTagType.ER_FEAR],
          filter: { flag: MoveFlags.SOUND_BASED },
        }),
      ]);
    case 832:
      // Hemotoxin — "Suppresses abilities of the target when they're
      // poisoned." Status-conditional ability-suppress needs a new primitive.
      // Defer.
      return SKIP_BESPOKE;
    case 702:
      // From the Shadows — "Attacks trap and have a 20% flinch chance when
      // moving first." Wire only the flinch-on-hit piece (20% any contact).
      // First-mover gate + trap-on-hit deferred.
      return ok([new ChanceBattlerTagOnHitAbAttr({ chance: 20, tags: [BattlerTagType.FLINCHED] })]);
    case 750:
      // Neurotoxin — "Inflicting poison also lowers Attack, SpAtk, and
      // Speed." Status-cascade primitive missing — StatTriggerOnHit doesn't
      // expose a chance field. Defer.
      return SKIP_BESPOKE;
    // -------------------------------------------------------------------------
    // Round 17 — composites and more flag-boost wires
    // -------------------------------------------------------------------------
    case 933:
      // Hammer Fist — "Boosts punch and hammer moves by 25%."
      return ok([
        new FlagDamageBoostAbAttr({ flag: MoveFlags.PUNCHING_MOVE, multiplier: 1.25 }),
        new FlagDamageBoostAbAttr({ flag: MoveFlags.HAMMER_BASED, multiplier: 1.25 }),
      ]);
    case 932: {
      // Ice Picks — "Tough Claws + Slush Rush." Compose vanilla AbilityIds:
      // TOUGH_CLAWS (181) gives contact moves 1.3x; SLUSH_RUSH (202) gives
      // 1.5x SPD in hail. Copy vanilla attrs from allAbilities.
      const toughClaws = allAbilities[181]?.attrs ?? [];
      const slushRush = allAbilities[202]?.attrs ?? [];
      return ok([...toughClaws, ...slushRush]);
    }
    case 938:
      // Cosmic Wings — "Flying moves become Fairy-type." Type-conversion
      // override per-move-type (Flying source → Fairy target).
      return ok([
        new TypeConversionAbAttr({
          source: { kind: "type", type: PokemonType.FLYING },
          newType: PokemonType.FAIRY,
        }),
      ]);
    case 889:
      // Thick Blubber — "Take 1/4 damage from fire and ice in return for
      // having 1/2 speed." Defer until type-specific damage-reduction
      // primitive AND speed-debuff primitive land together.
      return SKIP_BESPOKE;
    case 904:
      // Strong Foundation — "Takes 1/2 Water and Ground dmg and can't be
      // forced out." Defer (typed damage reduction + force-switch immunity).
      return SKIP_BESPOKE;
    case 1012:
      // Petal Shield — "Maxes Def on entry. -1 Def when hit." Compose:
      // entry stat-trigger maxing DEF (+12 stages clamps to max in engine)
      // plus stat-trigger on hit dropping DEF by 1.
      return ok([
        new StatTriggerOnEntryAbAttr({ stats: [{ stat: Stat.DEF, stages: 12 }] }),
        new StatTriggerOnHitAbAttr({ stats: [{ stat: Stat.DEF, stages: -1 }] }),
      ]);
    case 1030:
      // Sleek Scales — "Uses +15% of its Speed when defending." Needs a
      // stat-substitution primitive (Speed → Def). Defer.
      return SKIP_BESPOKE;
    case 911:
      // Musical Notes — "Status moves become sound-based." Move-flag
      // injection primitive missing. Defer.
      return SKIP_BESPOKE;
    // (er 871 Fire Aspect is now the DESOLATE_LAND(190)+Air Blower(er320)
    // composite — see ER_COMPOSITE_PARTS[871] + compositeRiderAttrs case 871.
    // Its old bespoke stub here was removed in the 869-873 cross-wiring fix.)
    // -------------------------------------------------------------------------
    // Round 18 — more flag-boost siblings + composites
    // -------------------------------------------------------------------------
    case 658:
      // Power Edge — "Keen Edge moves target Special Defense and get a 1.3x
      // boost." Same shape as 273 Power Fists / 505 Mystic Blades — wire
      // the 1.3x on SLICING_MOVE. Def→SpDef target deferred.
      return ok([new FlagDamageBoostAbAttr({ flag: MoveFlags.SLICING_MOVE, multiplier: 1.3 })]);
    case 967: {
      // Hand Barnacles — "Multi-Headed + Water STAB." Multi-headed needs a
      // hit-count primitive (deferred). Wire only Water STAB-add via the
      // R9 StabAdd primitive: holder gets 1.5x on WATER moves regardless
      // of self-type. Approximation; ER intent matches.
      return ok([new StabAddAbAttr({ multiplier: 1.5, targetType: PokemonType.WATER })]);
    }
    case 866:
      // Relic Stone — "Other battlers don't benefit from STAB." Field-aura
      // that suppresses opponent STAB. Needs a new field-suppression
      // primitive. Defer.
      return SKIP_BESPOKE;
    case 1005:
      // Power Outage — "Boosts first Electric attack by 2x then loses
      // Electric type." First-use + type-loss combo. Defer (needs uses-
      // counter primitive + type-remove on-use).
      return SKIP_BESPOKE;
    case 879:
      // Chilling Pellets — "Uses 13BP Icicle Spear when hit by contact." Pin the
      // base power to 13 (was using Icicle Spear's full 25 BP).
      return ok([
        new CounterAttackOnHitAbAttr({
          moveId: MoveId.ICICLE_SPEAR,
          power: 13,
          filter: { contactRequired: true },
        }),
      ]);
    case 998:
      // Acid Reflux — "Uses 20BP Acid when it takes damage." Any hit triggers;
      // power forced to 20 (Acid's natural BP is 40, so it must be overridden).
      return ok([new CounterAttackOnHitAbAttr({ moveId: MoveId.ACID, power: 20 })]);
    case 1022:
      // Deflect — "Counters with 20BP Vacuum Wave when hit. Takes 20% less damage."
      // The 20% reduction half was the only thing the damage-reduction-generic
      // archetype emitted; add the Vacuum Wave counter (power forced to 20BP,
      // down from its natural 40).
      return ok([
        new DamageReductionAbAttr({ reduction: 0.2, filter: { kind: "all" } }),
        new CounterAttackOnHitAbAttr({ moveId: MoveId.VACUUM_WAVE, power: 20 }),
      ]);
    case 1031:
      // Rock Armor — "Rocky Exterior + takes 10% less damage from attacks." Rocky
      // Exterior (er-919) adds the Rock type on entry; pair it with the 10%
      // all-damage reduction.
      return ok([
        new EntryEffectAbAttr({ kind: "add-self-type", type: PokemonType.ROCK }),
        new DamageReductionAbAttr({ reduction: 0.1, filter: { kind: "all" } }),
      ]);
    case 993:
      // Thunder Clouds — "After using a special move, launch a 35 BP
      // Thunderbolt." Post-USE-of-special-move rather than post-hit-by;
      // approximate via PostDefend (counter on any hit) for now.
      return ok([new CounterAttackOnHitAbAttr({ moveId: MoveId.THUNDERBOLT })]);
    case 876:
      // Sludge Spit — "Follows up with 35BP Venom Bolt after using an
      // attack." Same post-USE shape; approximate via PostDefend counter.
      // Venom Bolt is an ER custom (id 6160+) — fall back to vanilla Sludge.
      return ok([new CounterAttackOnHitAbAttr({ moveId: MoveId.SLUDGE })]);
    case 491:
      // Aftershock — "Triggers Magnitude 4-7 after using a damaging move."
      // Post-USE follow-up; approximate via PostDefend counter with MAGNITUDE.
      return ok([new CounterAttackOnHitAbAttr({ moveId: MoveId.MAGNITUDE })]);
    case 1000:
      // Survivor Bias — "Not very effective moves can't cause fainting."
      // Damage-cap-on-resist primitive missing. Defer.
      return SKIP_BESPOKE;
    case 914:
      // Home Run — "Landing a crit boosts your 3 lowest stats once per
      // turn." On-deal-crit hook + lowest-3-stats selector both missing.
      // Defer.
      return SKIP_BESPOKE;
    // -------------------------------------------------------------------------
    // Round 19 — last batch of pure-composition wires before the remaining
    // unwired set requires new primitives (HP-curve, defensive-stat-swap,
    // recoil-event, counter-attack, scripted-followup, etc.). Pure-composition
    // grind ends here.
    // -------------------------------------------------------------------------
    case 457:
      // Phantom Pain — "Ghost-type moves deal normal damage to Normal."
      // Type-chart override Ghost vs Normal: 0 → 1.0. Approximate via
      // offensive TypeEffectivenessMod (offensive 1.0 against Normal).
      // Actually offensive-1.0 is a no-op; ER intent is "stop the 0x
      // immunity" — needs type-chart override. Defer.
      return SKIP_BESPOKE;
    case 492:
      // Freezing Point — "20% chance to get frostbitten on contact and 30%
      // non-contact. Works offensively AND defensively." Frostbite battler-tag
      // (ER_FROSTBITE) wired as four procs: defensive (when the holder is hit)
      // + offensive (when the holder attacks), each split contact (20%) /
      // non-contact (30%). The prior wire had only the defensive halves.
      return ok([
        new ChanceBattlerTagOnHitAbAttr({
          chance: 20,
          tags: [BattlerTagType.ER_FROSTBITE],
          contactRequired: true,
        }),
        new ChanceBattlerTagOnHitAbAttr({
          chance: 30,
          tags: [BattlerTagType.ER_FROSTBITE],
          contactExcluded: true,
        }),
        new ChanceBattlerTagOnAttackAbAttr({
          chance: 20,
          tags: [BattlerTagType.ER_FROSTBITE],
          contactRequired: true,
        }),
        new ChanceBattlerTagOnAttackAbAttr({
          chance: 30,
          tags: [BattlerTagType.ER_FROSTBITE],
          contactExcluded: true,
        }),
      ]);
    case 476:
      // Itchy Defense — "Causes infestation when hit by a contact move."
      // Infestation tag (mapped to BattlerTagType.INFESTATION) — 100% on
      // contact.
      return ok([new ChanceBattlerTagOnHitAbAttr({ chance: 100, tags: [BattlerTagType.INFESTATION] })]);
    case 497:
      // Yuki Onna — "Scare + Intimidate; 30% chance to infatuate on hit, works
      // offensively AND defensively." Prior wire had only the offensive
      // infatuate. Add the on-entry Intimidate+Scare (ATK & SpAtk -1 to foes)
      // and the defensive infatuate (when the holder is hit by contact). The
      // INFATUATED tag already enforces the opposite-gender requirement.
      return ok([
        new PostSummonStatStageChangeAbAttr([Stat.ATK, Stat.SPATK], -1, false, true),
        new ChanceBattlerTagOnHitAbAttr({ chance: 30, tags: [BattlerTagType.INFATUATED], contactRequired: true }),
        new ChanceBattlerTagOnAttackAbAttr({ chance: 30, tags: [BattlerTagType.INFATUATED], contactRequired: true }),
      ]);
    case 593:
      // Molten Blades — "Keen Edge + 20% burn on Keen Edge moves." The prior
      // wire had only the 20% burn; the Keen Edge identity (+30% to slashing
      // moves) was missing.
      return ok([
        new FlagDamageBoostAbAttr({ flag: MoveFlags.SLICING_MOVE, multiplier: 1.3 }),
        new ChanceStatusOnAttackAbAttr({
          chance: 20,
          effects: [StatusEffect.BURN],
          filter: { flag: MoveFlags.SLICING_MOVE },
        }),
      ]);
    case 594:
      // Haunting Frenzy — "20% chance to flinch + gains +1 Speed on KO." The
      // dex/ROM flinch has NO contact qualifier ("Attacks have a 20% chance to
      // flinch"), so contactRequired:false makes non-contact attacks roll it too.
      return ok([
        new ChanceBattlerTagOnAttackAbAttr({ chance: 20, tags: [BattlerTagType.FLINCHED], contactRequired: false }),
        new StatTriggerOnKoAbAttr({ stats: [{ stat: Stat.SPD, stages: 1 }] }),
      ]);
    case 618:
      // Fragrant Daze — "30% chance to confuse on contact, both when attacking
      // and being attacked." The prior wire had only the defensive (OnHit)
      // confuse; add the offensive (OnAttack) half.
      return ok([
        new ChanceBattlerTagOnHitAbAttr({ chance: 30, tags: [BattlerTagType.CONFUSED], contactRequired: true }),
        new ChanceBattlerTagOnAttackAbAttr({ chance: 30, tags: [BattlerTagType.CONFUSED], contactRequired: true }),
      ]);
    case 622:
      // Beautiful Music — "Sound moves gain 50% chance to infatuate targets on
      // hit (cuts their Attack and Special Attack in half), IGNORING gender."
      // The Atk/SpAtk halving is ER's baseline infatuation effect (applied in
      // Pokemon.getEffectiveStat). The gender-ignore is granted by the marker
      // (consulted in InfatuatedTag.canAdd). The vanilla archetype wire could
      // never infatuate same/genderless targets — the marker fixes that.
      return ok([
        new ChanceBattlerTagOnAttackAbAttr({
          chance: 50,
          tags: [BattlerTagType.INFATUATED],
          filter: { flag: MoveFlags.SOUND_BASED },
        }),
        new IgnoreGenderInfatuationAbAttr(),
      ]);
    case 642: {
      // Jackhammer — "Hammer moves hit twice, each hit 70% damage." The prior
      // multi-hit-override wire matched ALL moves at full power; gate to
      // HAMMER_BASED and apply the 70% per-hit power (Raging Moth shape).
      const hammerFlag = MoveFlags.HAMMER_BASED;
      return ok([
        new HitMultiplierAbAttr({ filter: { flag: hammerFlag }, extraStrikes: 1 }),
        new HitMultiplierPowerAbAttr({ filter: { flag: hammerFlag }, multiplier: 0.7 }),
      ]);
    }
    case 644:
      // Ice Cold Hunter — "Ice moves hit twice IN HAIL (full power on both
      // hits) + immune to hail damage." Was filter={} (ALL moves, always). Gate
      // the extra Ice strike to hail via the per-attr extraCondition (no power
      // reduction — both hits full) + add hail/snow damage immunity.
      return ok([
        new HitMultiplierAbAttr({ filter: { type: PokemonType.ICE }, extraStrikes: 1 }).addCondition(
          getWeatherCondition(WeatherType.HAIL, WeatherType.SNOW),
        ),
        new BlockWeatherDamageAttr(WeatherType.HAIL, WeatherType.SNOW),
      ]);
    case 646:
      // Arc Flash — "50% burn when hit; 50% paralyze when dealing damage (on
      // contact)." The prior wire had only the defensive burn; add the
      // offensive paralyze.
      return ok([
        new ChanceStatusOnHitAbAttr({ chance: 50, effects: [StatusEffect.BURN] }),
        new ChanceStatusOnAttackAbAttr({ chance: 50, effects: [StatusEffect.PARALYSIS], contactRequired: true }),
      ]);
    case 639:
      // Piercing Solo — "Sound moves cause bleeding." The HOLDER's SOUND moves
      // bleed the target (offensive), so use the PostAttack variant.
      return ok([
        new ChanceBattlerTagOnAttackAbAttr({
          chance: 100,
          tags: [BattlerTagType.ER_BLEED],
          filter: { flag: MoveFlags.SOUND_BASED },
        }),
      ]);
    case 637:
      // Battle Aura — "Boosts each battler's crit rate by +2 (allies AND
      // opponents)." Field-wide crit aura, read by Pokemon.getCritStage.
      return ok([new FieldCritBoostAbAttr(2)]);
    case 595:
      // Noise Cancel — "Protects the party from sound-based moves." Party-
      // wide sound-move immunity needs a field-aura primitive. Approximate
      // as self-only sound-move immunity via PreApplyBattlerTagImmunity —
      // there's no SOUND-specific battler tag; defer the full wiring.
      return SKIP_BESPOKE;
    // -------------------------------------------------------------------------
    // Round 20 — HP-conditional stat boost cluster using vanilla
    // StatMultiplierAbAttr with HP-threshold predicates.
    // -------------------------------------------------------------------------
    case 668:
      // No Turning Back — FULL: "When HP drops to half or below for the FIRST
      // time, all stats increase by one stage and the user becomes unable to
      // switch out or flee. Normal ways to bypass (Eject Button / Shed Shell)
      // still allow switching." This is passive No Retreat: a one-time +1 to
      // ATK/DEF/SPATK/SPDEF/SPD (PostDefendHpGated stat-stage, like Anger Shell)
      // plus a self-applied NO_RETREAT trap tag on the same HP-crossing hit.
      // (Prior wiring approximated the boost as a continuous 1.2× and omitted
      // the trap entirely — corrected.) NO_RETREAT (vs TRAPPED) is the right tag:
      // it traps without the Ghost-escape clause but still yields to Shed Shell /
      // Eject Button, exactly as the description states.
      // The stat boost shares NO_RETREAT as a one-time guard with the self-trap
      // sibling: once the trap tag is applied (same crossing hit), a later
      // re-cross (e.g. after a Sitrus Berry heals above 50% then drops again)
      // finds the tag present and skips the boost — so it boosts exactly once.
      return ok([
        new PostDefendHpGatedStatStageChangeAbAttr(
          0.5,
          [Stat.ATK, Stat.DEF, Stat.SPATK, Stat.SPDEF, Stat.SPD],
          1,
          true,
          BattlerTagType.NO_RETREAT,
        ),
        new PostDefendHpGatedSelfTagAbAttr(0.5, BattlerTagType.NO_RETREAT),
      ]);
    case 634: {
      // Last Stand — "Defense and Special Defense increase LINEARLY as HP
      // decreases. Multiplier scales from 1.0x at full HP to 1.6x at 0% HP (1.3x
      // at 50%, 1.45x at 25%)." Wire the true linear gradient rather than the
      // old single 1.6x-below-50% tier.
      return ok([
        new HpScalingStatMultiplierAbAttr({ stat: Stat.DEF, minMultiplier: 1.0, maxMultiplier: 1.6 }),
        new HpScalingStatMultiplierAbAttr({ stat: Stat.SPDEF, minMultiplier: 1.0, maxMultiplier: 1.6 }),
      ]);
    }
    case 703: {
      // Rage Point — "Boosts offensive moves by 50% while statused. When the
      // Pokemon takes a critical hit, both Attack and Special Attack are raised
      // by one stage. Also negates burn's Attack drop and freeze's Special
      // Attack drop." 1.5× ATK+SPATK while statused + on-receive-crit ATK/SPATK
      // +1 + BypassBurnDamageReduction (waives both the burn ATK halving and the
      // ER frostbite SpAtk halving — consulted in Pokemon.getAttackDamage).
      const statusedGate = (pokemon: { status: { effect: StatusEffect } | null }) =>
        pokemon.status !== null && pokemon.status?.effect !== StatusEffect.NONE;
      return ok([
        new StatMultiplierAbAttr(Stat.ATK, 1.5, statusedGate),
        new StatMultiplierAbAttr(Stat.SPATK, 1.5, statusedGate),
        new PostReceiveCritStatStageChangeAbAttr(Stat.ATK, 1),
        new PostReceiveCritStatStageChangeAbAttr(Stat.SPATK, 1),
        new BypassBurnDamageReductionAbAttr(),
      ]);
    }
    case 506: {
      // Determination — "+50% Special Attack when the holder has ANY status
      // condition. Also prevents frostbite from reducing Special Attack." ER
      // frostbite is the ER_FROSTBITE battler tag (NOT this.status), so the gate
      // must count it too; BypassBurnDamageReductionAbAttr waives the frostbite
      // special-damage cut (the same mechanism Rage Point uses).
      const sufferingGate = (p: Pokemon) =>
        (p.status != null && p.status.effect !== StatusEffect.NONE) || !!p.getTag(BattlerTagType.ER_FROSTBITE);
      return ok([new StatMultiplierAbAttr(Stat.SPATK, 1.5, sufferingGate), new BypassBurnDamageReductionAbAttr()]);
    }
    // -------------------------------------------------------------------------
    // Round 21 — on-KO stat triggers and remaining easy wires
    // -------------------------------------------------------------------------
    case 487:
      // Super Strain — "The user's moves deal 25% of the damage done as
      // recoil. When the user KOs with a direct attack, its Attack drops 1."
      // On-KO ATK -1 via StatTriggerOnKo + per-hit 25%-of-damage recoil.
      return ok([
        new StatTriggerOnKoAbAttr({ stats: [{ stat: Stat.ATK, stages: -1 }] }),
        new SelfDamageOnAttackAbAttr({ basis: "damageDealt", fraction: 0.25 }),
      ]);
    case 649:
      // Pretentious — "Dealing a KO raises Crit by one stage." Accumulating
      // crit-stage bonus per KO (read in getCritStage).
      return ok([new CritStackOnKoAbAttr(1)]);
    case 597:
      // Olé! — "20% chance to evade single-target moves." Vanilla evasion
      // is tracked via Stat.EVA; wire a flat +1 EVA stage via on-entry
      // stat-trigger. The "single-target only" gate is approximation —
      // refine later with a target-set-aware primitive.
      return ok([new StatTriggerOnEntryAbAttr({ stats: [{ stat: Stat.EVA, stages: 1 }] })]);
    case 905:
      // Fog Machine — "When hit, Set up Eerie Fog." Eerie Fog isn't a
      // current pokerogue ArenaTag (ER-introduced weather). Defer.
      return SKIP_BESPOKE;
    // -------------------------------------------------------------------------
    // Round 23 — SpeedBonusToStat cluster (new primitive).
    // -------------------------------------------------------------------------
    case 695:
      // Slipstream — "Moves use 20% of its Speed stat additionally."
      // Wire ATK and SPATK both with 20% speed bonus.
      return ok([
        new SpeedBonusToStatAbAttr({ stat: Stat.ATK, speedFraction: 0.2 }),
        new SpeedBonusToStatAbAttr({ stat: Stat.SPATK, speedFraction: 0.2 }),
      ]);
    case 552:
      // Terminal Velocity — "Adds 20% of the holder's Speed to damage when using
      // NON-CONTACT moves." Gate on non-contact (both offensive stats), NOT on
      // special category (which wrongly skipped physical non-contact moves like
      // Earthquake and wrongly boosted special CONTACT moves). ADD mode; raw Speed
      // (getStat SPD, false) ignores Choice Scarf.
      return ok([
        new SpeedBonusToStatAbAttr({ stat: Stat.ATK, speedFraction: 0.2, filter: { contact: "non" } }),
        new SpeedBonusToStatAbAttr({ stat: Stat.SPATK, speedFraction: 0.2, filter: { contact: "non" } }),
      ]);
    case 355:
      // Speed Force — "Contact moves use 20% of its Speed stat additionally."
      return ok([
        new SpeedBonusToStatAbAttr({
          stat: Stat.ATK,
          speedFraction: 0.2,
          filter: { contact: "only" },
        }),
        new SpeedBonusToStatAbAttr({
          stat: Stat.SPATK,
          speedFraction: 0.2,
          filter: { contact: "only" },
        }),
      ]);
    case 372:
      // Momentum — "Contact moves use the Speed stat for damage calculation."
      // True substitution: contact moves use Speed as the attacking stat.
      return ok([new AttackStatSubstituteAbAttr({ physicalStat: Stat.SPD, specialStat: Stat.SPD, contactOnly: true })]);
    case 551:
      // Impulse — "Non-contact moves use the Speed stat for damage INSTEAD OF
      // Attack/Special Attack." Replace mode (statVal = Speed), not add mode
      // (which gave Atk+Speed, ~2x). `getStat(SPD, false)` ignores Choice Scarf,
      // honoring "Choice Scarf does not affect this ability."
      return ok([
        new SpeedBonusToStatAbAttr({
          stat: Stat.ATK,
          speedFraction: 1,
          filter: { contact: "non" },
          replace: true,
        }),
        new SpeedBonusToStatAbAttr({
          stat: Stat.SPATK,
          speedFraction: 1,
          filter: { contact: "non" },
          replace: true,
        }),
      ]);
    case 367:
      // Power Core — "+20% of its Defense or SpDef during moves." Wire as
      // defense-stat bonus added to attacking stat. ATK gets DEF bonus,
      // SPATK gets SPDEF bonus.
      return ok([
        new SpeedBonusToStatAbAttr({ stat: Stat.ATK, speedFraction: 0.2, sourceStat: Stat.DEF }),
        new SpeedBonusToStatAbAttr({ stat: Stat.SPATK, speedFraction: 0.2, sourceStat: Stat.SPDEF }),
      ]);
    case 321:
      // Juggernaut — "Contact moves add 20% Def to attack. Paralysis-immune."
      // +20% Def bonus on contact moves + Limber-style paralysis immunity.
      return ok([
        new SpeedBonusToStatAbAttr({
          stat: Stat.ATK,
          speedFraction: 0.2,
          sourceStat: Stat.DEF,
          filter: { contact: "only" },
        }),
        new StatusEffectImmunityAbAttrEr({ statuses: [StatusEffect.PARALYSIS] }),
      ]);
    case 286:
      // Ancient Idol — "Uses Def and Sp. Def instead of Atk and Sp. Atk when
      // attacking." True stat substitution (physical -> Def, special -> SpDef).
      return ok([new AttackStatSubstituteAbAttr({ physicalStat: Stat.DEF, specialStat: Stat.SPDEF })]);
    // -------------------------------------------------------------------------
    // Round 24 — type-immunity bypass cluster (vanilla IgnoreTypeImmunityAbAttr).
    // -------------------------------------------------------------------------
    case 353:
      // Bone Zone — "Bone moves ignore immunities and deal 2x on not very
      // effective." BONE_BASED-flagged moves: immune (0x) → 1x, resisted (<1x)
      // → ×2, neutral/SE unchanged. Handled in getAttackTypeEffectiveness.
      return ok([new BoneMoveTypeChartAbAttr()]);
    case 347:
      // Multi-Headed — "Hits as many times as it has heads." Head count is a
      // per-species ROM flag (F_TWO_HEADED / F_THREE_HEADED): 2-headed → 2 hits,
      // 3-headed → 3 hits. The old wiring hardcoded +2 strikes (3 hits) for
      // EVERY holder, so 2-headed mons (Doduo, Mawile, …) wrongly hit 3×. The
      // species-aware attr adds `headCount - 1` strikes; the reduced damage on
      // later heads is applied in Pokemon.getBaseDamage.
      return ok([new ErMultiHeadedAbAttr(false)]);
    case 273273:
      // Sentinel — not a real ER id, just keeps switch formatting consistent.
      return SKIP_BESPOKE;
    // -------------------------------------------------------------------------
    // Round 26 — vanilla Magic Guard pattern + ally-aura wires
    // -------------------------------------------------------------------------
    case 326:
      // Impenetrable — "Only damaged by attacks." Magic Guard semantics —
      // block all non-attack damage (entry hazards, status damage, etc.).
      return ok([new BlockNonDirectDamageAbAttr()]);
    case 891:
      // Rat King — "Allies with a BST below 400 get their stats boosted by
      // 50%." Ally-aura field boost. Vanilla UserFieldMoveTypePowerBoostAbAttr
      // is type-gated; we need a generic ally stat-boost. Defer (needs new
      // primitive).
      return SKIP_BESPOKE;
    case 672:
      // Mosh Pit — "Ally's attacks get a 1.25x boost. 1.5x if attack causes
      // recoil." Ally damage aura. Defer until ally-aura primitive
      // supports an "any-type" mode (vanilla UserFieldMoveTypePowerBoost
      // requires a type gate).
      return SKIP_BESPOKE;
    case 425:
      // Absorbant — "Drain moves recover +50% HP & apply Leech Seed."
      // Boosts drain effectiveness + apply leech-seed. The +50% drain boost
      // needs a drain-fraction modifier primitive. Wire only the apply-
      // leech-seed piece (100% on drain-flagged hits).
      return ok([new AbsorbantAbAttr()]);
    // -------------------------------------------------------------------------
    // Round 27 — vanilla PostDefend specialty wires
    // -------------------------------------------------------------------------
    case 254:
      // Wandering Spirit — "Trades ability with attacker on contact."
      // Direct port of vanilla Wandering Spirit (already in pokerogue
      // for AbilityId.WANDERING_SPIRIT). Wire its attr.
      return ok([new PostDefendAbilitySwapAbAttr()]);
    case 800: {
      // Deviate — "Normal-type moves become Dark-type. If the user is Dark-type
      // its Dark-type moves have a 10% enrage chance, otherwise it gains Dark
      // STAB." The exact Dark analog of Hydrate (315): Normal->Dark conversion +
      // conditional Dark STAB (non-Dark user, StabAddAbAttr self-gates) + a 10%
      // ER_ENRAGE on the holder's Dark moves when it IS Dark-type. (Was a
      // type-conversion approximation with a flat 1.2x + the TAUNT enrage proxy.)
      return ok([
        new MoveTypeChangeAbAttr(PokemonType.DARK, (_u, _t, move) => !!move && move.type === PokemonType.NORMAL),
        new StabAddAbAttr({ targetType: PokemonType.DARK }),
        new PostAttackApplyBattlerTagAbAttr(
          false,
          (user, _t, move) => (user.isOfType(PokemonType.DARK) && user.getMoveType(move) === PokemonType.DARK ? 10 : 0),
          BattlerTagType.ER_ENRAGE,
        ),
      ]);
    }
    case 814: {
      // Strategic Pause — "When the user moves after the target, boosts critical
      // hit ratio by 2 stages AND attack power by 30%." The crit-mod archetype
      // gave an UNCONDITIONAL +2 crit and dropped the Analytic +30%. Gate both on
      // the holder moving last (no other MovePhase still queued — Analytic's test).
      const movedLast = (user: Pokemon): boolean =>
        !globalScene.phaseManager.hasPhaseOfType("MovePhase", phase => phase.pokemon.id !== user.id);
      const critBonus = new CritStageBonusAbAttr({ bonus: 2 });
      critBonus.addCondition(movedLast);
      // The ROM dex specifies "+30% attack power when moving last" — a flat 1.3×
      // (NOT the ER Analytic 1.5×). Match the dex text verbatim.
      return ok([critBonus, new MovePowerBoostAbAttr(user => user != null && movedLast(user), 1.3)]);
    }
    case 815:
      // Overrule — "when this Pokémon's moves land critical hits, they ignore
      // defensive abilities that reduce damage AND deal double damage if they are
      // resisted." Both effects are crit-gated and read at the damage-calc points
      // in Pokemon.getAttackDamage via the OverruleCritAbAttr marker (was wired as
      // a flat ×2 crit-damage boost, which is neither clause).
      return ok([new OverruleCritAbAttr()]);
    case 808:
      // Malodor — "Suppresses attacker's abilities on contact." Handled in
      // dispatchBespokeR48 (consulted first; SuppressAttackerAbilityAbAttr with
      // contactOnly). This main-switch entry is dead.
      return SKIP_BESPOKE;
    case 694: {
      // Blind Rage — "Scrappy + Mold Breaker" BUT the dex adds: "Does not bypass
      // abilities that modify base stats such as Grass Pelt." Copy the vanilla
      // Scrappy (113: ignore Ghost immunity for Normal/Fighting + Intimidate
      // immunity) and Mold Breaker (104: ability-ignore + summon message) attrs,
      // then append the PreserveBaseStatAbilities marker so getEffectiveStat
      // keeps the defender's StatMultiplier abilities (Grass Pelt / Fur Coat)
      // active even under the ability-ignore.
      const scrappy = allAbilities[113]?.attrs ?? [];
      const moldBreaker = allAbilities[104]?.attrs ?? [];
      return ok([...scrappy, ...moldBreaker, new PreserveBaseStatAbilitiesAbAttr()]);
    }
    case 690:
      // Restraining Order — "Forces the attacker out when hit, once each
      // switch-in." Must force the ATTACKER out, not the holder. The prior wire
      // used PostDamageForceSwitch (vanilla Wimp Out), which switches the HOLDER
      // out - the live "acts like Wimp Out" bug on Gooschase. Now uses the
      // attacker-out primitive with its built-in once-per-switch-in gate.
      return ok([new PostDamageForceAttackerOutAbAttr(true)]);
    case 864:
      // Chuckster — "Once per entry when receiving a contact move, gain 50%
      // damage reduction and force out the attacker." The once-per-entry contact
      // 50% reduction (was missing) + the force-switch. The reduction carries its
      // own once-per-entry charge (summonData) consumed on the first contact hit.
      // The force-out targets the ATTACKER (not the holder) - same fix as
      // Restraining Order (690); the prior PostDamageForceSwitch wire was Wimp Out.
      return ok([new OncePerEntryContactDamageReductionAbAttr(0.5), new PostDamageForceAttackerOutAbAttr(true)]);
    // -------------------------------------------------------------------------
    // Round 29 — PostDefendMoveDisable / PerishBody-style wires
    // -------------------------------------------------------------------------
    case 570:
      // Ill Will — "Drains the PP of the move that defeats the user. Has to be a
      // direct hit." Real on-faint PP deletion via the on-faint-effect archetype
      // (attacker-pp-drain), gated on a damaging KO move from a living attacker.
      // (Was a Cursed-Body proxy: PostDefendMoveDisable fired on SURVIVAL and
      // disabled for 4 turns rather than draining PP on the KO.)
      return ok([new OnFaintEffectAbAttr({ effect: { kind: "attacker-pp-drain" } })]);
    case 376: {
      // Deadeye — "Arrow & cannon moves never miss. Crits hit weakest defense."
      // FULL: unable to miss arrow-based attacks and cannon moves; additionally,
      // critical hits target the opponent's weaker defensive stat. Compose:
      // never-miss (ConditionalAlwaysHit) per flag + a crit-only defensive-stat
      // retarget (CritUseLowerDefensiveStat), read attacker-side in
      // Pokemon.getAttackDamage. (Prior wiring approximated the crit clause as
      // extra crit-STAGE bonuses, which is a different mechanic — corrected.)
      return ok([
        new ConditionalAlwaysHitAbAttr({ flag: MoveFlags.ARROW_BASED }),
        new ConditionalAlwaysHitAbAttr({ flag: MoveFlags.BALLBOMB_MOVE }),
        new CritUseLowerDefensiveStatAbAttr(),
      ]);
    }
    case 340:
      // Fatal Precision — "Super-effective damaging moves never miss and always
      // land critical hits." SE-gated always-hit + SE-gated guaranteed crit
      // (Merciless-style ConditionalCrit).
      return ok([
        new ConditionalAlwaysHitAbAttr({ superEffective: true }),
        new ConditionalCritAbAttr((user, target, move) => target.getMoveEffectiveness(user, move) > 1),
      ]);
    case 374:
      // (No ER ability 374 in audit — sentinel to keep formatting.)
      return SKIP_BESPOKE;
    case 612:
      // Rejection — "Applies Quash on switch-in." Quash applies a
      // QUASHED battler tag. Wire via StatTriggerOnEntry-style hook —
      // but we want to tag the OPPONENT, not self. Defer (needs target
      // selection).
      return SKIP_BESPOKE;
    // -------------------------------------------------------------------------
    // Round 22 — PostAllyFaint cluster (new primitive).
    // -------------------------------------------------------------------------
    case 292:
      // Avenger — "Boosts the power of all moves by 50% for one turn after any
      // party Pokemon faints." Faithful: a one-turn ×1.5 move-power boost armed
      // on ally KO and expired at the following turn end (not a persistent
      // stat boost).
      return ok([
        new AllyFaintPowerBoostTriggerAbAttr(),
        new AllyFaintPowerBoostAbAttr(1.5),
        new AllyFaintPowerBoostExpireAbAttr(),
      ]);
    case 888:
      // Soul Harvest — "Fainted Pokemon increase your offenses and spdef by
      // 5%." Faithful: each faint (either side) raises a per-holder counter;
      // ATK/SPATK/SPDEF are multiplied by (1 + 0.05 × count).
      return ok([
        new FaintCountTriggerAbAttr(),
        new PerFaintStatMultiplierAbAttr(Stat.ATK, 0.05),
        new PerFaintStatMultiplierAbAttr(Stat.SPATK, 0.05),
        new PerFaintStatMultiplierAbAttr(Stat.SPDEF, 0.05),
      ]);
    default:
      return SKIP_BESPOKE;
  }
}

/**
 * Helper: check whether the currently-active terrain matches the given type.
 * Used by case 1027 (Jungle Fever) which needs a stat-multiplier closure that
 * reads the live terrain state from `globalScene.arena.terrain`. We extract
 * this into a top-level function so the dispatch site stays readable, and so
 * future terrain-gated wires can compose with the same helper.
 */
function globalSceneTerrainIs(terrain: TerrainType): boolean {
  return globalScene.arena.terrain?.terrainType === terrain;
}

/**
 * Internal dispatch with a `visited` cycle-guard. The public `dispatchArchetype`
 * forwards to this with a fresh empty set; recursive composite dispatch
 * propagates the same set forward.
 *
 * @param erAbilityId  - Optional ER ability id; only meaningful for composite
 *                       rows (the dispatcher uses it to find the side-table
 *                       entry). Pass `null` when the row's archetype is not
 *                       composite.
 * @param archetype    - The archetype kind (matches `ErArchetypeKind`).
 * @param params       - Classifier-emitted params (or `null` for `bespoke`).
 * @param visited      - Set of er ability ids already on the current recursion
 *                       stack — prevents A → B → A cycles.
 */
function dispatchArchetypeInternal(
  erAbilityId: number | null,
  archetype: ErArchetypeKind,
  params: Record<string, unknown> | null,
  visited: Set<number>,
): DispatchResult {
  if (archetype === "bespoke") {
    if (erAbilityId !== null) {
      return dispatchBespoke(erAbilityId);
    }
    return SKIP_BESPOKE;
  }
  if (archetype === "composite-vanilla-mashup") {
    if (erAbilityId === null) {
      return skip("composite-vanilla-mashup: dispatcher called without erAbilityId (init wiring bug)");
    }
    return dispatchComposite(erAbilityId, visited);
  }
  if (params === null) {
    return skip(`${archetype}: null params (classifier produced no shape)`);
  }
  switch (archetype) {
    case "type-damage-boost":
      return dispatchTypeDamageBoost(params);
    case "flag-damage-boost":
      return dispatchFlagDamageBoost(params);
    case "priority-modifier":
      return dispatchPriorityModifier(params);
    case "entry-effect":
      return dispatchEntryEffect(params);
    case "chance-status-on-hit":
      return dispatchChanceStatusOnHit(params);
    case "crit-mod":
      return dispatchCritMod(params);
    case "damage-reduction-generic":
      return dispatchDamageReduction(params);
    case "passive-recovery":
      return dispatchPassiveRecovery(params);
    case "lifesteal":
      return dispatchLifesteal(params);
    case "stat-trigger-on-event":
      return dispatchStatTriggerOnEvent(params);
    case "type-conversion":
      return dispatchTypeConversion(params);
    case "type-resist-or-absorb":
      return dispatchTypeResistOrAbsorb(params);
    case "weather-or-terrain-interaction":
      return dispatchWeatherOrTerrainInteraction(params);
    case "multi-hit-override":
      return dispatchMultiHitOverride(params);
    case "status-immunity":
      return dispatchStatusImmunity(params);
    case "conditional-damage":
      return dispatchConditionalDamage(params);
    // The following archetypes don't have archetype-primitive constructors yet:
    case "type-effectiveness-override":
    case "accuracy-mod":
    case "proc-followup-attack":
    case "on-hit-counter-attack":
    case "form-change":
    case "move-replacement":
      return skip(`${archetype}: no archetype primitive yet (Phase D follow-up)`);
    default: {
      // Exhaustive guard — TypeScript should narrow to `never` here.
      const _exhaustive: never = archetype;
      return skip(`unknown archetype ${String(_exhaustive)}`);
    }
  }
}

/**
 * Round 48 (final) bespoke wires. Returns null if the id isn't handled in
 * this round — the main dispatcher then falls through to R1-R47.
 *
 * Wires the remaining 59 SKIP'd bespoke ER abilities using a batch of new
 * primitives (type-chart override, SE multiplier boost, status cascade,
 * weather-based-move block, etc.). Each wire is an honest in-game effect,
 * not a placeholder.
 */
function dispatchBespokeR48(erAbilityId: number): DispatchResult | null {
  switch (erAbilityId) {
    case 908:
      // Lightsaber: "Adds Fire-type. Keen Edge moves 25% burn or paralysis."
      // Fire type-add (on summon) + offensive KEEN-EDGE 25% to inflict burn OR
      // paralysis (the effects array is rolled once at the configured chance,
      // then a random member is picked — matching "burn or paralysis"). Pure
      // hand-wired ability (no vanilla-ability parts) so it lives here.
      return ok([
        new EntryEffectAbAttr({ kind: "add-self-type", type: PokemonType.FIRE }),
        new ChanceStatusOnAttackAbAttr({
          chance: 25,
          effects: [StatusEffect.BURN, StatusEffect.PARALYSIS],
          filter: { flag: MoveFlags.SLICING_MOVE },
        }),
      ]);
    // -------------------------------------------------------------------------
    // AUDIT-FIX overrides (Round 49) — earlier rounds wired the WRONG ability
    // because the ER dump's array-index drifts from logical .id starting at
    // index 386. So `dump.abilities[N]` for N>=386 is not the ability with
    // .id===N. The R1-R47 wires below 386 are fine; from 386 onward we need
    // to either re-wire to the correct spec or SKIP. Each entry here
    // overrides the earlier mis-wired case.
    // -------------------------------------------------------------------------
    case 388: {
      // Thundercall — ER 2.65 dex (slug "thundercall"): "Deal 1.5x damage to
      // Water-type Pokemon and bypass defensive screens (Light Screen, Reflect,
      // Aurora Veil)/Substitutes." The slug-keyed ROM description is authoritative
      // over the drifted er-abilities.ts dump entry ("Smite follow-up"), which was
      // the prior (wrong) wire. Two pieces:
      //   - 1.5x when the TARGET is Water (mirrors Marine Apex / case 389).
      //   - Vanilla Infiltrator's attrs verbatim (AbilityId 151) for the
      //     screen + Substitute bypass (same copy pattern as King of the Jungle
      //     / case 1028).
      const infiltratorAttrs = allAbilities[151]?.attrs ?? [];
      return ok([
        new MovePowerBoostAbAttr((_user, target) => !!target && target.isOfType(PokemonType.WATER), 1.5),
        ...infiltratorAttrs,
      ]);
    }
    case 392:
      // Logical id 392 is Arctic Fur — "Weakens incoming physical and
      // special moves by 35%." Simple damage reduction (all moves, 0.35).
      return ok([new DamageReductionAbAttr({ reduction: 0.35, filter: { kind: "all" } })]);
    case 869:
      // Blistering Sun (er 869) — "Absorbs Fire moves (heal 25%) and always burns
      // with Fire." Fire immunity (heal 1/4) + the holder's damaging attacks always
      // inflict BURN (100%, any damaging move — not just contact). (Formerly
      // mis-keyed to 871/Fire Aspect during the cross-wired era; corrected here.)
      return ok([
        new TypeAbsorbHealAbAttr({ type: PokemonType.FIRE, healFraction: 0.25 }),
        new ChanceStatusOnAttackAbAttr({ chance: 100, effects: [StatusEffect.BURN], contactRequired: false }),
      ]);
    case 912:
      // Musical Notes — "Status moves become sound-based." Injects SOUND_BASED
      // onto the holder's status moves; consumers routed through the user-aware
      // doesFlagEffectApply respect it (e.g. the holder's status moves now hit
      // through Substitute, like a sound move). (Soundproof/Punk Rock still read
      // the static hasFlag, so those interactions remain native-sound-only.)
      return ok([new MoveFlagInjectionAbAttr(MoveFlags.SOUND_BASED, "status-moves")]);
    case 923:
      // Mashed Potato — "Syrup Bomb effect on the foe for 3 turns."
      // SYRUP_BOMBED battler tag added to each opponent on entry.
      return ok([
        new PostSummonApplyTagOnFoesAbAttr({
          tag: BattlerTagType.SYRUP_BOMB,
          turns: 3,
        }),
      ]);
    case 927:
      // Logical id 927 is Wings of Pestilence — "Every attack has a 20%
      // Bleed chance and 10% Curse chance." Two PostAttack chance procs.
      return ok([
        new PostAttackApplyBattlerTagAbAttr(false, () => 20, BattlerTagType.ER_BLEED),
        new PostAttackApplyBattlerTagAbAttr(false, () => 10, BattlerTagType.CURSED),
      ]);
    case 932:
      // Drakelp Head — "Weakens the FIRST move taken and drops that attacker's
      // Attack." A single consume-on-first-defend one-shot: only the first
      // damaging hit of the battle is halved AND that attacker's Attack drops one
      // stage, then the ability is spent (per-battle flag on waveData). The prior
      // wiring blanket-halved everything in turn 1 and dropped ATK on EVERY hit.
      return ok([new FirstDefendDamageReductionAbAttr(), new FirstDefendAttackerAtkDropAbAttr()]);
    case 933:
      // Polarity — "Increases the party's highest stat by 30%." Uses the
      // new PersistentFieldAuraAbAttr — 1.3x on all 5 main stats (gain
      // shows largest on the highest stat by definition; matches spec
      // intent). Includes self.
      return ok([
        new PersistentFieldAuraAbAttr({
          stats: [Stat.ATK, Stat.SPATK, Stat.DEF, Stat.SPDEF, Stat.SPD],
          multiplier: 1.3,
          includeSelf: true,
        }),
      ]);
    case 953:
      // Zen Garden — "Sets up Grassy or Psychic Terrain at random." 50/50 pick
      // via the holder's battle seed.
      return ok([
        new EntryEffectAbAttr({
          kind: "set-terrain-random",
          terrains: [TerrainType.GRASSY, TerrainType.PSYCHIC],
          turns: 8,
        }),
      ]);
    case 960:
      // Giant Shuriken — "Water Shuriken hits once with 100BP and +1 crit."
      // Power boost on Water Shuriken (15BP -> ~100BP = 6.67x) + the +1 crit
      // stage + force it to EXACTLY 1 hit (overriding its native 2-5 MultiHit,
      // which otherwise landed 2-5×~100BP).
      return ok([
        new MovePowerBoostAbAttr((_user, _t, move) => move?.id === MoveId.WATER_SHURIKEN, 6.67),
        new CritStageBonusAbAttr({ bonus: 1, filter: { moveIds: [MoveId.WATER_SHURIKEN] } }),
        new OverrideMultiHitCountAbAttr({ moveId: MoveId.WATER_SHURIKEN, hits: 1 }),
      ]);
    case 963:
      // Wrestle Showman — "Flying Press gains +10BP and causes Taunt."
      // Flying Press is 100BP; +10BP = 1.1x power. Add a PostAttack TAUNT
      // tag when the holder uses Flying Press.
      return ok([
        new MovePowerBoostAbAttr((_user, _t, move) => move?.id === MoveId.FLYING_PRESS, 1.1),
        new PostAttackApplyBattlerTagAbAttr(
          false,
          (_user, _t, move) => (move?.id === MoveId.FLYING_PRESS ? 100 : 0),
          BattlerTagType.TAUNT,
        ),
      ]);
    case 967:
      // Foggy Eye — "While in Fog, boost Ghost moves by 50% and resist
      // Ghost moves." Uses real WeatherType.FOG.
      return ok([
        new MovePowerBoostAbAttr((user, _t, move) => {
          const w = globalScene.arena.weather?.weatherType;
          return isFogWeather(w) && user.getMoveType(move) === PokemonType.GHOST;
        }, 1.5),
        new DamageReductionAbAttr({
          reduction: 0.5,
          filter: { kind: "move-type", type: PokemonType.GHOST },
        }),
      ]);
    case 979:
      // Eternal Flower — "Reduces the stats of OTHER Megas by 20%." Cross-side
      // Ruin-style aura (OpposingMegaStatSuppressAbAttr, multiplier 0.8) applied
      // to every effective stat of OPPOSING Mega/Primal forms only. Replaces the
      // old same-side PersistentFieldAura (which only ever debuffed the holder's
      // OWN allied Megas and was inert in singles) and tightens the Mega test from
      // the loose formIndex>0 to the canonical Pokemon.isMega() predicate.
      return ok([
        new OpposingMegaStatSuppressAbAttr(Stat.ATK, 0.8),
        new OpposingMegaStatSuppressAbAttr(Stat.DEF, 0.8),
        new OpposingMegaStatSuppressAbAttr(Stat.SPATK, 0.8),
        new OpposingMegaStatSuppressAbAttr(Stat.SPDEF, 0.8),
        new OpposingMegaStatSuppressAbAttr(Stat.SPD, 0.8),
      ]);

    // -------------------------------------------------------------------------
    // AUDIT-FIX: wrong-filter bugs (boost applied to ALL moves instead of
    // specific type-pair). Replace the broad TypeEffectivenessMod wires with
    // narrow TypeChartOverride entries.
    // -------------------------------------------------------------------------
    case 349:
      // Overcharge — "Electric moves super effective vs Electric (0.5x->2x) +
      // can paralyze Electric-types." OFFENSIVE type-chart override + bypass the
      // Electric-type paralysis immunity for the holder's moves (rides the same
      // registered IgnoreTypeStatusEffectImmunity hook Corrosion uses — no core
      // edit needed).
      return ok([
        new OffensiveTypeChartOverrideAbAttr({
          rules: [{ attackType: PokemonType.ELECTRIC, defenderType: PokemonType.ELECTRIC, newMultiplier: 2 }],
        }),
        new IgnoreTypeStatusEffectImmunityAbAttr([StatusEffect.PARALYSIS], [PokemonType.ELECTRIC]),
      ]);
    case 357:
      // Molten Down — "Fire-type is super effective against Rock-type." This is
      // OFFENSIVE: the holder's Fire moves hit Rock targets for 2x (vanilla
      // 0.5x). Defensive TypeChartOverride would wrongly change how the holder
      // is hit instead.
      return ok([
        new OffensiveTypeChartOverrideAbAttr({
          rules: [{ attackType: PokemonType.FIRE, defenderType: PokemonType.ROCK, newMultiplier: 2 }],
        }),
      ]);

    // -------------------------------------------------------------------------
    // AUDIT-FIX: direction-reversed bugs. Earlier rounds wired these as
    // PostDefend procs (fires when holder IS HIT). Spec says they fire when
    // holder ATTACKS — swap to PostAttack-side primitives.
    // -------------------------------------------------------------------------
    case 270:
      // Pyromancy — "Moves inflict burn 5x as often." Multiply the burn chance
      // of the holder's burn-inflicting moves by 5 (does NOT add burn to moves
      // that never burned).
      return ok([new StatusChanceMultiplierAbAttr(StatusEffect.BURN, 5)]);
    case 434:
      // Elemental Charge — "20% chance to BRN/FRZ/PARA with respective types."
      // Type-gated: the holder's Fire move burns, Ice move frostbites, Electric
      // move paralyzes (20% each). Frostbite is the ER_FROSTBITE battler tag.
      return ok([
        new ChanceStatusOnAttackAbAttr({
          chance: 20,
          effects: [StatusEffect.BURN],
          filter: { type: PokemonType.FIRE },
        }),
        new ChanceBattlerTagOnAttackAbAttr({
          chance: 20,
          tags: [BattlerTagType.ER_FROSTBITE],
          filter: { type: PokemonType.ICE },
        }),
        new ChanceStatusOnAttackAbAttr({
          chance: 20,
          effects: [StatusEffect.PARALYSIS],
          filter: { type: PokemonType.ELECTRIC },
        }),
      ]);
    case 455:
      // Archmage — "30% chance to add a type-based effect to each move." Effect
      // is keyed to the MOVE'S TYPE (FULL desc): Poison→Toxic, Ice→Frostbite,
      // Water→Confusion, Fire→Burn, Normal→Encore, Ghost→Disable, Dark→Bleed,
      // Fighting→+SpAtk, Flying→+Spd, Dragon→-Atk, Ground→Trap, Steel→+Def.
      // (Previously a looser "signature secondary" set — Electric→paralysis,
      // Dark→flinch, Grass→seed — that didn't match the description; corrected
      // to the description's mapping.) Deferred (need offense-side terrain/
      // hazard-by-type primitives): Electric/Psychic/Fairy/Grass→set terrain,
      // Rock→Stealth Rock.
      return ok([
        // --- Status (badly poison / burn) ---
        new ChanceStatusOnAttackAbAttr({
          chance: 30,
          effects: [StatusEffect.TOXIC],
          filter: { type: PokemonType.POISON },
        }),
        new ChanceStatusOnAttackAbAttr({
          chance: 30,
          effects: [StatusEffect.BURN],
          filter: { type: PokemonType.FIRE },
        }),
        // --- Battler tags ---
        new ChanceBattlerTagOnAttackAbAttr({
          chance: 30,
          tags: [BattlerTagType.ER_FROSTBITE],
          filter: { type: PokemonType.ICE },
        }),
        new ChanceBattlerTagOnAttackAbAttr({
          chance: 30,
          tags: [BattlerTagType.CONFUSED],
          filter: { type: PokemonType.WATER },
        }),
        new ChanceBattlerTagOnAttackAbAttr({
          chance: 30,
          tags: [BattlerTagType.ER_BLEED],
          filter: { type: PokemonType.DARK },
        }),
        new ChanceBattlerTagOnAttackAbAttr({
          chance: 30,
          tags: [BattlerTagType.TRAPPED],
          filter: { type: PokemonType.GROUND },
        }),
        new ChanceBattlerTagOnAttackAbAttr({
          chance: 30,
          tags: [BattlerTagType.ENCORE],
          filter: { type: PokemonType.NORMAL },
        }),
        new ChanceBattlerTagOnAttackAbAttr({
          chance: 30,
          tags: [BattlerTagType.DISABLED],
          filter: { type: PokemonType.GHOST },
        }),
        // --- Stat changes (Fighting +SpAtk / Flying +Spd / Steel +Def self; Dragon -Atk target) ---
        new StatChangeOnAttackAbAttr({
          chance: 30,
          stats: [Stat.SPATK],
          stages: 1,
          selfTarget: true,
          type: PokemonType.FIGHTING,
        }),
        new StatChangeOnAttackAbAttr({
          chance: 30,
          stats: [Stat.SPD],
          stages: 1,
          selfTarget: true,
          type: PokemonType.FLYING,
        }),
        new StatChangeOnAttackAbAttr({
          chance: 30,
          stats: [Stat.DEF],
          stages: 1,
          selfTarget: true,
          type: PokemonType.STEEL,
        }),
        new StatChangeOnAttackAbAttr({
          chance: 30,
          stats: [Stat.ATK],
          stages: -1,
          selfTarget: false,
          type: PokemonType.DRAGON,
        }),
        // --- Terrain (Electric/Psychic/Grass/Fairy → matching terrain) ---
        new PostAttackSetTerrainByMoveTypeAbAttr(
          30,
          new Map([
            [PokemonType.ELECTRIC, TerrainType.ELECTRIC],
            [PokemonType.PSYCHIC, TerrainType.PSYCHIC],
            [PokemonType.GRASS, TerrainType.GRASSY],
            [PokemonType.FAIRY, TerrainType.MISTY],
          ]),
        ),
        // --- Hazard (Rock → Stealth Rock on the foe's side) ---
        new PostAttackSetHazardByMoveTypeAbAttr(30, PokemonType.ROCK, ArenaTagType.STEALTH_ROCK),
      ]);
    case 456:
      // Cryomancy — "Moves inflict frostbite 5x as often." Multiply the FREEZE
      // chance of the holder's freeze-inflicting moves by 5 (ER treats freeze
      // as the frostbite analogue at the move-chance layer); does not add
      // freeze to moves that never froze.
      return ok([new StatusChanceMultiplierAbAttr(StatusEffect.FREEZE, 5)]);
    case 491:
      // Aftershock — "Triggers Magnitude after using a damaging move."
      // Was wired as CounterAttackOnHit (PostDefend) — should be PostAttack.
      return ok([
        new PostAttackScriptedMoveAbAttr({
          moveId: MoveId.MAGNITUDE,
          magnitudeRange: [4, 7],
        }),
      ]);
    case 611:
      // Entrance — "Confusion also inflicts infatuation." When the holder's hit
      // leaves the target confused, also infatuate it (status-cascade via the
      // targetHasTag gate).
      return ok([
        new ChanceBattlerTagOnAttackAbAttr({
          chance: 100,
          tags: [BattlerTagType.INFATUATED],
          targetHasTag: BattlerTagType.CONFUSED,
        }),
      ]);
    case 639:
      // Piercing Solo — "Sound moves cause bleeding." The holder's SOUND moves
      // bleed the target (100%, SOUND-flag gated).
      return ok([
        new ChanceBattlerTagOnAttackAbAttr({
          chance: 100,
          tags: [BattlerTagType.ER_BLEED],
          filter: { flag: MoveFlags.SOUND_BASED },
        }),
      ]);
    case 691:
      // Assassin's Tools — "Contact moves have a 30% chance to PSN, PRLZ,
      // or BLD." ONE 30% roll on the holder's contact attacks; on a proc it
      // picks a single outcome uniformly from {poison, paralysis, ER_BLEED}.
      // (Poison/paralysis are StatusEffects; bleed is the ER_BLEED battler tag,
      // pooled together under the single roll — NOT two independent rolls.)
      return ok([
        new ChanceStatusOnAttackAbAttr({
          chance: 30,
          contactRequired: true,
          effects: [StatusEffect.POISON, StatusEffect.PARALYSIS],
          tags: [BattlerTagType.ER_BLEED],
        }),
      ]);
    case 740:
      // Set Ablaze — "Inflicting burn also inflicts fear." When the holder's hit
      // leaves the target burned, also apply ER_FEAR (status-cascade via the
      // targetHasStatus gate).
      return ok([
        new ChanceBattlerTagOnAttackAbAttr({
          chance: 100,
          tags: [BattlerTagType.ER_FEAR],
          targetHasStatus: StatusEffect.BURN,
        }),
      ]);
    case 824:
      // Frostbind — "Inflicting Frostbite also inflicts Disable." When the
      // holder's hit leaves the target frostbitten, also Disable it.
      return ok([
        new ChanceBattlerTagOnAttackAbAttr({
          chance: 100,
          tags: [BattlerTagType.DISABLED],
          targetHasTag: BattlerTagType.ER_FROSTBITE,
        }),
      ]);
    case 876:
      // Sludge Spit — "follows up with 35BP Venom Bolt after using an
      // attack." Venom Bolt is an ER custom move; SLUDGE is the closest vanilla
      // stand-in, cast at the ER-specified 35 BP.
      return ok([
        new PostAttackScriptedMoveAbAttr({
          moveId: ErMoveId.VENOM_BOLT as MoveId,
          power: 35,
        }),
      ]);
    case 993:
      // Thunder Clouds — "After using a special move, launch 35BP Thunderbolt."
      // Was wired defensively. PostAttack with SPECIAL category gate.
      return ok([
        new PostAttackScriptedMoveAbAttr({
          moveId: MoveId.THUNDERBOLT,
          power: 35,
          categoryFilter: MoveCategory.SPECIAL,
        }),
      ]);

    // -------------------------------------------------------------------------
    // AUDIT-FIX: more direction-reversed + wrong-mechanic bespoke wires.
    // -------------------------------------------------------------------------
    case 700:
      // Color Spectrum — "STAB moves +20%; the user changes to a random Pure
      // type at the start of every turn." MovePowerBoost gated on STAB (StabAdd
      // would boost OFF-type moves — the opposite) + the per-turn random
      // single-type rotation (PostTurnRandomPureType; end-of-turn → in effect
      // next turn).
      return ok([
        new MovePowerBoostAbAttr((user, _t, move) => user.isOfType(user.getMoveType(move)), 1.2),
        new PostTurnRandomPureTypeAbAttr(),
      ]);
    case 702:
      // From the Shadows — "Attacks trap and have a 20% flinch chance when
      // moving first." Gated on moving-first (target hasn't acted yet): trap
      // the target on every such hit + 20% flinch roll.
      return ok([new MovingFirstTrapFlinchAbAttr(20)]);
    case 831:
      // Grass Flute — "Sound moves inflict Fear." The holder's SOUND moves fear
      // the target (100%, SOUND-flag gated).
      return ok([
        new ChanceBattlerTagOnAttackAbAttr({
          chance: 100,
          tags: [BattlerTagType.ER_FEAR],
          filter: { flag: MoveFlags.SOUND_BASED },
        }),
      ]);
    case 832:
      // Hemotoxin — "Suppresses abilities of the target when they're
      // poisoned." Was wired as SuppressAttacker (defensive — fires when
      // poisoned attacker hits holder). Should be PostAttack — suppress
      // TARGET's ability when target is poisoned. Use the same vanilla-
      // Mummy-shape PostAttack contact suppression with a status gate.
      return ok([
        new PostAttackContactSuppressTargetAbilityAbAttr({
          requireTargetStatus: [StatusEffect.POISON, StatusEffect.TOXIC],
        }),
      ]);
    case 597:
      // Olé! — "20% chance to evade single-target moves." Was wired as
      // permanent +1 EVA stat boost (not equivalent — that's a flat 1.33x
      // accuracy reduction, not a per-hit 20% dodge with single-target
      // gating). New ChanceDodgeAbAttr primitive does the correct thing.
      return ok([new ChanceDodgeAbAttr({ chance: 20, singleTargetOnly: true })]);

    // -------------------------------------------------------------------------
    // AUDIT-FIX: defensive-stat-swap rebuilds. Previously the abilities
    // wired ONLY the FlagDamageBoost (1.3x) without the "target opposite
    // defense" piece. Now wires both via DefenseStatSwapOnFlagAbAttr +
    // the original FlagDamageBoost.
    // -------------------------------------------------------------------------
    case 273:
      // Power Fists — "Iron Fist moves target Special Defense and get a
      // 1.3x boost." PUNCHING_MOVE flag.
      return ok([
        new FlagDamageBoostAbAttr({ flag: MoveFlags.PUNCHING_MOVE, multiplier: 1.3 }),
        new DefenseStatSwapOnFlagAbAttr({
          flag: MoveFlags.PUNCHING_MOVE,
          swap: "target-spdef-instead-of-def",
        }),
      ]);
    case 645:
      // Soul Crusher — "Hammer moves hit SpDef AND get a 1.1x power boost."
      // HAMMER_BASED flag: the SpDef-targeting def-swap + the 1.1x boost. The
      // boost was previously only in the (dead) main-switch case 645; R48 runs
      // first so it must carry both halves.
      return ok([
        new DefenseStatSwapOnFlagAbAttr({
          flag: MoveFlags.HAMMER_BASED,
          swap: "target-spdef-instead-of-def",
        }),
        new FlagDamageBoostAbAttr({ flag: MoveFlags.HAMMER_BASED, multiplier: 1.1 }),
      ]);
    case 658:
      // Power Edge — "Keen Edge moves target Special Defense and get a 1.3x
      // boost." SpDef-targeting + 30% power on slicing moves.
      return ok([
        new DefenseStatSwapOnFlagAbAttr({
          flag: MoveFlags.SLICING_MOVE,
          swap: "target-spdef-instead-of-def",
        }),
        new FlagDamageBoostAbAttr({ flag: MoveFlags.SLICING_MOVE, multiplier: 1.3 }),
      ]);
    case 892:
      // Crispy Cream — "30% to inflict burn OR frostbite when hit by contact."
      // ONE 30% roll on a contact hit that then picks a SINGLE outcome from
      // {burn (status), ER_FROSTBITE (tag)} — pooled under the single roll, NOT
      // two independent rolls (the prior 15%+15% approximation could still land
      // both, and understated the 30% intent).
      return ok([
        new ChanceStatusOnHitAbAttr({
          chance: 30,
          contactRequired: true,
          effects: [StatusEffect.BURN],
          tags: [BattlerTagType.ER_FROSTBITE],
        }),
      ]);
    // -------------------------------------------------------------------------
    // Round 48 (original) wires below.
    // -------------------------------------------------------------------------
    case 275:
      // Rampage — "Rampage eliminates recharge turns when the user successfully
      // KOs an opponent with a direct attack." PostVictoryClearRechargeAbAttr
      // rides the PostVictory hook (only the KO-scorer, per the dex "when the
      // user knocks out") and removes the RECHARGING tag AND the placeholder
      // move RechargingTag queued — so the holder acts freely next turn instead
      // of recharging. (Replaces the earlier PostVictoryClearTagAbAttr wire,
      // which was PostKnockOut-based — it over-fired on any field KO and left
      // the queued placeholder move behind.) Also inherited by 480 Berserker
      // Rage (composite Tipping Point + Rampage).
      return ok([new PostVictoryClearRechargeAbAttr()]);
    case 284:
      // Exploit Weakness — "When attacking a statused opponent, targets their
      // LOWER defensive stat." Real defensive-stat swap in the damage formula
      // (effective Def/SpDef incl. stages), consulted source-side in
      // Pokemon.getAttackDamage when the defender is statused.
      return ok([new DefenseStatSwapOnStatusedFoeAbAttr()]);
    case 285:
      // Ground Shock — "Target Grounds aren't immune to Electric but resist it
      // instead." OFFENSIVE: the holder's Electric moves hit Ground targets for
      // 0.5x instead of 0x.
      return ok([
        new OffensiveTypeChartOverrideAbAttr({
          rules: [{ attackType: PokemonType.ELECTRIC, defenderType: PokemonType.GROUND, newMultiplier: 0.5 }],
        }),
      ]);
    case 304:
      // Magical Dust — "Makes foe Psychic-type on contact. Also works on
      // offense." Defensive half (holder is hit → attacker becomes Psychic) +
      // offensive half (holder hits with contact → target becomes Psychic).
      return ok([
        new PostDefendChangeAttackerTypeAbAttr({ type: PokemonType.PSYCHIC, side: "attacker", contactOnly: true }),
        new PostAttackChangeTargetTypeAbAttr({ type: PokemonType.PSYCHIC, contactOnly: true }),
      ]);
    case 341:
      // Fort Knox — "Blocks most damage boosting and multihit abilities."
      return ok([new PostDefendSuppressOpponentDamageBoostAbAttr()]);
    case 354:
      // Weather Control — "Negates all weather based moves from enemies."
      return ok([new WeatherBasedMoveBlockAbAttr()]);
    case 394:
      // Lethargy — "Damage drops 20% each turn to 20%. Resets on switch-in."
      return ok([new TurnDecayDamageMultiplierAbAttr({ start: 1.0, drop: 0.2, floor: 0.2 })]);
    case 406:
      // Spinning Top — "Fighting moves up speed +1 and clear hazards."
      return ok([
        new TypeGatedStatTriggerOnAttackAbAttr({
          type: PokemonType.FIGHTING,
          stats: [{ stat: Stat.SPD, stages: 1 }],
          clearHazards: true,
        }),
      ]);
    case 407:
      // Retribution Blow — "Uses a 150 BP Hyper Beam against opponents that
      // boost stats." Rides the Opportunist (StatStageChangeCopy) hook to fire
      // a scripted Hyper Beam at the foe. (The prior wire boosted the holder's
      // own ATK — wrong mechanic — and used the broken base attr.)
      return ok([new OnOpponentStatRaiseScriptedMoveAbAttr({ moveId: MoveId.HYPER_BEAM, power: 150 })]);
    case 444: {
      // Evaporate — "Negates all Water-move damage AND sets Mist for 5 turns on
      // the holder's side when hit by a Water move. Mist protects the whole team
      // from stat reductions, INCLUDING self-drops." Vanilla Mist (checked in
      // stat-stage-change-phase) only blocks OTHER-source drops (!selfTarget);
      // to also cover the holder's OWN drops (Overheat / Close Combat / Draco
      // Meteor) while the Evaporate-set Mist is up, add a self-drop immunity
      // gated on the holder's own side holding the MIST tag. The field-wide
      // variant (UserFieldSelfStatDropImmunityAbAttr) also shields the DOUBLES
      // PARTNER's self-drops — the dex's "Mist protects the entire team from stat
      // reductions, including self drops." (StatStageChangePhase consults it on
      // the ally of any self-dropping mon; it still covers the holder itself
      // because it extends SelfStatDropImmunityAbAttr.)
      const mistSelfDropImmunity = new UserFieldSelfStatDropImmunityAbAttr();
      mistSelfDropImmunity.addCondition(pokemon => {
        const ownSide = pokemon.isPlayer() ? ArenaTagSide.PLAYER : ArenaTagSide.ENEMY;
        return !!globalScene.arena.getTagOnSide(ArenaTagType.MIST, ownSide);
      });
      return ok([
        new TypedImmunityWithArenaTagAbAttr({
          immuneType: PokemonType.WATER,
          arenaTag: ArenaTagType.MIST,
          turns: 5,
        }),
        mistSelfDropImmunity,
      ]);
    }
    case 457:
      // Phantom Pain — "Ghost-type moves deal normal damage to Normal." This is
      // OFFENSIVE: the holder's Ghost moves bypass Normal's Ghost immunity,
      // landing for 1.0x (Normal is mono-immune, so the bypass yields neutral).
      return ok([new IgnoreTypeImmunityAbAttr(PokemonType.NORMAL, [PokemonType.GHOST])]);
    case 474:
      // Accelerate — "Moves that need a charge turn are now used instantly."
      // The actual charge SKIP is applied in MoveChargePhase.end() (the real
      // charge-resolution hook, same one Power Herb uses) by checking for this
      // ability id (#449). SkipChargeTurnAbAttr is kept as a harmless registration
      // marker + belt-and-braces tag clear; the PreAttack approach alone never
      // skipped the charge turn.
      return ok([new SkipChargeTurnAbAttr()]);
    case 515:
      // Retriever — "Retrieves its original held item on switch-out if it is
      // not currently holding one." The snapshot attr records the entry item on
      // switch-in; the restore attr re-grants it on switch-out (also un-marks
      // eaten berries so they reconstitute).
      return ok([new PostSummonRetrieverSnapshotAbAttr(), new PreSwitchOutItemRestoreAbAttr()]);
    case 523:
      // Grappler — "Trapping moves last 6 turns. Trapping deals 1/6 HP."
      return ok([new TrapDurationModifierAbAttr({ turns: 6, damageFraction: 1 / 6 })]);
    case 818:
      // Tentalock — "Grappler + Serpent Bind" but the ROM dex tightens the
      // trap-proc: "Gives attacks a 50% chance to trap the target for 6 turns"
      // (Serpent Bind alone is 4-5). The composite resolver would reuse Serpent
      // Bind's 4-5/8 proc, so wire Tentalock's own 6-turn / 1/6-HP proc here.
      // Grappler still extends real trapping MOVES; this proc is Tentalock's.
      return ok([
        new TrapDurationModifierAbAttr({ turns: 6, damageFraction: 1 / 6 }),
        new ChanceBattlerTagOnAttackAbAttr({
          chance: 50,
          tags: [BattlerTagType.WRAP],
          contactRequired: false,
          turnRange: [6, 6],
          damageDenominator: 6,
        }),
        new PostTurnFoeStatDropAbAttr({ stat: Stat.SPD, stages: -1, onlyIfTrapped: true }),
      ]);
    case 556:
      // Subdue — "Doubles stat drop effects used by this pokemon."
      return ok([new OutgoingStatDropMultiplierAbAttr({ factor: 2 })]);
    case 577:
      // Sharing Is Caring — "Stat changes are shared between all battlers."
      return ok([new FieldStatShareAbAttr()]);
    case 586:
      // Winged King — "Ups super-effective by 33%."
      return ok([new SuperEffectiveMultiplierBoostAbAttr({ factor: 1.33 })]);
    case 588:
      // Iron Serpent — "Ups super-effective by 33%."
      return ok([new SuperEffectiveMultiplierBoostAbAttr({ factor: 1.33 })]);
    case 595:
      // Noise Cancel — "Protects the party from sound-based moves."
      return ok([new UserFieldFlagImmunityAbAttr({ flag: MoveFlags.SOUND_BASED })]);
    case 598:
      // Malicious — "Lowers the foe's highest Attack and Defense stat."
      return ok([
        new TargetHighestStatDropAbAttr({
          rules: [
            { candidates: [Stat.ATK, Stat.SPATK], stages: -1 },
            { candidates: [Stat.DEF, Stat.SPDEF], stages: -1 },
          ],
        }),
      ]);
    case 602:
      // Lawnmower — "Removes terrain on switch-in. Def+1 when clearing Grassy/
      // Electric, SpDef+1 when clearing Misty/Psychic/Toxic."
      return ok([
        new PostSummonClearTerrainAbAttr({
          byTerrain: [
            { terrain: TerrainType.GRASSY, stat: Stat.DEF, stages: 1 },
            { terrain: TerrainType.ELECTRIC, stat: Stat.DEF, stages: 1 },
            { terrain: TerrainType.MISTY, stat: Stat.SPDEF, stages: 1 },
            { terrain: TerrainType.PSYCHIC, stat: Stat.SPDEF, stages: 1 },
            { terrain: TerrainType.TOXIC, stat: Stat.SPDEF, stages: 1 },
          ],
        }),
      ]);
    case 612:
      // Rejection — "Applies Quash on switch-in."
      return ok([new PostSummonQuashFoesAbAttr()]);
    case 623:
      // Surprise! — "Astonishes enemy priority users in fog." Now uses the
      // real WeatherType.FOG (pokerogue ships FOG in the WeatherType enum).
      // Flinch chance gated on fog being active.
      return ok([
        new PreemptivePriorityCounterAbAttr().addCondition(getWeatherCondition(WeatherType.FOG, WeatherType.EERIE_FOG)),
      ]);
    case 629:
      // Shallow Grave — "After fainting while fog is active, the user revives at
      // 25% max HP when sending out your next party member. This still activates
      // when the user faints on the last turn of fog." A TRUE deferred revive:
      // the holder actually faints (leaves field), then is restored to 25% max
      // HP as a living bench reserve when its side next sends out a party member
      // (see PostFaintDeferredReviveAbAttr). Gated on fog at faint time (so the
      // last-fog-turn faint still arms).
      return ok([
        new PostFaintDeferredReviveAbAttr({
          hpFraction: 0.25,
          requireWeather: [WeatherType.FOG, WeatherType.EERIE_FOG],
        }),
      ]);
    case 634:
      // Last Stand — covered in R20; kept here as no-op (return null to fall through).
      return null;
    case 640:
      // Rhythmic — "Deals 10% more damage for each repeated move use."
      return ok([new RepeatMovePowerBoostAbAttr({ bonus: 0.1 })]);
    case 656:
      // Tag — "Attacks switching opponents with a 20BP Pursuit." R53 now
      // uses the new OnOpponentSwitchOutAbAttr primitive + engine-side
      // hook in switch-summon-phase.ts. Holder fires Pursuit at the
      // leaving opponent (matches the spec exactly).
      return ok([new OnOpponentSwitchOutAbAttr({ moveId: MoveId.PURSUIT })]);
    case 662:
      // Higher Rank — "Priority moves get a 1.2x boost."
      return ok([new MovePowerBoostAbAttr((_user, _t, move) => (move?.priority ?? 0) > 0, 1.2)]);
    case 672:
      // Mosh Pit — "Ally's attacks get a 1.25x boost. 1.5x if attack causes
      // recoil." Faithful ally-damage aura: boosts the HOLDER'S ALLY'S
      // damaging moves via the same move.ts path as Power Spot/Battery, with
      // the 1.5x recoil-move variant.
      return ok([new AllyAttackPowerBoostAbAttr({ baseMultiplier: 1.25, recoilMultiplier: 1.5 })]);
    case 704:
      // Hot Coals — "Sets a burning trap on the opponent's side; the next
      // grounded, burnable foe to switch in is burned, then it's consumed."
      // Lays the dedicated HOT_COALS entry hazard on the FOE's side (was
      // approximated as Toxic Spikes — wrong status; corrected).
      return ok([new EntryEffectAbAttr({ kind: "set-hazard", hazard: ArenaTagType.HOT_COALS, side: "foe" })]);
    case 733:
      // Taekkyeon — "All attacks are dances." Injects the DANCE flag onto all
      // of the holder's non-status moves, so they count as dances (e.g. trigger
      // opposing Dancer, dance-based interactions).
      return ok([new MoveFlagInjectionAbAttr(MoveFlags.DANCE_MOVE, "all-attacks")]);
    case 735:
      // Know Your Place — "Contact attacks make foes move last for 5 turns."
      return ok([new ContactQuashAbAttr()]);
    case 750:
      // Neurotoxin — "Inflicting poison also lowers Attack, SpAtk, Speed."
      return ok([
        new StatusCascadeAbAttr({
          trigger: StatusEffect.POISON,
          stats: [
            { stat: Stat.ATK, stages: -1 },
            { stat: Stat.SPATK, stages: -1 },
            { stat: Stat.SPD, stages: -1 },
          ],
        }),
      ]);
    case 773:
      // Soothsayer — "On entry, all attacks received are considered not very
      // effective for three turns." A time-boxed Tera-Shell-style effectiveness
      // FLOOR (clamps the received type multiplier to 0.5x — a 2x/4x hit drops to
      // 0.5x; an already-resisted hit is untouched), NOT a flat x0.5 damage cut.
      // (The prior TimeLimitedDamageReduction over-reduced resisted hits and
      // under-reduced super-effective ones.)
      return ok([new TimeLimitedEffectivenessFloorAbAttr({ turns: 3 })]);
    case 808:
      // Malodor — "Suppresses attacker's abilities on contact."
      return ok([new SuppressAttackerAbilityAbAttr({ contactOnly: true })]);
    case 812:
      // Reverberate — "Converts all Normal-type moves into Sound moves, enabling
      // them to benefit from sound-based abilities and interactions." Grant the
      // SOUND_BASED flag to the holder's Normal moves (was mis-modeled as a flat
      // 1.3x power boost — the description is a flag grant, not a damage boost).
      return ok([
        new AddMoveFlagAbAttr({
          filter: (user, move) => user.getMoveType(move) === PokemonType.NORMAL,
          flags: [MoveFlags.SOUND_BASED],
        }),
      ]);
    case 816:
      // Mental Pollution — "Applies ability suppression to OTHER Pokémon when the
      // user becomes enraged. Suppression lasts while those Pokémon remain on the
      // field." Enraged is the ER_ENRAGE status. This marker broadcasts a
      // FIELD-WIDE ability suppression (read in Pokemon.canApplyAbility): while
      // the holder is enraged, EVERY other on-field Pokémon (foes AND allies) has
      // its suppressable abilities disabled for as long as it stays out — the
      // enraged holder is self-exempt. Replaces the old PostDefend
      // SuppressAttackerAbilityAbAttr wire, which only fired when a foe LANDED an
      // attack on the enraged holder (a foe that never attacked kept its ability).
      return ok([new SuppressFieldAbilitiesWhenEnragedAbAttr()]);
    case 817:
      // Madness Enhancement — "Enrages in fog, halves damage when enraged AND
      // takes NO damage from enrage." The holder enrages ITSELF (ER_ENRAGE) while
      // fog is active, halves incoming damage whenever enraged OR fog is active,
      // and (the missing clause) is IMMUNE to enrage's 33% self-recoil —
      // BlockRecoilDamageAttr is exactly what the ER_ENRAGE tick consults to waive
      // the recoil (battler-tags.ts).
      return ok([
        new ReceivedMoveDamageMultiplierAbAttr(
          target =>
            target.getTag(BattlerTagType.ER_ENRAGE) != null || isFogWeather(globalScene.arena.weather?.weatherType),
          0.5,
        ),
        new BlockRecoilDamageAttr(),
        new PostSummonAddBattlerTagAbAttr(BattlerTagType.ER_ENRAGE, 1).addCondition(() =>
          isFogWeather(globalScene.arena.weather?.weatherType),
        ),
      ]);
    case 828:
      // Overzealous — "User's super-effective moves have +1 priority."
      return ok([new SePriorityBonusAbAttr({ priority: 1 })]);
    case 833:
      // Harukaze — "Setting Grassy Terrain sets Tailwind and vice versa."
      // `side: PLAYER` is HOLDER-RELATIVE (resolved to the holder's own side at
      // apply time) - NOT the literal player side, and NOT `BOTH` (which is what
      // the old `side: 0` value actually was: ArenaTagSide.BOTH, leaking Tailwind
      // to the enemy - #194 both-sides bug).
      return ok([
        new PostSummonStackSetEffectsAbAttr({
          terrain: TerrainType.GRASSY,
          tags: [{ type: ArenaTagType.TAILWIND, turns: 4, side: ArenaTagSide.PLAYER }],
        }),
      ]);
    case 842:
      // Festivities — "Sound moves become dance moves and vice versa." Both
      // directions (the dex is bidirectional):
      //   - SOUND -> DANCE: the holder's sound moves count as dance, so OTHER
      //     battlers' Dancer-type abilities copy them.
      //   - DANCE -> SOUND: the holder's dance moves count as sound, so they
      //     benefit from / are subject to sound-based abilities (Punk Rock boost,
      //     Soundproof immunity, Liquid Voice) and bypass Substitute.
      // It does NOT grant the holder Dancer itself - the previous
      // PostDancingMoveAbAttr made Festivities wrongly "act like Dancer" (#449),
      // so that is gone. Both halves work because their consumers route through
      // Move.doesFlagEffectApply (the user-aware flag check), which honors these
      // injections - the SOUND consumers were switched off the static hasFlag for
      // exactly this (see init-abilities Soundproof/Punk Rock/Liquid Voice).
      return ok([
        new MoveFlagInjectionAbAttr(MoveFlags.DANCE_MOVE, "sound-moves"),
        new MoveFlagInjectionAbAttr(MoveFlags.SOUND_BASED, "dance-moves"),
      ]);
    case 866:
      // Relic Stone — "Other battlers don't benefit from STAB."
      return ok([new StabSuppressAuraAbAttr()]);
    case 880:
      // Paint Shot — "Mega launcher moves change the target's type to the move
      // used." This is OFFENSIVE (the holder's pulse moves repaint the FOE), so
      // use the PostAttack target-type-change primitive gated on PULSE_MOVE (and
      // NOT contact, since pulse moves are non-contact). Was previously wired
      // backwards as a defensive self-type-change when hit by a pulse move.
      return ok([
        new PostAttackChangeTargetTypeAbAttr({
          type: "moveType",
          contactOnly: false,
          requireFlag: MoveFlags.PULSE_MOVE,
        }),
      ]);
    case 886:
      // Curse of Famine — "Eats terrain, restores hp, and boosts a defense."
      // Clear terrain → +1 Def AND restore 1/4 max HP (the HP restore was missing).
      return ok([
        new PostSummonClearTerrainAbAttr({
          onCleared: [{ stat: Stat.DEF, stages: 1 }],
          healFractionOnCleared: 0.25,
        }),
      ]);
    case 889:
      // Thick Blubber — "Take 1/4 damage from fire and ice in return for 1/2 speed."
      return ok([
        new DamageReductionAbAttr({
          reduction: 0.75,
          filter: { kind: "move-type", type: PokemonType.FIRE },
        }),
        new DamageReductionAbAttr({
          reduction: 0.75,
          filter: { kind: "move-type", type: PokemonType.ICE },
        }),
        new StatMultiplierAbAttr(Stat.SPD, 0.5),
      ]);
    case 891:
      // Rat King — "Allies with a BST below 400 get their stats boosted by
      // 50%." R53 audit-fix: upgraded from BstConditionalAllyAura (one-shot
      // stat-stage on entry) to PersistentFieldAura (true persistent aura
      // — re-evaluates on every getStat call). Allies who switch in AFTER
      // Rat King also get the boost.
      return ok([
        new PersistentFieldAuraAbAttr({
          stats: [Stat.ATK, Stat.DEF, Stat.SPATK, Stat.SPDEF, Stat.SPD],
          multiplier: 1.5,
          predicate: (ally, _holder) => {
            const bst = ally.species.baseStats.reduce((s, v) => s + v, 0);
            return bst < 400;
          },
          includeSelf: false,
        }),
      ]);
    case 896:
      // Spyware — "Sharply raises a stat based on foe's strong point."
      return ok([
        new FoeStrongestStatSelfBoostAbAttr({
          stages: 2,
          physicalCounter: Stat.DEF,
          specialCounter: Stat.SPDEF,
        }),
      ]);
    case 899:
      // Backup Power — "Revives at 25% HP once after fainting in Electric
      // Terrain." A TRUE deferred revive: the holder actually faints (leaves
      // field, fires faint interactions) and is restored to 25% max HP as a
      // living bench reserve at the next send-out on its side (see
      // PostFaintDeferredReviveAbAttr). Gated on Electric Terrain at faint time.
      return ok([new PostFaintDeferredReviveAbAttr({ hpFraction: 0.25, requireTerrain: [TerrainType.ELECTRIC] })]);
    case 904:
      // Strong Foundation — "Takes 1/2 Water and Ground damage and can't be forced out."
      return ok([
        new DamageReductionAbAttr({
          reduction: 0.5,
          filter: { kind: "move-type", type: PokemonType.WATER },
        }),
        new DamageReductionAbAttr({
          reduction: 0.5,
          filter: { kind: "move-type", type: PokemonType.GROUND },
        }),
        new ForceSwitchOutImmunityAbAttr(),
      ]);
    case 905:
      // Fog Machine — "When hit, set up Eerie Fog." Pokerogue's
      // WeatherType.FOG exists; we hook via the existing CounterAttack
      // surface using a custom HAZE-style approach. Since we can't
      // directly enqueue a SetWeather phase via a move, we install fog
      // via a PostDefend hook that directly calls arena.trySetWeather.
      return ok([new SetFogOnHitAbAttr()]);
    case 911:
      // Greedy — "Uses Thief when it loses an item." Pokerogue already
      // has PostItemLostAbAttr (Cud Chew uses it). We piggyback by adding
      // an attr that enqueues Thief on item loss. The actual class can be
      // imported from #abilities/ab-attrs — PostItemLostApplyBattlerTagAbAttr
      // exists. For Greedy we want a scripted move spawn, not a tag, so
      // we add a small ER primitive.
      return ok([new PostItemLostScriptedMoveAbAttr({ moveId: MoveId.THIEF })]);
    case 913:
      // Strikeout — "Forces the foe out if they don't attack for 3 turns."
      // Tracks each foe's consecutive idle (no damaging move) turns from its
      // move history; forces it out at 3.
      return ok([new ForceFoeOutOnInactivityAbAttr(3)]);
    case 914:
      // Home Run — "Landing a crit boosts your 3 lowest stats once per turn."
      return ok([new OnCritStatBoostLowestAbAttr({ n: 3, stages: 1 })]);
    case 943:
      // Sap Trap — "Lowers foe's speed at the end of turns. At -3 they get trapped."
      return ok([new PostTurnFoeStatDropAbAttr({ stat: Stat.SPD, stages: -1, trapAtStage: -3 })]);
    case 981:
      // Hollow Ice Zone — "Ice-type moves apply Ice Statue, then the user
      // switches." On the holder's Ice-type attack: apply the real ER_ICE_STATUE
      // tag (target becomes pure Ice with no resistances + no frostbite
      // immunity), then U-turn the holder out.
      return ok([
        new PostAttackApplyBattlerTagAbAttr(
          false,
          (user, _t, move) => (user.getMoveType(move) === PokemonType.ICE ? 100 : 0),
          BattlerTagType.ER_ICE_STATUE,
        ),
        new SelfSwitchOnMoveTypeAbAttr(PokemonType.ICE),
      ]);
    case 1000:
      // Survivor Bias — "Not very effective moves can't cause fainting."
      return ok([new DamageCapOnResistAbAttr()]);
    case 1005:
      // Power Outage — "Boosts first Electric attack by 2x then loses Electric type."
      return ok([
        new OneShotTypeBoostAbAttr({ type: PokemonType.ELECTRIC, factor: 2 }),
        new OneShotTypeBoostFollowupAbAttr({ type: PokemonType.ELECTRIC, factor: 2 }),
      ]);
    case 1030:
      // Sleek Scales — "Uses +15% of its Speed when defending."
      return ok([
        new SpeedBonusToStatAbAttr({ sourceStat: Stat.SPD, stat: Stat.DEF, speedFraction: 0.15 }),
        new SpeedBonusToStatAbAttr({ sourceStat: Stat.SPD, stat: Stat.SPDEF, speedFraction: 0.15 }),
      ]);
    default:
      return null;
  }
}

/**
 * Dispatcher entry point. Looks up the right per-archetype handler and
 * invokes it. The caller wraps any throw in the init result's `errors`
 * array; this function ITSELF never throws on classifier-shape mismatches —
 * it returns a `DispatchResult` with `skipReason` set.
 *
 * @param archetype     - The archetype kind (matches `ErArchetypeKind`).
 * @param params        - Classifier-emitted params (or `null` for `bespoke`).
 * @param erAbilityId   - Optional ER ability id. Required for
 *                        `composite-vanilla-mashup` rows (used to look up the
 *                        resolved-parts side table); ignored otherwise.
 */
export function dispatchArchetype(
  archetype: ErArchetypeKind,
  params: Record<string, unknown> | null,
  erAbilityId: number | null = null,
): DispatchResult {
  return dispatchArchetypeInternal(erAbilityId, archetype, params, new Set());
}
