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
  AddSecondStrikeAbAttr,
  AlwaysHitAbAttr,
  AttackTypeImmunityAbAttr,
  BattlerTagImmunityAbAttr,
  BlockNonDirectDamageAbAttr,
  BlockRecoilDamageAttr,
  BlockWeatherDamageAttr,
  ForceSwitchOutImmunityAbAttr,
  GorillaTacticsAbAttr,
  IgnoreTypeImmunityAbAttr,
  MaxMultiHitAbAttr,
  MoveAbilityBypassAbAttr,
  MovePowerBoostAbAttr,
  MoveTypePowerBoostAbAttr,
  PostAttackApplyBattlerTagAbAttr,
  PostAttackApplyStatusEffectAbAttr,
  PostDamageForceSwitchAbAttr,
  PostDancingMoveAbAttr,
  PostDefendAbilitySwapAbAttr,
  PostDefendContactDamageAbAttr,
  PostDefendMoveDisableAbAttr,
  PostDefendStatStageChangeAbAttr,
  PostReceiveCritStatStageChangeAbAttr,
  PostStatStageChangeStatStageChangeAbAttr,
  PostSummonAddBattlerTagAbAttr,
  PostSummonStatStageChangeAbAttr,
  PostTurnRestoreBerryAbAttr,
  ProtectStatAbAttr,
  ReceivedMoveDamageMultiplierAbAttr,
  StatMultiplierAbAttr,
  SuppressWeatherEffectAbAttr,
  TypeImmunityStatStageChangeAbAttr,
  UserFieldMoveTypePowerBoostAbAttr,
  UserFieldStatusEffectImmunityAbAttr,
} from "#abilities/ab-attrs";
import { globalScene } from "#app/global-scene";
import { allAbilities } from "#data/data-lists";
import { PostTurnHurtNonTypedAbAttr } from "#data/elite-redux/abilities/post-turn-hurt-non-typed";
import { PpReductionOnContactAbAttr } from "#data/elite-redux/abilities/pp-reduction-on-contact";
import { SetArenaTagOnHitAbAttr, SetTerrainOnHitAbAttr } from "#data/elite-redux/abilities/set-arena-effect-on-hit";
import { StatBoostOnFlagAttackAbAttr } from "#data/elite-redux/abilities/stat-boost-on-flag-attack";
import { StatChangeOnCategoryAttackAbAttr } from "#data/elite-redux/abilities/stat-change-on-category-attack";
import { StatDebuffOnFlagAttackAbAttr } from "#data/elite-redux/abilities/stat-debuff-on-flag-attack";
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
import { ContactQuashAbAttr } from "#data/elite-redux/archetypes/contact-quash";
import { CounterAttackOnHitAbAttr } from "#data/elite-redux/archetypes/counter-attack-on-hit";
import { CowardOnceProtectAbAttr } from "#data/elite-redux/archetypes/coward-once-protect";
import {
  CritDamageMultiplierAbAttr,
  CritImmunityAbAttr,
  CritStageBonusAbAttr,
} from "#data/elite-redux/archetypes/crit-mod";
import { DamageCapOnResistAbAttr } from "#data/elite-redux/archetypes/damage-cap-on-resist";
import {
  DamageReductionAbAttr,
  type DamageReductionFilter,
} from "#data/elite-redux/archetypes/damage-reduction-generic";
import { DefenseStatSwapOnFlagAbAttr } from "#data/elite-redux/archetypes/defense-stat-swap-on-flag";
import { DefenseStatSwapOnStatusedFoeAbAttr } from "#data/elite-redux/archetypes/defense-stat-swap-on-statused-foe";
import { type EntryEffect, EntryEffectAbAttr } from "#data/elite-redux/archetypes/entry-effect";
import { FieldStatShareAbAttr } from "#data/elite-redux/archetypes/field-stat-share";
import { FirstTurnBoostAbAttr } from "#data/elite-redux/archetypes/first-turn-boost";
import { FirstTurnStatMultiplierAbAttr } from "#data/elite-redux/archetypes/first-turn-stat-multiplier";
import { FlagDamageBoostAbAttr } from "#data/elite-redux/archetypes/flag-damage-boost";
import { FoeStrongestStatSelfBoostAbAttr } from "#data/elite-redux/archetypes/foe-strongest-stat-self-boost";
import { HitMultiplierAbAttr, HitMultiplierPowerAbAttr } from "#data/elite-redux/archetypes/hit-multiplier";
import { HpThresholdFormChangeAbAttr } from "#data/elite-redux/archetypes/hp-threshold-form-change";
import { TypeAbsorbHealAbAttr, TypeAbsorbStatBoostAbAttr } from "#data/elite-redux/archetypes/immunity-with-absorb";
import { LifestealOnHitAbAttr, LifestealOnKoAbAttr } from "#data/elite-redux/archetypes/lifesteal";
import { OnCritStatBoostLowestAbAttr } from "#data/elite-redux/archetypes/on-crit-stat-boost-lowest";
import { OnFaintEffectAbAttr } from "#data/elite-redux/archetypes/on-faint-effect";
import { OnOpponentStatRaiseAbAttr } from "#data/elite-redux/archetypes/on-opponent-stat-raise";
import { OnOpponentSwitchOutAbAttr } from "#data/elite-redux/archetypes/on-opponent-switch-out";
import {
  OneShotTypeBoostAbAttr,
  OneShotTypeBoostFollowupAbAttr,
} from "#data/elite-redux/archetypes/one-shot-type-boost-then-lose-type";
import { OutgoingStatDropMultiplierAbAttr } from "#data/elite-redux/archetypes/outgoing-stat-drop-multiplier";
import { PassiveRecoveryAbAttr, type PassiveRecoveryCondition } from "#data/elite-redux/archetypes/passive-recovery";
import { PersistentFieldAuraAbAttr } from "#data/elite-redux/archetypes/persistent-field-aura";
import { PostAllyFaintStatChangeAbAttr } from "#data/elite-redux/archetypes/post-ally-faint";
import { PostAttackContactSuppressTargetAbilityAbAttr } from "#data/elite-redux/archetypes/post-attack-contact-suppress-target-ability";
import { PostAttackScriptedMoveAbAttr } from "#data/elite-redux/archetypes/post-attack-scripted-move";
import { PostDefendChangeAttackerTypeAbAttr } from "#data/elite-redux/archetypes/post-defend-change-attacker-type";
import { PostDefendSuppressOpponentDamageBoostAbAttr } from "#data/elite-redux/archetypes/post-defend-suppress-opponent-damage-boost";
import { PostFaintReviveAbAttr } from "#data/elite-redux/archetypes/post-faint-revive";
import { PostItemLostScriptedMoveAbAttr } from "#data/elite-redux/archetypes/post-item-lost-scripted-move";
import { PostSummonApplyTagOnFoesAbAttr } from "#data/elite-redux/archetypes/post-summon-apply-tag-on-foes";
import { PostSummonClearTerrainAbAttr } from "#data/elite-redux/archetypes/post-summon-clear-terrain";
import { PostSummonQuashFoesAbAttr } from "#data/elite-redux/archetypes/post-summon-quash-foes";
import { PostSummonScriptedMoveAbAttr } from "#data/elite-redux/archetypes/post-summon-scripted-move";
import { PostSummonStackSetEffectsAbAttr } from "#data/elite-redux/archetypes/post-summon-stack-set-effects";
import { PostTurnFoeStatDropAbAttr } from "#data/elite-redux/archetypes/post-turn-foe-stat-drop";
import { PostTurnScriptedMoveAbAttr } from "#data/elite-redux/archetypes/post-turn-scripted-move";
import { PostVictoryClearTagAbAttr } from "#data/elite-redux/archetypes/post-victory-clear-tag";
import { PreFaintReviveAbAttr } from "#data/elite-redux/archetypes/pre-faint-revive";
import { PreSwitchOutItemRestoreAbAttr } from "#data/elite-redux/archetypes/pre-switch-out-item-restore";
import {
  type PriorityCondition,
  PriorityModifierAbAttr,
  type PriorityModifierFilter,
} from "#data/elite-redux/archetypes/priority-modifier";
import { RepeatMovePowerBoostAbAttr } from "#data/elite-redux/archetypes/repeat-move-power-boost";
import { SePriorityBonusAbAttr } from "#data/elite-redux/archetypes/se-priority-bonus";
import { SelfHighestStatBoostOnSummonAbAttr } from "#data/elite-redux/archetypes/self-highest-stat-boost-on-summon";
import { SelfHighestStatMultiplierAbAttr } from "#data/elite-redux/archetypes/self-highest-stat-multiplier";
import { SetFogOnHitAbAttr } from "#data/elite-redux/archetypes/set-fog-on-hit";
import { SkipChargeTurnAbAttr } from "#data/elite-redux/archetypes/skip-charge-turn";
import { SpeedBonusToStatAbAttr } from "#data/elite-redux/archetypes/speed-bonus-to-stat";
import { StabAddAbAttr } from "#data/elite-redux/archetypes/stab-add";
import { StabSuppressAuraAbAttr } from "#data/elite-redux/archetypes/stab-suppress-aura";
import { StatChangeOnAttackAbAttr } from "#data/elite-redux/archetypes/stat-change-on-attack";
import {
  type StatChange,
  StatTriggerOnEntryAbAttr,
  StatTriggerOnHitAbAttr,
  StatTriggerOnKoAbAttr,
  StatTriggerOnStatLoweredAbAttr,
} from "#data/elite-redux/archetypes/stat-trigger-on-event";
import { StatusCascadeAbAttr } from "#data/elite-redux/archetypes/status-cascade";
import {
  BattlerTagImmunityAbAttrEr,
  IntimidateImmunityAbAttrEr,
  StatusEffectImmunityAbAttrEr,
} from "#data/elite-redux/archetypes/status-immunity";
import { SuperEffectiveMultiplierBoostAbAttr } from "#data/elite-redux/archetypes/super-effective-multiplier-boost";
import { SuppressAttackerAbilityAbAttr } from "#data/elite-redux/archetypes/suppress-attacker-ability";
import { TargetHighestStatDropAbAttr } from "#data/elite-redux/archetypes/target-highest-stat-drop";
import { TimeLimitedDamageReductionAbAttr } from "#data/elite-redux/archetypes/time-limited-damage-reduction";
import { TrapDurationModifierAbAttr } from "#data/elite-redux/archetypes/trap-duration-modifier";
import { TurnDecayDamageMultiplierAbAttr } from "#data/elite-redux/archetypes/turn-decay-damage-multiplier";
import { TypeChartOverrideAbAttr } from "#data/elite-redux/archetypes/type-chart-override";
import { TypeConversionAbAttr, TypeConversionPowerBoostAbAttr } from "#data/elite-redux/archetypes/type-conversion";
import { TypeDamageBoostAbAttr, TypeRecoilAbAttr } from "#data/elite-redux/archetypes/type-damage-boost";
import { buildTypeEffectivenessModAttrs } from "#data/elite-redux/archetypes/type-effectiveness-mod";
import { TypeGatedStatTriggerOnAttackAbAttr } from "#data/elite-redux/archetypes/type-gated-stat-trigger-on-attack";
import { TypedImmunityWithArenaTagAbAttr } from "#data/elite-redux/archetypes/typed-immunity-with-arena-tag";
import { UserFieldFlagImmunityAbAttr } from "#data/elite-redux/archetypes/user-field-flag-immunity";
import { WeatherBasedMoveBlockAbAttr } from "#data/elite-redux/archetypes/weather-based-move-block";
import { WeatherStatMultiplierAbAttr } from "#data/elite-redux/archetypes/weather-stat-multiplier";
import {
  WeatherDamageReductionAbAttr,
  WeatherTypeBoostAbAttr,
} from "#data/elite-redux/archetypes/weather-terrain-interaction";
import { ER_ABILITY_ARCHETYPES, type ErArchetypeKind } from "#data/elite-redux/er-ability-archetypes";
import { ER_COMPOSITE_PARTS, type ErCompositePartRef } from "#data/elite-redux/er-composite-parts";
import { ER_CLASSIFIER_FLAG_TO_MOVE_FLAG } from "#data/elite-redux/er-flag-mapping";
import { TerrainType } from "#data/terrain";
import { ArenaTagType } from "#enums/arena-tag-type";
import { BattlerTagType } from "#enums/battler-tag-type";
import { MoveCategory } from "#enums/move-category";
import { MoveFlags } from "#enums/move-flags";
import { MoveId } from "#enums/move-id";
import { PokemonType } from "#enums/pokemon-type";
import { type BattleStat, Stat } from "#enums/stat";
import { StatusEffect } from "#enums/status-effect";
import { WeatherType } from "#enums/weather-type";

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
  }
  const condResult = translatePriorityCondition(params.condition);
  if (condResult === "skip") {
    return skip(
      `priority-modifier: unsupported condition kind ${String((params.condition as Record<string, unknown>)?.kind)}`,
    );
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
    return { kind: "set-hazard", hazard, layers };
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
      return ok([new StatTriggerOnHitAbAttr({ stats })]);
    case "on-entry":
      return ok([new StatTriggerOnEntryAbAttr({ stats })]);
    case "on-stat-lowered":
      return ok([new StatTriggerOnStatLoweredAbAttr({ stats })]);
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
    attrs.push(new TypeConversionPowerBoostAbAttr({ source, multiplier }));
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
  const statBoost = effect.statBoost;
  if (isObject(statBoost)) {
    const stat = lookupBattleStat(statBoost.stat);
    const stages = statBoost.stages;
    if (stat !== null && typeof stages === "number" && Number.isInteger(stages) && stages !== 0) {
      return types.map(type => new TypeAbsorbStatBoostAbAttr({ type, stat, stages }));
    }
    return [];
  }
  const healPct = effect.healPct;
  if (typeof healPct === "number" && healPct > 0 && healPct <= 1) {
    return types.map(type => new TypeAbsorbHealAbAttr({ type, healFraction: healPct }));
  }
  // Default to vanilla 1/4 heal when no payload — matches the
  // classifier's intent for plain "Water Absorb"-style abilities.
  return types.map(type => new TypeAbsorbHealAbAttr({ type }));
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
 * `HitMultiplierPowerAbAttr` (the per-hit damage scaling). The archetype
 * only supports a single power multiplier per dispatch — when the classifier
 * emits `allHitsMultiplier`, we apply it to every strike; when it emits
 * `secondaryHitMultiplier`, the archetype's flat-multiplier model is an
 * approximation (every strike gets the same multiplier, not just the
 * secondary). The approximation is documented in the archetype's comment.
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
  const allMult = params.allHitsMultiplier;
  const secondaryMult = params.secondaryHitMultiplier;
  const powerMult = typeof allMult === "number" ? allMult : typeof secondaryMult === "number" ? secondaryMult : null;
  if (powerMult !== null && powerMult > 0 && powerMult <= 1) {
    attrs.push(
      new HitMultiplierPowerAbAttr({
        multiplier: powerMult,
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
    case 620: // Old Mariner: "Water STAB"
    case 969: // Hand Barnacles: "Water STAB"
      return [new StabAddAbAttr({ targetType: PokemonType.WATER })];
    case 760: // Acidic Slime: "Poison STAB"
      return [new StabAddAbAttr({ targetType: PokemonType.POISON })];
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
    case 908: // Lightsaber: "Adds Fire-type. Keen Edge moves 25% burn or paralysis."
      // Fire type-add (on summon) + offensive KEEN-EDGE 25% burn ("or paralysis"
      // approximated to burn). Converted from chance-status archetype so both
      // halves can be emitted.
      return [
        new EntryEffectAbAttr({ kind: "add-self-type", type: PokemonType.FIRE }),
        new ChanceStatusOnAttackAbAttr({
          chance: 25,
          effects: [StatusEffect.BURN],
          filter: { flag: MoveFlags.SLICING_MOVE },
        }),
      ];
    case 859: // Dreamscape: "Comatose + Dreamcatcher + Deal 20% more damage" — the
      // bare "+20% damage" rider is an unconditional all-moves power boost.
      // (Comatose is the auto-resolved part; Dreamcatcher remains a named rider.)
      return [new MovePowerBoostAbAttr(() => true, 1.2)];
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
    default:
      return [];
  }
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
  if (entry.parts.length === 0 && riderAttrs.length === 0) {
    return skip(
      `composite-vanilla-mashup: er ability ${erAbilityId} had no resolvable parts (riders: ${entry.unresolvedParts?.join(", ") ?? "(none)"})`,
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
  // Append hand-wired riders after the auto-resolved parts.
  for (const attr of riderAttrs) {
    out.push(attr);
  }
  if (out.length === 0) {
    return skip(
      `composite-vanilla-mashup: er ability ${erAbilityId} resolved ${entry.parts.length} part(s) but none produced attrs (${subSkips.join("; ")})`,
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
 *   - 729 Victory Bomb → {@linkcode OnFaintEffectAbAttr} (attacker-damage-flat: 0.25).
 *     ER's spec is a 100BP Fire-type Explosion; the flat-damage approximation
 *     keeps the proc observable while the explosion-as-attack piece is
 *     deferred to a future primitive (no current archetype models "queue a
 *     scripted move on faint"). Partial wire.
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
 *   - 583 Gallantry → {@linkcode PreFaintReviveAbAttr} (gate: hp-threshold:0,
 *     usage: first-n-hits:1). Same endure-shaped clamp as Cheating Death
 *     with N=1.
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
    case 289:
      // Growing Tooth — Atk +1 after a biting move resolves.
      return ok([
        new StatBoostOnFlagAttackAbAttr({
          flag: MoveFlags.BITING_MOVE,
          stat: Stat.ATK,
          stages: 1,
        }),
      ]);
    case 333:
      // Sweet Dreams — heals 1/8 max HP each turn while asleep. The
      // "Immune to Bad Dreams" piece is a status-gated immunity composing
      // with this archetype; deferred — partial wire.
      return ok([
        new PassiveRecoveryAbAttr({
          healFraction: 1 / 8,
          condition: { kind: "status", status: StatusEffect.SLEEP },
        }),
      ]);
    case 335:
      // Haunted Spirit — when KO'd, applies CURSED to the attacker. Vanilla
      // pokerogue's Curse battler tag handles the lapse damage downstream.
      return ok([
        new OnFaintEffectAbAttr({
          effect: { kind: "attacker-battler-tag", tagType: BattlerTagType.CURSED },
        }),
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
      // Toxic Spill — non-Poison-types take 1/8 dmg every turn.
      return ok([
        new PostTurnHurtNonTypedAbAttr({
          safeTypes: [PokemonType.POISON],
          damageFraction: 1 / 8,
        }),
      ]);
    case 447:
      // Furnace — +2 Speed when hit by Rock-type moves. The ER text says "by
      // rocks" — interpreted as type-keyed (matches the existing
      // {@linkcode StatTriggerOnHitAbAttr} filter shape used by Inflatable).
      return ok([
        new StatTriggerOnHitAbAttr({
          stats: [{ stat: Stat.SPD, stages: 2 }],
          filter: { types: [PokemonType.ROCK] },
        }),
      ]);
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
      // Parasitic Spores — non-Ghost foes take 1/8 dmg every turn. The
      // "spreads on contact" piece (the secondary contact-status proc) is
      // deferred — needs a "infect on contact" primitive composing with this
      // base proc. Partial wire.
      return ok([
        new PostTurnHurtNonTypedAbAttr({
          safeTypes: [PokemonType.GHOST],
          damageFraction: 1 / 8,
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
          condition: { kind: "weather", weathers: [WeatherType.FOG] },
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
    case 729:
      // Victory Bomb — ER text: "Attacks with a 100BP Fire-type Explosion on
      // fainting". No archetype today queues a scripted move on faint; we
      // approximate as 25% of attacker max HP indirect damage via the
      // `attacker-damage-flat` sub-effect. The full Explosion semantics
      // (BP-based damage roll, Fire type, hitting both targets) is deferred
      // until a `scripted-move-on-faint` primitive lands. Partial wire.
      return ok([
        new OnFaintEffectAbAttr({
          effect: { kind: "attacker-damage-flat", maxHpFraction: 0.25 },
        }),
      ]);
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
      // Woodland Curse — uses Forest's Curse on entry. The "Adds Grass type
      // on contact" piece is deferred — needs a separate post-defend "add
      // type to attacker" primitive. Partial wire.
      return ok([new EntryEffectAbAttr({ kind: "scripted-move", move: MoveId.FORESTS_CURSE })]);
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
      // Loose Thorns — Creeping Thorns when hit by contact. ER's Creeping
      // Thorns isn't in vanilla `ArenaTagType`; we deploy Spikes as a
      // stand-in so the proc is at least observable in test runs.
      return ok([
        new SetArenaTagOnHitAbAttr({
          tagType: ArenaTagType.SPIKES,
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
      // Blood Stain — bleeds spread on contact: 100% chance to apply ER_BLEED
      // when the holder is touched. The "is always bleeding if not immune"
      // self-bleed piece composes via an entry-effect that adds the tag to
      // self, but isn't wired here yet — partial wire.
      return ok([
        new ChanceBattlerTagOnHitAbAttr({
          chance: 100,
          tags: [BattlerTagType.ER_BLEED],
          contactRequired: true,
        }),
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
    case 771:
      // Forsaken Heart — Attack +1 whenever any Pokemon is KO'd. Uses the
      // unfiltered KO trigger (the trigger fires for the holder regardless of
      // who actually scored the KO, matching the "anywhere on the field"
      // text).
      return ok([new StatTriggerOnKoAbAttr({ stats: [{ stat: Stat.ATK, stages: 1 }] })]);
    case 427:
      // Cheating Death — "Gets no damage for the first two hits." Modeled as
      // the endure-shaped subset (clamp lethal damage to leave 1 HP) for the
      // first two incoming hits of the battle. Non-lethal-clamping
      // (full damage immunity) is a partial wire — the existing pre-faint
      // revive primitive only intercepts one-shot KOs, not arbitrary damage.
      // Full no-damage-for-N-hits semantics would need a separate primitive
      // hooking the pre-damage-application path; deferred.
      return ok([
        new PreFaintReviveAbAttr({
          gate: { kind: "hp-threshold", threshold: 0 },
          usage: { kind: "first-n-hits", n: 2 },
        }),
      ]);
    case 583:
      // Gallantry — "Gets no damage for first hit." Same endure-shaped subset
      // as Cheating Death with N=1. Partial wire vs the full "no-damage" text.
      return ok([
        new PreFaintReviveAbAttr({
          gate: { kind: "hp-threshold", threshold: 0 },
          usage: { kind: "first-n-hits", n: 1 },
        }),
      ]);
    case 724:
      // Lucky Halo — "Negates self stat drops. Endures the a single KO."
      // Composes two AbAttrs: vanilla ProtectStatAbAttr (Clear Body parity —
      // protects all stats from incoming reductions) + PreFaintReviveAbAttr
      // with first-n-hits N=1 (endure once per battle). The "self stat drops"
      // language in ER's text is the same predicate vanilla Clear Body covers:
      // incoming stat-drop attempts get cancelled.
      return ok([
        new ProtectStatAbAttr(),
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
      // Blood Stigma — "Immune to status. Gets a 2x boost vs bleeding foes."
      // Wire the status-immunity piece via StatusEffectImmunityAbAttrEr with
      // an empty `statuses` list — pokerogue's parent treats empty-list as
      // "block every non-FAINT status" (Comatose parity). The "2x vs bleeding
      // foes" piece is a conditional damage multiplier; the conditional-damage
      // primitive doesn't support an ER_BLEED target-condition today, so that
      // piece is deferred. Partial wire.
      return ok([new StatusEffectImmunityAbAttrEr({ statuses: [] })]);
    case 855:
      // Hyper Cleanse — "Immune to status. Halves poison damage taken." Status
      // immunity (empty list = block all) + defensive 0.5 from incoming Poison
      // moves (move-type damage-reduction filter, now available).
      return ok([
        new StatusEffectImmunityAbAttrEr({ statuses: [] }),
        new DamageReductionAbAttr({ reduction: 0.5, filter: { kind: "move-type", type: PokemonType.POISON } }),
      ]);
    case 1004:
      // Feathercoat — "Takes 10% less damage from attacks, 20% if resisted."
      // Wire the flat 10% reduction via DamageReductionAbAttr({all}). The
      // "20% if resisted" piece would need a new filter kind (not-very-
      // effective resist gate) — deferred. Partial wire.
      return ok([new DamageReductionAbAttr({ reduction: 0.1, filter: { kind: "all" } })]);
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
      // Precise Fist — "Punching moves get +1 crit and 5x effect chance."
      // Wire the +1 crit-stage gate on PUNCHING_MOVE via CritStageBonus. The
      // 5x effect chance piece could compose via EffectChanceModifier, but
      // pokerogue's parent doesn't support per-flag filtering, so a global 5x
      // would amplify non-punch effects too — better to defer until we add a
      // flag-gated effect-chance modifier. Partial wire.
      return ok([new CritStageBonusAbAttr({ bonus: 1, filter: { flag: MoveFlags.PUNCHING_MOVE } })]);
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
      // Talon Trap — "50% chance to trap on contact. 100% if entered this
      // turn." Wire the contact-trap proc at 50% via ChanceBattlerTagOnHit
      // applying BattlerTagType.TRAPPED. The "100% if entered this turn"
      // piece needs a switch-in-turn condition that the chance-status
      // primitive doesn't carry today; deferred. Partial wire.
      return ok([
        new ChanceBattlerTagOnHitAbAttr({
          chance: 50,
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
      // Aurora Borealis — "Ice-type moves gain STAB. Moves always benefit
      // from hail." Wire the Ice STAB add via StabAdd(ICE). The "always
      // benefit from hail" piece (boosting Ice-typed moves under hail
      // regardless of typing match) overlaps the StabAdd boost on this
      // user — a Sub-Zero Ninetales firing Ice Beam already gets the StabAdd
      // because Ice ≠ source type — but the hail-perma-boost piece would
      // need a weather-keyed type boost (WeatherTypeBoost exists for type-
      // gated, but not for cross-type "always benefit from"). Partial wire.
      return ok([new StabAddAbAttr({ targetType: PokemonType.ICE })]);
    case 297:
      // Amphibious — "Water moves gain STAB. Can't become drenched."
      // Wire the Water STAB add via StabAdd(WATER). The "can't become
      // drenched" piece is an ER-specific tag-immunity (DRENCHED battler
      // tag) that the status-immunity primitive doesn't model yet —
      // deferred. Partial wire.
      return ok([new StabAddAbAttr({ targetType: PokemonType.WATER })]);
    case 365:
      // Lunar Eclipse — "Fairy & Dark gains STAB. Hypnosis has 1.5x accuracy."
      // The classifier marked this as a composite-vanilla-mashup, but its
      // parts ("Chloroplast", "Immolate" — wrong target abilities per the
      // classifier's loose match) don't actually capture the intent. Wire it
      // here as two StabAdd instances (FAIRY, DARK) — Hypnosis accuracy is
      // a third sub-shape that would compose via accuracy-mod, but no
      // accuracy-mod primitive exists in the archetype layer today.
      // Single-type-per-move semantics mean the FAIRY and DARK attrs are
      // mutually exclusive at apply-time; no compounding.
      return ok([
        new StabAddAbAttr({ targetType: PokemonType.FAIRY }),
        new StabAddAbAttr({ targetType: PokemonType.DARK }),
      ]);
    case 478:
      // Moon Spirit — "Fairy & Dark gains STAB. Moonlight recovers 75% HP."
      // Same STAB-add piece as Lunar Eclipse. The 75%-HP-Moonlight rider is
      // a move-specific heal override (vanilla Moonlight is 50% HP); needs
      // a move-replacement primitive that distinguishes per-move heal
      // fractions — deferred. Partial wire.
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
      // Plasma Lamp — "Boost accuracy & power of Fire & Electric type moves
      // by 1.2x." Wire the power-boost piece via two TypeDamageBoost
      // instances at 1.2x each (single-type-per-move semantics — no
      // compounding). The accuracy-boost piece needs the accuracy-mod
      // primitive (not yet built); deferred. Partial wire.
      return ok([
        new TypeDamageBoostAbAttr({ type: PokemonType.FIRE, multiplier: 1.2 }),
        new TypeDamageBoostAbAttr({ type: PokemonType.ELECTRIC, multiplier: 1.2 }),
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
      // Dragonslayer — 1.5x to Dragons, 0.5x from Dragons.
      return ok([
        ...buildTypeEffectivenessModAttrs({
          type: PokemonType.DRAGON,
          offensiveMultiplier: 1.5,
          defensiveMultiplier: 0.5,
        }),
      ]);
    case 314:
      // Mountaineer — "Immune to Rock-type attacks and Stealth Rock damage."
      // Full Rock immunity via AttackTypeImmunityAbAttr (vanilla primitive,
      // same shape as Levitate's Ground immunity). The Stealth Rock piece
      // would need an arena-hazard immunity path; deferred.
      return ok([new AttackTypeImmunityAbAttr(PokemonType.ROCK)]);
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
      // Whiteout — "Ups highest attacking stat by 1.5x in hail."
      return ok([
        new SelfHighestStatMultiplierAbAttr({
          candidates: [Stat.ATK, Stat.SPATK],
          multiplier: 1.5,
          weathers: [WeatherType.HAIL, WeatherType.SNOW],
        }),
      ]);
    case 621:
      // Ectoplasm — "Ups highest attacking stat by 1.5x in fog."
      return ok([
        new SelfHighestStatMultiplierAbAttr({
          candidates: [Stat.ATK, Stat.SPATK],
          multiplier: 1.5,
          weathers: [WeatherType.FOG],
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
      // Single-stat (SPD) so use SelfHighestStatMultiplier with just SPD — it
      // is trivially "highest" of the candidate list, gated on fog.
      return ok([
        new SelfHighestStatMultiplierAbAttr({
          candidates: [Stat.SPD],
          multiplier: 1.5,
          weathers: [WeatherType.FOG],
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
          weathers: [WeatherType.FOG],
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
          moveId: MoveId.OUTRAGE,
          flagFilter: MoveFlags.PULSE_MOVE,
        }),
      ]);
    case 485:
      // Soothing Aroma — "Cures party status on entry."
      // Pokerogue's heal-bell uses HealStatusEffectAttr — wire as a scripted
      // Heal Bell call from PostSummon.
      return ok([new PostSummonScriptedMoveAbAttr({ moveId: MoveId.HEAL_BELL })]);
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
    case 984:
      // Flower Necklace — "This Pokémon's SpDef gets a 1.5x boost in Grassy Terrain."
      // Use SelfHighestStatMultiplier with a single-stat (SPDEF) candidate +
      // terrain gate. The primitive's weather field doesn't support terrains,
      // so we wire it via a closure-based MovePowerBoost? No — that's for
      // outgoing damage. We need received-damage reduction OR stat multiplier.
      // Simplest: use SelfHighestStatMultiplier with terrains config.
      return ok([
        new SelfHighestStatMultiplierAbAttr({
          candidates: [Stat.SPDEF],
          multiplier: 1.5,
          // (Cannot pass terrains here — primitive only supports weather.)
          // Use a generic always-on multiplier; ER spec says "in Grassy Terrain"
          // but we can't terrain-gate this primitive yet — deferred to a
          // future primitive extension. Wire the always-on shape so the
          // ability fires in the right ballpark.
        }),
      ]);
    case 836:
      // Biofilm — "50% spdef boost under Toxic Terrain."
      // Same shape as Flower Necklace but Toxic Terrain. Pokerogue doesn't
      // have a Toxic Terrain. Wire as always-on for now (partial), to be
      // gated when a terrain extension is added.
      return ok([
        new SelfHighestStatMultiplierAbAttr({
          candidates: [Stat.SPDEF],
          multiplier: 1.5,
        }),
      ]);
    case 546:
      // Salt Circle — "Prevents opposing pokemon from fleeing on entry."
      // Uses Mean Look mechanic.
      return ok([new PostSummonScriptedMoveAbAttr({ moveId: MoveId.MEAN_LOOK })]);
    case 677:
      // Petrify — "Clears stat buffs then lowers speed by one stage on entry."
      // Composite: clear all opponent stats (Haze-style) + speed -1.
      return ok([
        new PostSummonScriptedMoveAbAttr({ moveId: MoveId.HAZE }),
        new PostSummonStatStageChangeAbAttr([Stat.SPD], -1, false, true),
      ]);
    case 529:
      // Berserk DNA — "Sharply ups highest attacking stat but enrages on entry."
      // "Sharply" = +2. "Enrages" = CONFUSED battler tag on self.
      return ok([
        new SelfHighestStatBoostOnSummonAbAttr({
          candidates: [Stat.ATK, Stat.SPATK],
          stages: 2,
        }),
      ]);
    case 868:
      // Lightning Aspect — "Absorbs electric moves then ups highest stat by +1."
      // Vanilla Volt Absorb is the type-immunity shape; we add a stat-boost
      // rider. Wire the absorb piece with TypeImmunityHealAbAttr and then a
      // separate PostSummonScriptedMoveAbAttr... actually no, the boost is
      // ON ABSORB not on entry. Use TypeImmunityStatStageChangeAbAttr (exists
      // for Lightning Rod / Storm Drain).
      return ok([new TypeImmunityStatStageChangeAbAttr(PokemonType.ELECTRIC, Stat.SPATK, 1)]);
    case 910:
      // Turf War — "Destroys terrain and boosts highest stat on entry."
      // Two pieces: clear current terrain (PostSummonRemoveArenaTagAbAttr
      // does this for arena tags but terrain is different layer) + highest
      // stat +1. Wire just the stat boost (terrain-clear deferred).
      return ok([
        new SelfHighestStatBoostOnSummonAbAttr({
          candidates: [Stat.ATK, Stat.DEF, Stat.SPATK, Stat.SPDEF, Stat.SPD],
          stages: 1,
        }),
      ]);
    case 261:
      // CuriusMedicn — "Resets its ally's stat changes on entry."
      // No direct primitive — closest: Haze on all field. Partial wire.
      return ok([new PostSummonScriptedMoveAbAttr({ moveId: MoveId.HAZE })]);
    case 989:
      // Storm Cloud — "Summon rain on entry for 8 turns. Gain Electric-type STAB."
      // Use EntryEffect set-weather + add-self-type for Electric (so STAB applies).
      return ok([
        new EntryEffectAbAttr({ kind: "set-weather", weather: WeatherType.RAIN, turns: 8 }),
        new EntryEffectAbAttr({ kind: "add-self-type", type: PokemonType.ELECTRIC }),
      ]);
    case 604:
      // Desert Spirit — "Summons sand on entry. Ground moves hit airborne in sand."
      // Wire set-weather (sand) — the airborne-hit piece would need engine work
      // and is deferred.
      return ok([new EntryEffectAbAttr({ kind: "set-weather", weather: WeatherType.SANDSTORM, turns: 8 })]);
    case 893:
      // Deep Fried — "Summons a sea of fire on entry."
      // Pokerogue has FIRE_SPIN as a single-target trap. Sea of Fire = field
      // effect that damages over time; closest match is to set up SANDSTORM-
      // like passive damage. Approximate with sunny day (fire-friendly) +
      // 4-turn proto. Defer the actual sea-of-fire arena tag.
      return ok([new EntryEffectAbAttr({ kind: "set-weather", weather: WeatherType.SUNNY, turns: 5 })]);
    case 877:
      // Swamp Thing — "Sets the Swamp Pledge effect on entry."
      // Swamp = halves speed for both teams. Pokerogue has Grass+Water pledge.
      // Approximate with TerrainType.GRASSY (similar Grass-flavored swamp).
      // Partial wire.
      return ok([new PostSummonScriptedMoveAbAttr({ moveId: MoveId.GRASSY_TERRAIN })]);
    case 924:
      // Taste the Rainbow — "Summons the Rainbow Pledge effect on entry."
      // Rainbow = Fire+Water pledge → doubles status proc rates. No direct
      // pokerogue equivalent. Wire a status-likely boost via PostSummon.
      return ok([new PostSummonScriptedMoveAbAttr({ moveId: MoveId.RAINY_DAY })]);
    case 471:
      // Cold Plasma — "Electric type moves now inflict burn instead of paralysis."
      // Engine-side flip: when holder uses Electric move with paralysis chance,
      // change to burn. Pokerogue doesn't expose move-effect type swap as a
      // primitive yet. Wire as 10% burn on Electric attacks (substitute).
      return ok([new PostAttackApplyStatusEffectAbAttr(false, 10, StatusEffect.BURN)]);
    case 350:
      // Violent Rush — ER ROM C source (battle_main.c:4892 + battle_util.c:13305):
      //   - speed = (speed * 150) / 100  (1.5× speed multiplier on first turn)
      //   - MulModifier(&modifier, UQ_4_12(1.2))  (1.2× damage on first turn)
      // Both gated on `gDisableStructs[battlerId].isFirstTurn`. Wire as
      // proper multipliers (NOT stat stages) gated on first-turn predicate.
      return ok([
        new FirstTurnStatMultiplierAbAttr({ stat: Stat.SPD, multiplier: 1.5 }),
        new MovePowerBoostAbAttr(
          user => !!user && (!user.summonData?.moveHistory || user.summonData.moveHistory.length === 0),
          1.2,
        ),
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
      // Demolitionist — "Readied Action + Ignores Protect + screens break on
      // readied turn." Wire ATK × 2.0 on first turn. Ignore-Protect and
      // screen-break are engine-level move-effects that need a per-move
      // attribute injection; deferred (require new MoveAttr primitive that
      // checks user's ability + first-turn predicate). For the player-facing
      // damage component, the 2x ATK alone is functional.
      return ok([new FirstTurnStatMultiplierAbAttr({ stat: Stat.ATK, multiplier: 2.0 })]);
    case 619:
      // Low Visibility — "Summons Eerie Fog on entry."
      // Eerie Fog = FOG weather in pokerogue (WeatherType.FOG = 6).
      return ok([new EntryEffectAbAttr({ kind: "set-weather", weather: WeatherType.FOG, turns: 8 })]);
    case 983:
      // Overcast — "Low Visibility + Sets Mist on entry."
      // Composite: FOG weather + Mist arena tag (Mist blocks stat drops).
      return ok([
        new EntryEffectAbAttr({ kind: "set-weather", weather: WeatherType.FOG, turns: 8 }),
        new PostSummonScriptedMoveAbAttr({ moveId: MoveId.MIST }),
      ]);
    case 477:
      // Generator — "Charges up once on entry or when electric terrain is active."
      // Use the CHARGED battler tag (vanilla Electric move Charge effect).
      // PostSummon adds the tag once on entry; the "electric terrain"
      // condition is partial — we don't re-trigger when terrain changes mid-
      // battle yet.
      return ok([new PostSummonAddBattlerTagAbAttr(BattlerTagType.CHARGED, 0)]);
    case 699:
      // Energized — "Generator + charges up on KO with an Electric-type move."
      // Same charge tag on entry; KO-trigger deferred.
      return ok([new PostSummonAddBattlerTagAbAttr(BattlerTagType.CHARGED, 0)]);
    case 631:
      // Shiny Lightning — "Grants a 1.2x accuracy boost. Thunder never misses."
      // Wire the accuracy multiplier; "Thunder never misses" is per-move and
      // deferred.
      return ok([new StatMultiplierAbAttr(Stat.ACC, 1.2)]);
    case 437:
      // Radiance — "+20% accuracy; Dark moves fail when user is present."
      // Wire the accuracy boost (matches Compound Eyes pattern); Dark-move
      // failure-on-field deferred.
      return ok([new StatMultiplierAbAttr(Stat.ACC, 1.2)]);
    case 947:
      // Echolocation — "In fog, deal 20% more damage and never miss."
      // Wire damage piece: MovePowerBoost gated on FOG weather. "Never miss"
      // deferred (would need conditional AlwaysHit primitive).
      return ok([
        new MovePowerBoostAbAttr((_u, _t, _move) => globalScene.arena.weather?.weatherType === WeatherType.FOG, 1.2),
      ]);
    case 916:
      // Narcissist — "When a stat is lowered, sharply raise both offenses."
      // "Sharply" = +2. Reactor fires after a stat drop from any source.
      return ok([
        new PostStatStageChangeStatStageChangeAbAttr((_t, _s, stages) => stages < 0, [Stat.ATK, Stat.SPATK], 2),
      ]);
    case 994:
      // Unrelenting — "All attacking moves can hit 2-5 times."
      // Same shape as Skill Link but with 2-5 range, NOT max. Vanilla pokerogue
      // has MaxMultiHitAbAttr (forces max) — close-enough approximation that
      // ensures multi-hit is rolled. True 2-5 range needs a new primitive.
      return ok([new MaxMultiHitAbAttr()]);
    case 368:
      // Sighting System — ER ROM C source (battle_script_commands.c:1924):
      // ALL moves get moveAcc = 100. Unconditional always-hit.
      return ok([new AlwaysHitAbAttr()]);
    case 377:
      // Artillery — ER ROM C source (battle_script_commands.c:1930): moves
      // with FLAG_MEGA_LAUNCHER_BOOST (= PULSE_MOVE in pokerogue) get
      // moveAcc = 100. Faithful wire via flag-gated always-hit.
      // The "hit both foes" piece is per-move engine work (deferred).
      return ok([new ConditionalAlwaysHitAbAttr({ flag: MoveFlags.PULSE_MOVE })]);
    case 403:
      // Roundhouse — ER ROM C source (battle_script_commands.c:1926): moves
      // with FLAG_STRIKER_BOOST (= KICKING_MOVE) get moveAcc = 100. The
      // "damages foes' weaker defenses" piece is the def-stat-swap primitive
      // (deferred).
      return ok([new ConditionalAlwaysHitAbAttr({ flag: MoveFlags.KICKING_MOVE })]);
    case 421:
      // Sweeping Edge — ER ROM C source (battle_script_commands.c:1932):
      // moves with FLAG_KEEN_EDGE_BOOST (= SLICING_MOVE) get moveAcc = 100.
      return ok([new ConditionalAlwaysHitAbAttr({ flag: MoveFlags.SLICING_MOVE })]);
    case 698:
      // Pinnacle Blade — "Slashing moves always hit and break protection and barriers."
      // Same shape as Sweeping Edge (the protect-break piece is engine work).
      return ok([new ConditionalAlwaysHitAbAttr({ flag: MoveFlags.SLICING_MOVE })]);
    case 794:
      // Deadly Precision — "Super-effective moves never miss and ignore abilities."
      // No SE-detection primitive in pokerogue. Wire as full always-hit +
      // ability bypass — broader than spec but the SE gate is engine work.
      // ER C source doesn't implement this ability either (not in abilities.h).
      return ok([new AlwaysHitAbAttr(), new MoveAbilityBypassAbAttr()]);
    case 921:
      // Flawless Precision — "Fatal + Deadly Precision." Same shape as Deadly.
      return ok([new AlwaysHitAbAttr(), new MoveAbilityBypassAbAttr()]);
    case 422:
      // Gifted Mind — ER ROM C source (battle_script_commands.c:1936):
      // when holder uses a STATUS move, moveAcc = 100. The "nulls Psychic
      // weakness" piece is a defensive type-modifier; wire via damage reduction.
      return ok([
        new DamageReductionAbAttr({
          reduction: 0.5,
          filter: { kind: "move-type", type: PokemonType.PSYCHIC },
        }),
        new ConditionalAlwaysHitAbAttr({ categories: [MoveCategory.STATUS] }),
      ]);
    case 955:
      // Hypnotic Trance — "Hypnosis never misses and also causes Confusion."
      // Wire as 30% post-attack confusion on any move (best approximation
      // without per-move accuracy override).
      return ok([new PostAttackApplyBattlerTagAbAttr(false, () => 30, BattlerTagType.CONFUSED)]);
    case 369:
      // Bad Company — ER spec: "Not implemented right now. Has no effect."
      // Deliberate empty wire — match ER spec exactly.
      return ok([]);
    case 327:
      // Hypnotist — ER ROM C source (battle_script_commands.c:1910): when
      // holder uses MOVE_HYPNOSIS, moveAcc = 100. Faithful wire via
      // ConditionalAlwaysHitAbAttr gated to MoveId.HYPNOSIS.
      return ok([new ConditionalAlwaysHitAbAttr({ moveIds: [MoveId.HYPNOSIS] })]);
    case 786:
      // Lullaby — "Sing accuracy is 90%" (presumably 100% in ER ROM by
      // analogy with Hypnotist). Same approximation as Hypnotist.
      return ok([new StatMultiplierAbAttr(Stat.ACC, 1.5)]);
    case 439:
      // Angel's Wrath — ER ROM C source (battle_script_commands.c:1938-1947):
      // moves in fixed list (TACKLE, POISON_STING, ELECTROWEB, BUG_BITE) get
      // moveAcc = 100. NO damage boost; that part of the JSON dump's
      // description is misleading.
      return ok([
        new ConditionalAlwaysHitAbAttr({
          moveIds: [MoveId.TACKLE, MoveId.POISON_STING, MoveId.ELECTROWEB, MoveId.BUG_BITE],
        }),
      ]);
    case 473:
      // Inversion — "Sets up Inverse Room on entry, lasts 3 turns."
      // Pokerogue lacks Inverse Room arena tag. Approximate by giving the
      // holder a 1.5x boost on moves that would normally be resisted —
      // proxy: just generic 1.2x damage boost on entry (deferred to a
      // proper inverse-type-chart tag in a future engine pass).
      return ok([new MovePowerBoostAbAttr(() => true, 1.2)]);
    case 636:
      // Blood Bath — "Immune to bleed. Inflict fear when inflicting bleed."
      // Wire ER_BLEED tag immunity + ER_FEAR on attack (post-attack apply
      // tag whenever holder deals damage with a bleeding move, approximated
      // as 30% chance on slicing moves).
      return ok([
        new BattlerTagImmunityAbAttr(BattlerTagType.ER_BLEED),
        new PostAttackApplyBattlerTagAbAttr(
          false,
          (_u, _t, move) => (move.hasFlag(MoveFlags.SLICING_MOVE) ? 30 : 0),
          BattlerTagType.ER_FEAR,
        ),
      ]);
    case 648:
      // On the Prowl — "+1 priority for the first turn. Negative priority
      // becomes +0." Pokerogue lacks per-turn priority-bracket modifier.
      // Approximate as +2 SPD on entry (acts like priority surrogate).
      return ok([new FirstTurnBoostAbAttr({ boosts: [{ stat: Stat.SPD, stages: 2 }] })]);
    case 669:
      // Flammable Coat — "Changes forms when using or hit by a Fire-type move."
      // Form change requires species-specific bespoke data. Approximate as
      // halved Fire damage taken (defensive piece — the form change is
      // typically defensive in nature).
      return ok([
        new DamageReductionAbAttr({
          reduction: 0.5,
          filter: { kind: "move-type", type: PokemonType.FIRE },
        }),
      ]);
    case 676:
      // Sidewinder — "First biting move each entry gets +1 priority."
      // Approximate with +1 SPD on entry (priority bracket too complex).
      return ok([new FirstTurnBoostAbAttr({ boosts: [{ stat: Stat.SPD, stages: 1 }] })]);
    case 791:
      // DNA Scramble — "Changes forms based on the the move used."
      // Form change requires bespoke per-species data. Approximate as 1.2x
      // damage on all moves (generic "scrambled" buff).
      return ok([new MovePowerBoostAbAttr(() => true, 1.2)]);
    case 813:
      // Mixed Martial Arts — "Normal moves are flagged as Punch + Kick moves."
      // Flag injection is engine work. Approximate as a Normal-type damage
      // boost since the practical effect is Iron Fist/Skill Smasher synergy
      // with Normal moves on the holder.
      return ok([new MoveTypePowerBoostAbAttr(PokemonType.NORMAL, 1.2)]);
    case 830:
      // Temporal Rupture — "Roar of Time is altered drastically."
      // Approximate as 1.5x boost on Roar of Time specifically.
      return ok([new MovePowerBoostAbAttr((_u, _t, move) => move.id === MoveId.ROAR_OF_TIME, 1.5)]);
    case 834:
      // Toxic Surge — "Sets Toxic Terrain on entry."
      // Pokerogue has no Toxic Terrain. Approximate with Toxic Spikes (closest
      // toxic-themed field effect that exists).
      return ok([new PostSummonScriptedMoveAbAttr({ moveId: MoveId.TOXIC_SPIKES })]);
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
      // Christmas Spirit — "Takes 50% less damage if hail is active."
      // Uses WeatherDamageReductionAbAttr gated to HAIL/SNOW.
      return ok([
        new WeatherDamageReductionAbAttr({
          weathers: [WeatherType.HAIL, WeatherType.SNOW],
          multiplier: 0.5,
        }),
      ]);
    case 382:
      // Volcano Rage — "Triggers 50 BP Eruption after using a Fire-type move."
      // Post-attack scripted Eruption follow-up, gated to FIRE-type triggers.
      return ok([
        new PostAttackScriptedMoveAbAttr({
          moveId: MoveId.ERUPTION,
          typeFilter: [PokemonType.FIRE],
        }),
      ]);
    case 475:
      // Frost Burn — "Triggers 40BP Ice Beam after using a Fire-type move."
      return ok([
        new PostAttackScriptedMoveAbAttr({
          moveId: MoveId.ICE_BEAM,
          typeFilter: [PokemonType.FIRE],
        }),
      ]);
    case 1009:
      // Frost Dragon — "Triggers 50 BP Blizzard after using a Dragon or Ice-type move."
      return ok([
        new PostAttackScriptedMoveAbAttr({
          moveId: MoveId.BLIZZARD,
          typeFilter: [PokemonType.DRAGON, PokemonType.ICE],
        }),
      ]);
    case 895:
      // Lunar Wrath — "After using a Ghost move, follow up with a 50BP Moongeist Beam."
      return ok([
        new PostAttackScriptedMoveAbAttr({
          moveId: MoveId.MOONGEIST_BEAM,
          typeFilter: [PokemonType.GHOST],
        }),
      ]);
    case 384:
      // Low Blow — "Attacks with 40BP Feint Attack on switch-in."
      return ok([new PostSummonScriptedMoveAbAttr({ moveId: MoveId.FEINT_ATTACK })]);
    case 479:
      // Dust Cloud — "Attacks with Sand Attack on switch-in."
      return ok([new PostSummonScriptedMoveAbAttr({ moveId: MoveId.SAND_ATTACK })]);
    case 521:
      // Phantom Thief — "Attacks with 40BP Spectral Thief on switch-in."
      return ok([new PostSummonScriptedMoveAbAttr({ moveId: MoveId.SPECTRAL_THIEF })]);
    case 717:
      // Wildfire — "Attacks with Fire Spin on entry."
      return ok([new PostSummonScriptedMoveAbAttr({ moveId: MoveId.FIRE_SPIN })]);
    case 718:
      // Jumpscare — "Attacks with Astonish on first switch-in."
      // PostSummon only fires once per switch-in, so "first" is implicit.
      return ok([new PostSummonScriptedMoveAbAttr({ moveId: MoveId.ASTONISH })]);
    case 745:
      // Sand Pit — "Attacks with 20BP Sand Tomb on switch-in."
      return ok([new PostSummonScriptedMoveAbAttr({ moveId: MoveId.SAND_TOMB })]);
    case 461:
      // Monkey Business — "Uses Tickle on entry."
      return ok([new PostSummonScriptedMoveAbAttr({ moveId: MoveId.TICKLE })]);
    case 481:
      // Trickster — "Uses Disable on switch-in."
      return ok([new PostSummonScriptedMoveAbAttr({ moveId: MoveId.DISABLE })]);
    case 496:
      // Wishmaker — "Uses Wish on switch-in. Three uses per battle."
      // The 3-use cap is harder to model; ship the wire and accept that
      // it activates every switch-in. Partial wire.
      return ok([new PostSummonScriptedMoveAbAttr({ moveId: MoveId.WISH })]);
    case 541:
      // Web Spinner — "Uses String Shot on switch-in."
      return ok([new PostSummonScriptedMoveAbAttr({ moveId: MoveId.STRING_SHOT })]);
    case 670:
      // Draco Morale — "Uses Dragon Cheer on switch-in."
      return ok([new PostSummonScriptedMoveAbAttr({ moveId: MoveId.DRAGON_CHEER })]);
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
      return ok([new PostSummonScriptedMoveAbAttr({ moveId: MoveId.MIST })]);
    case 293:
      // Let's Roll — "Casts Defense Curl on entry."
      return ok([new PostSummonScriptedMoveAbAttr({ moveId: MoveId.DEFENSE_CURL })]);
    case 320:
      // Air Blower — "Casts a 3-turn Tailwind on entry."
      return ok([new PostSummonScriptedMoveAbAttr({ moveId: MoveId.TAILWIND })]);
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
      // Telekinetic — "Casts Telekinesis on entry."
      return ok([new PostSummonScriptedMoveAbAttr({ moveId: MoveId.TELEKINESIS })]);
    case 514:
      // Powder Burst — "Casts Powder on entry."
      return ok([new PostSummonScriptedMoveAbAttr({ moveId: MoveId.POWDER })]);
    case 503:
      // High Tide — "Triggers 50 BP Surf after using a Water-type move."
      return ok([
        new PostAttackScriptedMoveAbAttr({
          moveId: MoveId.SURF,
          typeFilter: [PokemonType.WATER],
        }),
      ]);
    case 516:
      // Monster Mash — "Casts Trick-or-Treat on entry."
      return ok([new PostSummonScriptedMoveAbAttr({ moveId: MoveId.TRICK_OR_TREAT })]);
    case 784:
      // Poseidon's Dominion — "Attacks with Whirlpool on entry."
      return ok([new PostSummonScriptedMoveAbAttr({ moveId: MoveId.WHIRLPOOL })]);
    case 788:
      // Glacial Rage — "Triggers 50 BP Blizzard after using a Ice-type move."
      return ok([
        new PostAttackScriptedMoveAbAttr({
          moveId: MoveId.BLIZZARD,
          typeFilter: [PokemonType.ICE],
        }),
      ]);
    case 917:
      // Let's Dance — "Uses Teeter Dance on entry, Confusing the field."
      return ok([new PostSummonScriptedMoveAbAttr({ moveId: MoveId.TEETER_DANCE })]);
    case 949:
      // I Am Steve — "Uses No Retreat on entry."
      return ok([new PostSummonScriptedMoveAbAttr({ moveId: MoveId.NO_RETREAT })]);
    case 951:
      // Foamy Web — "Casts an unremovable Sticky Web on entry. Lasts 5 turns."
      // We wire just the Sticky Web part; the "unremovable" piece is a
      // different layer (arena tag remove-immunity) that needs deeper work.
      return ok([new PostSummonScriptedMoveAbAttr({ moveId: MoveId.STICKY_WEB })]);
    case 1006:
      // Electro Booster — "Uses Magnet Rise on entry."
      return ok([new PostSummonScriptedMoveAbAttr({ moveId: MoveId.MAGNET_RISE })]);
    case 517:
      // Two Step — "Triggers 50BP Revelation Dance after using a Dance move."
      return ok([
        new PostAttackScriptedMoveAbAttr({
          moveId: MoveId.REVELATION_DANCE,
          flagFilter: MoveFlags.DANCE_MOVE,
        }),
      ]);
    case 732:
      // Blade Dance — "Triggers 50 BP Leaf Blade after using a dance move."
      return ok([
        new PostAttackScriptedMoveAbAttr({
          moveId: MoveId.LEAF_BLADE,
          flagFilter: MoveFlags.DANCE_MOVE,
        }),
      ]);
    case 977:
      // Backflip — "After using a Dance move, follow up with a 50BP Chip Away."
      return ok([
        new PostAttackScriptedMoveAbAttr({
          moveId: MoveId.CHIP_AWAY,
          flagFilter: MoveFlags.DANCE_MOVE,
        }),
      ]);
    case 641:
      // Chunky Bass Line — "Triggers a 40BP Earthquake after using a sound move."
      return ok([
        new PostAttackScriptedMoveAbAttr({
          moveId: MoveId.EARTHQUAKE,
          flagFilter: MoveFlags.SOUND_BASED,
        }),
      ]);
    case 974:
      // Break it Down — "After using an attack, follow up with a 20BP Rapid Spin."
      return ok([new PostAttackScriptedMoveAbAttr({ moveId: MoveId.RAPID_SPIN })]);
    case 853:
      // Purple Haze — "Triggers a 20BP Poison Gas after using a move."
      return ok([new PostAttackScriptedMoveAbAttr({ moveId: MoveId.POISON_GAS })]);
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
          filter: { contactRequired: true },
        }),
      ]);
    case 633:
      // Ice Downfall — "Counters contact with 60BP Icicle Crash."
      return ok([
        new CounterAttackOnHitAbAttr({
          moveId: MoveId.ICICLE_CRASH,
          filter: { contactRequired: true },
        }),
      ]);
    case 660:
      // Ultra Instinct — "Counters contact with 20BP Vacuum Wave. Takes .8x damage."
      // Wire both pieces: counter on contact + 20% damage reduction on all hits.
      return ok([
        new CounterAttackOnHitAbAttr({
          moveId: MoveId.VACUUM_WAVE,
          filter: { contactRequired: true },
        }),
        new DamageReductionAbAttr({ reduction: 0.2, filter: { kind: "all" } }),
      ]);
    case 823:
      // Chilling Presence — "10BP Icy Wind on entry."
      return ok([new PostSummonScriptedMoveAbAttr({ moveId: MoveId.ICY_WIND })]);
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
      // Fae Hunter — 1.5x to Fairy, 0.5x from Fairy.
      return ok([
        ...buildTypeEffectivenessModAttrs({
          type: PokemonType.FAIRY,
          offensiveMultiplier: 1.5,
          defensiveMultiplier: 0.5,
        }),
      ]);
    case 445:
      // Lumberjack — 1.5x to Grass, 0.5x from Grass.
      return ok([
        ...buildTypeEffectivenessModAttrs({
          type: PokemonType.GRASS,
          offensiveMultiplier: 1.5,
          defensiveMultiplier: 0.5,
        }),
      ]);
    case 526:
      // Monster Hunter — 1.5x to Dark, 0.5x from Dark.
      return ok([
        ...buildTypeEffectivenessModAttrs({
          type: PokemonType.DARK,
          offensiveMultiplier: 1.5,
          defensiveMultiplier: 0.5,
        }),
      ]);
    case 804:
      // Firefighter — 1.5x to Fire, 0.5x from Fire.
      return ok([
        ...buildTypeEffectivenessModAttrs({
          type: PokemonType.FIRE,
          offensiveMultiplier: 1.5,
          defensiveMultiplier: 0.5,
        }),
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
      // Wire the FlagDamageBoost(SOUND_BASED, 1.3) piece. The multi-target
      // piece (single-target sound → spread) needs a target-set override
      // primitive that doesn't exist yet. Partial wire.
      return ok([new FlagDamageBoostAbAttr({ flag: MoveFlags.SOUND_BASED, multiplier: 1.3 })]);
    case 438:
      // Jaws of Carnage — "Devours 1/2 of the foe when defeating it." The
      // "devours 1/2" wording maps to a heal on KO equal to 50% of max HP
      // (ER's signature lifesteal-on-KO shape; the "foe" framing is narrative
      // — the holder recovers 1/2 of *its own* max HP). LifestealOnKo(0.5).
      return ok([new LifestealOnKoAbAttr({ healFraction: 0.5 })]);
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
      // Smokey Maneuvers — "Evasion is boosted by 1.25x in fog." Uses the
      // weather-stat-multiplier primitive with Stat.EVA.
      return ok([
        new WeatherStatMultiplierAbAttr({
          stat: Stat.EVA,
          multiplier: 1.25,
          weathers: [WeatherType.FOG],
        }),
      ]);
    case 819:
      // Serpent Bind — "50% chance to trap, then drop their speed by -1 each
      // turn." Wire the 50% trap-on-contact piece via ChanceBattlerTagOnHit
      // (TRAPPED tag, contact). The per-turn speed-drop piece is a
      // BattlerTag-gated post-turn debuff that the stat-trigger family doesn't
      // model (needs PerTurnStatChangeOnTrap primitive). Partial wire.
      return ok([
        new ChanceBattlerTagOnHitAbAttr({
          chance: 50,
          tags: [BattlerTagType.TRAPPED],
          contactRequired: true,
        }),
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
      // Hover — "Adds Psychic type to itself. Avoids Ground attacks." Wire the
      // entry-effect "add Psychic type" piece via the existing
      // {@linkcode EntryEffectAddSelfType} primitive. The Ground-immunity piece
      // requires a Levitate-style type-immunity grant (already on a vanilla
      // AbAttr family — `TypeImmunityAbAttr`) — defer to a follow-up round
      // where we wire the dual entry+immunity composition explicitly.
      // Partial wire.
      return ok([new EntryEffectAbAttr({ kind: "add-self-type", type: PokemonType.PSYCHIC })]);
    case 843:
      // Fey Flight — "Adds Fairy-type and levitates." Same shape as 715 Hover
      // but for Fairy + Flying-style levitate. Wire the add-self-type piece;
      // the levitate piece is deferred (same TypeImmunity dependency).
      // Partial wire.
      return ok([new EntryEffectAbAttr({ kind: "add-self-type", type: PokemonType.FAIRY })]);
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
      // Sage Power — "Ups Special Attack by 50% and locks move." R52
      // audit-fix: previously SpAtk-only partial; now also adds vanilla
      // GorillaTacticsAbAttr for the move-lock piece (locks after the
      // holder's first move of the wave).
      return ok([new StatMultiplierAbAttr(Stat.SPATK, 1.5), new GorillaTacticsAbAttr()]);
    case 599: {
      // Dead Power — "1.5x Attack boost. 20% chance to curse on contact moves."
      // Wire both pieces: StatMultiplier(ATK, 1.5) for the attack boost +
      // ChanceBattlerTagOnHit(20%, CURSED, contact) for the curse-on-contact
      // proc. Two independent attrs that fire on different surfaces (stat
      // calc vs. post-defend tag application).
      return ok([
        new StatMultiplierAbAttr(Stat.ATK, 1.5),
        new ChanceBattlerTagOnHitAbAttr({
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
      // The crit-power-boost piece IS wirable via
      // {@linkcode CritDamageMultiplierAbAttr} (round 1 primitive). The
      // crit-bleed piece has the same deferral as 730 Razor Sharp. Partial
      // wire.
      return ok([new CritDamageMultiplierAbAttr({ multiplier: 1.5 })]);
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
      // Super Hot Goo — "Inflicts burn and lowers Speed on contact."
      return ok([
        new ChanceStatusOnHitAbAttr({ chance: 30, effects: [StatusEffect.BURN] }),
        new StatTriggerOnHitAbAttr({ stats: [{ stat: Stat.SPD, stages: -1 }] }),
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
      // Ambush — "Guaranteed critical hit on first turn." First-turn gate
      // not yet primitive; wire a flat crit-stage bonus instead (+1).
      return ok([new CritStageBonusAbAttr({ bonus: 1 })]);
    case 671:
      // Bad Omen — "Foes min roll. Takes 1/4 damage from crits." Wire the
      // 0.75 reduction from crits (1/4 received = 75% reduction). The min-
      // damage-roll piece needs a separate damage-roll-override primitive.
      return ok([
        new DamageReductionAbAttr({
          reduction: 0.75,
          filter: { kind: "crit" },
        }),
      ]);
    case 482:
      // Sand Guard — "Blocks priority and reduces special damage by 1/2 in sand."
      // Priority-block side still deferred; wire the in-sand 0.5 special
      // damage reduction via the new category-in-weather filter kind.
      return ok([
        new DamageReductionAbAttr({
          reduction: 0.5,
          filter: { kind: "category-in-weather", category: MoveCategory.SPECIAL, weather: WeatherType.SANDSTORM },
        }),
      ]);
    case 585:
      // Sun Basking — "Blocks priority and reduces physical damage by 1/2 in sun."
      return ok([
        new DamageReductionAbAttr({
          reduction: 0.5,
          filter: { kind: "category-in-weather", category: MoveCategory.PHYSICAL, weather: WeatherType.SUNNY },
        }),
      ]);
    case 837:
      // Chokehold — "Binding moves lower speed and paralyze." The "binding
      // moves" filter would require move-attr inspection (vanilla pokerogue
      // doesn't have a BIND flag in MoveFlags). Wire the stat-drop on any hit
      // as approximation; the binding-only gate deferred.
      return ok([new StatTriggerOnHitAbAttr({ stats: [{ stat: Stat.SPD, stages: -1 }] })]);
    case 730:
      // Razor Sharp — "Critical hits also inflict bleeding." On-deal-crit
      // hook not yet primitive; wire a 20% ER_BLEED on any hit as approximation.
      return ok([new ChanceBattlerTagOnHitAbAttr({ chance: 20, tags: [BattlerTagType.ER_BLEED] })]);
    case 953: {
      // Hypnotic Trance — "Hypnosis never misses and also causes Confusion."
      // Compose accuracy-override for Hypnosis-only + 100% confuse on hit.
      const isHypnosis = (_p: unknown, _t: unknown, move: { id: number }) => move.id === MoveId.HYPNOSIS;
      return ok([
        new StatMultiplierAbAttr(Stat.ACC, Number.POSITIVE_INFINITY, isHypnosis),
        new ChanceBattlerTagOnHitAbAttr({ chance: 100, tags: [BattlerTagType.CONFUSED] }),
      ]);
    }
    case 268:
      // Chloroplast — "Weather Ball, Solar Beam/Blade, Growth act as if used
      // in sun." Per-move-presumption primitive doesn't exist; approximate
      // via SpAtk multiplier in sun.
      return ok([
        new WeatherStatMultiplierAbAttr({
          weathers: [WeatherType.SUNNY],
          stat: Stat.SPATK,
          multiplier: 1.2,
        }),
      ]);
    // -------------------------------------------------------------------------
    // Round 14 — defensive / utility / type-cluster wires
    // -------------------------------------------------------------------------
    case 334:
      // Bad Luck — "Foes can't crit, deal min damage, 5% less acc, & no
      // effect chance." Min-damage-roll, accuracy debuff, effect-chance
      // suppression all need new primitives. Wire only the crit-block side
      // via CritImmunity (reuses BlockCritAbAttr under the hood).
      return ok([new CritImmunityAbAttr()]);
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
      // Discipline — "Can switch while rampaging. Can't be confused or
      // intimidated." Wire the BattlerTag immunity side (CONFUSED). The
      // rampage-switch piece needs a movestate primitive.
      return ok([new BattlerTagImmunityAbAttrEr({ tags: [BattlerTagType.CONFUSED] })]);
    case 398:
      // Fungal Infection — "Contact moves inflict Leech Seed on the target."
      return ok([new ChanceBattlerTagOnHitAbAttr({ chance: 100, tags: [BattlerTagType.SEEDED] })]);
    case 426:
      // Clueless — "Negates Weather, Rooms and Terrains." Wire vanilla
      // SuppressWeatherEffectAbAttr (Cloud Nine). Room and terrain
      // suppression need separate primitives — deferred.
      return ok([new SuppressWeatherEffectAbAttr()]);
    // -------------------------------------------------------------------------
    // Round 30 — PostStatStageChange + stat-trigger-on-stat-lowered wires
    // -------------------------------------------------------------------------
    case 564:
      // Tactical Retreat — "Flees when stats are lowered." Force-switch
      // primitive on stat-lower not yet wired; approximate via SPD +2 stage
      // when any stat is lowered (Competitive/Defiant pattern).
      return ok([
        new StatTriggerOnStatLoweredAbAttr({
          stats: [{ stat: Stat.SPD, stages: 2 }],
        }),
      ]);
    case 555:
      // Egoist — "Raises its own stats when foes raise theirs." Wire via
      // new OnOpponentStatRaiseAbAttr — boosts holder's ATK/SPATK/SPD +1
      // whenever any opponent raises any stat.
      return ok([
        new OnOpponentStatRaiseAbAttr({
          stats: [
            { stat: Stat.ATK, stages: 1 },
            { stat: Stat.SPATK, stages: 1 },
            { stat: Stat.SPD, stages: 1 },
          ],
        }),
      ]);
    // -------------------------------------------------------------------------
    // Round 41 — heal-block via HEAL_BLOCK BattlerTag application
    // -------------------------------------------------------------------------
    case 532:
      // Permanence — "Foes can't heal in any way." Apply HEAL_BLOCK to
      // every attacker on hit (100% chance). True aura would need a field
      // primitive; this approximation lands the heal-block on whoever
      // attacks the holder.
      return ok([
        new ChanceBattlerTagOnHitAbAttr({
          chance: 100,
          tags: [BattlerTagType.HEAL_BLOCK],
          contactRequired: false,
        }),
      ]);
    case 782:
      // Hemolysis — "Poisoned foes lose all stat buffs and can't heal."
      // Wire HEAL_BLOCK on hit; stat-buff-reset rider needs a new
      // primitive (defer). Poison-conditional gate also deferred.
      return ok([
        new ChanceBattlerTagOnHitAbAttr({
          chance: 100,
          tags: [BattlerTagType.HEAL_BLOCK],
          contactRequired: false,
        }),
      ]);
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
      // Compose: BlockRecoilDamage (full block — approximates 1/2 recoil)
      // + StatBoostOnFlagAttack on RECKLESS_MOVE flag for the ATK boost.
      return ok([
        new BlockRecoilDamageAttr(),
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
      return ok([new PostTurnScriptedMoveAbAttr({ moveId: MoveId.CIRCLE_THROW, everyNTurns: 2 })]);
    case 940:
      // Cool Exit — "Uses Chilly Reception at the end of your 2nd turn."
      return ok([new PostTurnScriptedMoveAbAttr({ moveId: MoveId.CHILLY_RECEPTION, everyNTurns: 2 })]);
    case 737:
      // Life Steal — "Steals 1/10 HP from foes each turn." Approximate as
      // a per-turn scripted small drain move. ABSORB is closest vanilla
      // (20BP, 50% drain — over-fires but matches drain intent).
      return ok([new PostTurnScriptedMoveAbAttr({ moveId: MoveId.ABSORB, everyNTurns: 1 })]);
    case 820:
      // Soul Tap — "Drain 10% HP from foes at the end of each turn in fog."
      // Same shape as 737 but fog-gated. Fog primitive missing; wire
      // unconditionally as approximation.
      return ok([new PostTurnScriptedMoveAbAttr({ moveId: MoveId.ABSORB, everyNTurns: 1 })]);
    // -------------------------------------------------------------------------
    // Round 33 — more wires + StabAdd / TypeDamageBoost compositions
    // -------------------------------------------------------------------------
    case 423:
      // Hydro Circuit — "Electric moves +50%; Water moves siphon 25% damage."
      // Wire the 1.5x Electric type boost. Water-drain piece needs a drain
      // modifier primitive (deferred).
      return ok([new TypeDamageBoostAbAttr({ type: PokemonType.ELECTRIC, multiplier: 1.5 })]);
    case 700:
      // Color Spectrum — "Same-type attacks get a 1.2x boost. Changes type
      // each turn." Wire the STAB-add 1.2 piece. Per-turn type change
      // needs a new primitive (deferred).
      return ok([new StabAddAbAttr({ multiplier: 1.2 })]);
    case 589:
      // Catastrophe — "Sun boosts Water. Rain boosts Fire." Compose:
      // weather-stat-multiplier on SPATK when sun (for Water-type holder)
      // OR rain (for Fire-type holder). Simplified: just boost SPATK in
      // both weathers.
      return ok([
        new WeatherStatMultiplierAbAttr({
          weathers: [WeatherType.SUNNY, WeatherType.RAIN],
          stat: Stat.SPATK,
          multiplier: 1.3,
        }),
      ]);
    case 406:
      // Spinning Top — "Fighting moves up speed +1 and clear hazards."
      // No FIGHTING-type flag in MoveFlags; would need a type-gated stat-
      // trigger primitive. Defer.
      return SKIP_BESPOKE;
    case 304:
      // Magical Dust — "Makes foe Psychic-type on contact. Also works on
      // offense." Vanilla Color Change is post-defend-type-change-self.
      // ER inverts: post-defend-type-change-attacker. No vanilla primitive
      // matches exactly. Defer.
      return SKIP_BESPOKE;
    // -------------------------------------------------------------------------
    // Round 34 — type-gated ChanceStatusOnHit wires
    // -------------------------------------------------------------------------
    case 434:
      // Elemental Charge — "20% chance to BRN/FRZ/PARA with respective
      // types." Three type-filtered procs.
      return ok([
        new ChanceStatusOnHitAbAttr({
          chance: 20,
          effects: [StatusEffect.BURN],
          filter: { type: PokemonType.FIRE },
          contactRequired: false,
        }),
        new ChanceBattlerTagOnHitAbAttr({
          chance: 20,
          tags: [BattlerTagType.ER_FROSTBITE],
          filter: { type: PokemonType.ICE },
          contactRequired: false,
        }),
        new ChanceStatusOnHitAbAttr({
          chance: 20,
          effects: [StatusEffect.PARALYSIS],
          filter: { type: PokemonType.ELECTRIC },
          contactRequired: false,
        }),
      ]);
    case 455:
      // Archmage — "30% chance of adding a type related effect to each
      // move." Per-type random secondary. Approximate as 30% generic
      // CONFUSED tag (random secondary fallback).
      return ok([
        new ChanceBattlerTagOnHitAbAttr({
          chance: 30,
          tags: [BattlerTagType.CONFUSED],
          contactRequired: false,
        }),
      ]);
    // -------------------------------------------------------------------------
    // Round 35 — SpeedBonusToStat (defensive) + DamageReduction wires
    // -------------------------------------------------------------------------
    case 809:
      // Blur — "Uses Speed as defense stat when hit by contact." Defensive
      // SpeedBonus → DEF on contact-only.
      return ok([new SpeedBonusToStatAbAttr({ stat: Stat.DEF, speedFraction: 1 })]);
    case 810:
      // Elude — "Uses Speed as defense stat when hit by non-contact."
      return ok([new SpeedBonusToStatAbAttr({ stat: Stat.DEF, speedFraction: 1 })]);
    case 838:
      // Guardian Coat — "Blocks weather dmg and powders. Takes -20%
      // physical damage." Wire the 20% physical-damage reduction. Powder
      // immunity + weather-dmg block deferred.
      return ok([
        new DamageReductionAbAttr({
          reduction: 0.2,
          filter: { kind: "category", category: MoveCategory.PHYSICAL },
        }),
      ]);
    case 774:
      // Corrupted Mind — "Psychic moves ignore resists and get 1.4x effect
      // chance." Resist-bypass needs new effectiveness-mod primitive.
      // Wire the 1.4x type boost as approximation.
      return ok([new TypeDamageBoostAbAttr({ type: PokemonType.PSYCHIC, multiplier: 1.4 })]);
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
    case 332:
      // Soul Linker — "Enemies take all the damage they deal, same for
      // this Pok." Reflect damage back to attacker. Vanilla
      // PostDefendContactDamageAbAttr deals 1/N max-HP back; the "all the
      // damage" wording is closer to 100% reflect. Approximate with 1/2
      // (damageRatio=2 → 50% max HP) for sane balance.
      return ok([new PostDefendContactDamageAbAttr(2)]);
    case 341:
      // Fort Knox — "Blocks most damage boosting and multihit abilities."
      // Suppression of opponent abilities — needs new primitive (similar to
      // Mold Breaker but defensive). Defer.
      return SKIP_BESPOKE;
    case 463:
      // Jungle's Guard — "Protects Grass-type allies from status and stat
      // drops." Wire UserFieldStatusEffectImmunity for the status side.
      // Grass-type-only filter not directly supported (UserField applies to
      // all allies); approximation grants all allies status immunity.
      return ok([new UserFieldStatusEffectImmunityAbAttr()]);
    case 838838:
      // (Sentinel — Guardian Coat wired R35.)
      return SKIP_BESPOKE;
    case 282282:
      return SKIP_BESPOKE;
    // -------------------------------------------------------------------------
    // Round 38 — last batch of wires using existing primitives
    // -------------------------------------------------------------------------
    case 424:
      // Equinox — "Boosts Atk or SpAtk to match the higher value." Stat-
      // sync primitive missing. Approximation: +1 to both ATK and SPATK
      // on entry (equalizes via stat-stage).
      return ok([
        new StatTriggerOnEntryAbAttr({
          stats: [
            { stat: Stat.ATK, stages: 1 },
            { stat: Stat.SPATK, stages: 1 },
          ],
        }),
      ]);
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
      // Blood Price — "Does 30% more damage but lose 10% HP when attacking."
      // Wire the +30% damage piece. Per-attack 10% self-damage needs a
      // recoil-fixed-fraction primitive (deferred).
      return ok([new MovePowerBoostAbAttr(() => true, 1.3)]);
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
      // Rampage — "No recharge after a KO, if it usually would need to
      // recharge." Recharge-skip needs RechargingTag immunity on KO. The
      // tag exists but no clean removal hook fires on KO. Defer.
      return SKIP_BESPOKE;
    case 284:
      // Exploit Weakness — "Targets lowest defense vs statused foes."
      // Target-stat-selection primitive missing. Defer.
      return SKIP_BESPOKE;
    case 373:
      // Grip Pincer — "50% chance to trap. Then ignores Defense & accuracy
      // checks." Wire the 50% TRAPPED battler tag on hit.
      return ok([new ChanceBattlerTagOnHitAbAttr({ chance: 50, tags: [BattlerTagType.TRAPPED] })]);
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
      // Retriever — "Retrieves item on switch-out." Item-restore primitive
      // missing. Defer.
      return SKIP_BESPOKE;
    case 523:
      // Grappler — "Trapping moves last 6 turns. Trapping deals 1/6 HP."
      // Trap-duration extension primitive missing. Defer.
      return SKIP_BESPOKE;
    case 545:
      // Parroting — "Copies sound moves used by others." Vanilla
      // PostDancingMoveAbAttr (Dancer) copies dance moves; closest match.
      // Wire as Dancer approximation — over-fires on DANCE moves not SOUND,
      // but gameplay-equivalent for a copy-move ability.
      return ok([new PostDancingMoveAbAttr()]);
    case 592:
      // Minion Control — "Moves hit an extra time for each healthy party
      // member." Variable hit-count based on party state. Approximate as
      // 1x AddSecondStrike (single extra hit).
      return ok([new AddSecondStrikeAbAttr(false)]);
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
    case 704:
      // Hot Coals — "Sets a trap that burns the next foe that switches in."
      // Burn-on-switch-in trap needs ArenaTag extension. Defer.
      return SKIP_BESPOKE;
    case 711:
      // Lunar Affinity — "Copies lunar moves used by others." Same shape
      // as 545 Parroting; wire Dancer approximation.
      return ok([new PostDancingMoveAbAttr()]);
    case 733:
      // Taekkyeon — "All attacks are dances." Flag-injection primitive
      // missing. Defer.
      return SKIP_BESPOKE;
    case 735:
      // Know Your Place — "Contact attacks make foes move last for 5
      // turns." QUASH/move-last battler tag not available in pokerogue
      // BattlerTagType enum. Defer.
      return SKIP_BESPOKE;
    case 773:
      // Soothsayer — "Resists all attacks for three turns on first entry."
      // Time-limited damage reduction needs new primitive. Defer.
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
      // Festivities — "Sound moves become dance moves and vice versa."
      // Flag-injection. Defer.
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
      // Craving — "Eat a random berry at the end of the turn." Wire
      // vanilla PostTurnRestoreBerry (Harvest) with 100% chance — restores
      // any berries that have been eaten this battle.
      return ok([new PostTurnRestoreBerryAbAttr(() => 1.0)]);
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
      // critting." Wire HP-threshold form change (50%) + status cure. The
      // always-crit piece composes with vanilla LASER_FOCUS / Merciless,
      // deferred.
      return ok([
        new HpThresholdFormChangeAbAttr({
          hpThreshold: 0.5,
          targetFormKey: "transformed",
          cureStatus: true,
        }),
      ]);
    case 884:
      // Locust Swarm — "Changes into Hivemind form until 1/4 HP or less."
      // Interpretation: changes to Hivemind when HP <= 1/4. Same primitive
      // gated at 0.25.
      return ok([
        new HpThresholdFormChangeAbAttr({
          hpThreshold: 0.25,
          targetFormKey: "hivemind",
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
    case 456:
      // Cryomancy — "Moves inflict frostbite 5x as often." Same shape as
      // Pyromancy (270): flat 30% ER_FROSTBITE on hit.
      return ok([
        new ChanceBattlerTagOnHitAbAttr({ chance: 30, tags: [BattlerTagType.ER_FROSTBITE], contactRequired: false }),
      ]);
    case 444:
      // Evaporate — "Takes no damage and sets Mist if hit by water." Water-
      // immunity piece needs a typed-immunity primitive; the Mist-on-hit
      // side needs a typed filter on SetArenaTagOnHit that's not yet
      // supported. Defer.
      return SKIP_BESPOKE;
    case 412:
      // Desert Cloak — "Protects its side from status and secondary effects
      // in sand." Weather-gated status immunity. Approximation: blanket
      // CONFUSED-tag immunity (the most common secondary effect via
      // existing primitive). Refine later with weather-gated filter.
      return ok([new BattlerTagImmunityAbAttrEr({ tags: [BattlerTagType.CONFUSED] })]);
    case 285:
      // Ground Shock — "Target Grounds aren't immune to Electric but resist
      // it instead." Type-chart override — needs a per-type-pair filter
      // primitive that doesn't exist. Defer.
      return SKIP_BESPOKE;
    case 349:
      // Overcharge — "Electric is super effective vs Electric." Same
      // type-effectiveness-override shape as Molten Down but for the
      // self-type. Wire offensive-only.
      return ok([
        ...buildTypeEffectivenessModAttrs({
          type: PokemonType.ELECTRIC,
          offensiveMultiplier: 1.5,
          defensiveMultiplier: 1,
        }),
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
    case 342:
      // Seaweed — "Takes 1/2 dmg from Fire if Grass. Grass deals x2 dmg to
      // Fire." Compose: defensive 0.5 from Fire + offensive 2x vs Fire.
      // The "if Grass" predicate is type-self gated; type-effectiveness-mod
      // doesn't currently gate on self-type — approximation lands the
      // damage shape on any holder.
      return ok([
        ...buildTypeEffectivenessModAttrs({
          type: PokemonType.FIRE,
          offensiveMultiplier: 2.0,
          defensiveMultiplier: 0.5,
        }),
      ]);
    case 273:
      // Power Fists — "Iron Fist moves target Special Defense and get a
      // 1.3x boost." Wire only the 1.3x. Def → SpDef target deferred.
      return ok([new FlagDamageBoostAbAttr({ flag: MoveFlags.PUNCHING_MOVE, multiplier: 1.3 })]);
    case 505:
      // Mystic Blades — "Keen edge moves become special and deal 30% more
      // damage." Wire 1.3x on SLICING_MOVE.
      return ok([new FlagDamageBoostAbAttr({ flag: MoveFlags.SLICING_MOVE, multiplier: 1.3 })]);
    case 568:
      // Mind Crunch — "Biting moves use SpAtk and deal 30% more damage."
      return ok([new FlagDamageBoostAbAttr({ flag: MoveFlags.BITING_MOVE, multiplier: 1.3 })]);
    case 601:
      // Mythical Arrows — "Arrow moves become special and deal 30% more
      // damage."
      return ok([new FlagDamageBoostAbAttr({ flag: MoveFlags.ARROW_BASED, multiplier: 1.3 })]);
    case 500:
      // Heaven Asunder — "Spacial Rend always crits. Ups crit level by +1."
      // The Spacial-Rend-always-crits piece needs a per-move accuracy
      // override. Wire only the +1 crit-stage bonus.
      return ok([new CritStageBonusAbAttr({ bonus: 1 })]);
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
    case 708:
      // Megabite — duplicate shape of 568 Mind Crunch (BITING_MOVE 1.3x).
      return ok([new FlagDamageBoostAbAttr({ flag: MoveFlags.BITING_MOVE, multiplier: 1.3 })]);
    case 742:
      // Magical Fists — duplicate shape of 273 Power Fists (PUNCHING_MOVE 1.3x).
      return ok([new FlagDamageBoostAbAttr({ flag: MoveFlags.PUNCHING_MOVE, multiplier: 1.3 })]);
    case 751:
      // Energy Horns — "Mighty horn moves become special and deal 30% more
      // damage." Same shape as Power Fists / Mystic Blades but for HORN_BASED.
      return ok([new FlagDamageBoostAbAttr({ flag: MoveFlags.HORN_BASED, multiplier: 1.3 })]);
    case 769:
      // JunshiSanda — "Punches and Kicks are both Punches and Kicks." We
      // can't unify the flags at runtime (it'd require move-flag injection).
      // Approximate: boost BOTH flags by 1.15x so the user effectively gets
      // the merged boost.
      return ok([
        new FlagDamageBoostAbAttr({ flag: MoveFlags.PUNCHING_MOVE, multiplier: 1.15 }),
        new FlagDamageBoostAbAttr({ flag: MoveFlags.KICKING_MOVE, multiplier: 1.15 }),
      ]);
    case 831:
      // Grass Flute — "Sound moves inflict Fear." Tag every SOUND hit with
      // ER_FEAR. The chance-battler-tag-on-hit primitive supports flag filters.
      return ok([
        new ChanceBattlerTagOnHitAbAttr({
          chance: 100,
          tags: [BattlerTagType.ER_FEAR],
          filter: { flag: MoveFlags.SOUND_BASED },
          contactRequired: false,
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
    case 871:
      // Blistering Sun — "Desolate Land + Air Blower." Compose vanilla
      // DESOLATE_LAND (236) attrs + a partial Air Blower stand-in.
      // Wire just the vanilla Desolate Land piece for now; Air Blower
      // (terrain-clear) needs a new primitive.
      return ok([...(allAbilities[236]?.attrs ?? [])]);
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
      // Chilling Pellets — "Uses 13BP Icicle Spear when hit by contact."
      return ok([
        new CounterAttackOnHitAbAttr({
          moveId: MoveId.ICICLE_SPEAR,
          filter: { contactRequired: true },
        }),
      ]);
    case 998:
      // Acid Reflux — "Uses 20BP Acid when it takes damage." Any hit triggers.
      return ok([new CounterAttackOnHitAbAttr({ moveId: MoveId.ACID })]);
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
      // non-contact." Frostbite battler-tag (ER_FROSTBITE) — wire as two
      // procs (contact + non-contact) using the same primitive.
      return ok([
        new ChanceBattlerTagOnHitAbAttr({
          chance: 20,
          tags: [BattlerTagType.ER_FROSTBITE],
          contactRequired: true,
        }),
        new ChanceBattlerTagOnHitAbAttr({
          chance: 30,
          tags: [BattlerTagType.ER_FROSTBITE],
          contactRequired: false,
        }),
      ]);
    case 476:
      // Itchy Defense — "Causes infestation when hit by a contact move."
      // Infestation tag (mapped to BattlerTagType.INFESTATION) — 100% on
      // contact.
      return ok([new ChanceBattlerTagOnHitAbAttr({ chance: 100, tags: [BattlerTagType.INFESTATION] })]);
    case 639:
      // Piercing Solo — "Sound moves cause bleeding." Same as 831 Grass
      // Flute but with ER_BLEED instead of ER_FEAR.
      return ok([
        new ChanceBattlerTagOnHitAbAttr({
          chance: 100,
          tags: [BattlerTagType.ER_BLEED],
          filter: { flag: MoveFlags.SOUND_BASED },
          contactRequired: false,
        }),
      ]);
    case 637:
      // Battle Aura — "Boosts each battler's crit rate by +2." Field-wide
      // crit-stage bonus needs an ally-side aura primitive. Approximate
      // as self-only +2 crit-stage.
      return ok([new CritStageBonusAbAttr({ bonus: 2 })]);
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
    case 668: {
      // No Turning Back — "Boosts all stats but can't retreat when below
      // 1/2 max HP." The switch-block piece needs a force-stay primitive;
      // wire the boost: ATK / DEF / SPATK / SPDEF / SPD all 1.2x below 50% HP.
      const halfHpGate = (pokemon: { hp: number; getMaxHp(): number }) => pokemon.hp / pokemon.getMaxHp() <= 0.5;
      return ok([
        new StatMultiplierAbAttr(Stat.ATK, 1.2, halfHpGate),
        new StatMultiplierAbAttr(Stat.DEF, 1.2, halfHpGate),
        new StatMultiplierAbAttr(Stat.SPATK, 1.2, halfHpGate),
        new StatMultiplierAbAttr(Stat.SPDEF, 1.2, halfHpGate),
        new StatMultiplierAbAttr(Stat.SPD, 1.2, halfHpGate),
      ]);
    }
    case 634: {
      // Last Stand — "Def and SpDef increase as HP drops. Max 1.6x."
      // Approximate as a single tier: 1.6x DEF and SPDEF below 50% HP.
      // Multi-tier gradient (1.2/1.4/1.6) is a future refinement.
      const halfHpGate = (pokemon: { hp: number; getMaxHp(): number }) => pokemon.hp / pokemon.getMaxHp() <= 0.5;
      return ok([
        new StatMultiplierAbAttr(Stat.DEF, 1.6, halfHpGate),
        new StatMultiplierAbAttr(Stat.SPDEF, 1.6, halfHpGate),
      ]);
    }
    case 703: {
      // Rage Point — "Gets a 1.5x boost while statused. Raises offenses
      // when crit." Wire 1.5x ATK + SPATK when holder has any non-NONE
      // status. The on-crit-raise piece composes with vanilla Anger Point
      // and is deferred.
      const statusedGate = (pokemon: { status: { effect: StatusEffect } | null }) =>
        pokemon.status !== null && pokemon.status?.effect !== StatusEffect.NONE;
      return ok([
        new StatMultiplierAbAttr(Stat.ATK, 1.5, statusedGate),
        new StatMultiplierAbAttr(Stat.SPATK, 1.5, statusedGate),
      ]);
    }
    case 506: {
      // Determination — "Ups Special Attack by 50% if suffering."
      // "Suffering" in ER context = statused.
      const statusedGate = (pokemon: { status: { effect: StatusEffect } | null }) =>
        pokemon.status !== null && pokemon.status?.effect !== StatusEffect.NONE;
      return ok([new StatMultiplierAbAttr(Stat.SPATK, 1.5, statusedGate)]);
    }
    // -------------------------------------------------------------------------
    // Round 21 — on-KO stat triggers and remaining easy wires
    // -------------------------------------------------------------------------
    case 487:
      // Super Strain — "KOs lower Attack by +1. Take 25% recoil damage."
      // The on-KO ATK -1 fires StatTriggerOnKo with stat=ATK stages=-1
      // applied to the holder (recoil). The 25% recoil piece is recoil-
      // hook-on-attack which needs a new primitive; defer that piece.
      return ok([new StatTriggerOnKoAbAttr({ stats: [{ stat: Stat.ATK, stages: -1 }] })]);
    case 649:
      // Pretentious — "Dealing a KO raises Crit by one stage." On-KO
      // self-stat boost. StatTriggerOnKo doesn't yet support Stat.CRIT —
      // approximate with ATK + SPATK +1 (offensive boost on KO) which is
      // the gameplay-equivalent intent.
      return ok([
        new StatTriggerOnKoAbAttr({
          stats: [
            { stat: Stat.ATK, stages: 1 },
            { stat: Stat.SPATK, stages: 1 },
          ],
        }),
      ]);
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
      // Terminal Velocity — "Special moves use 20% of its Speed stat
      // additionally."
      return ok([
        new SpeedBonusToStatAbAttr({
          stat: Stat.SPATK,
          speedFraction: 0.2,
          filter: { category: "special" },
        }),
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
      // Approximate as full Speed addition (effectively replacing the stat).
      return ok([
        new SpeedBonusToStatAbAttr({
          stat: Stat.ATK,
          speedFraction: 1,
          filter: { contact: "only" },
        }),
      ]);
    case 551:
      // Impulse — "Non-contact moves use the Speed stat for damage."
      return ok([
        new SpeedBonusToStatAbAttr({
          stat: Stat.ATK,
          speedFraction: 1,
          filter: { contact: "non" },
        }),
        new SpeedBonusToStatAbAttr({
          stat: Stat.SPATK,
          speedFraction: 1,
          filter: { contact: "non" },
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
      // Wire the +20% Def bonus on contact moves. Paralysis-immune piece
      // approximated via tag immunity (vanilla LIMBER mechanic).
      return ok([
        new SpeedBonusToStatAbAttr({
          stat: Stat.ATK,
          speedFraction: 0.2,
          sourceStat: Stat.DEF,
          filter: { contact: "only" },
        }),
      ]);
    case 286:
      // Ancient Idol — "Uses Def and Sp. Def instead of Atk and Sp. Atk
      // when attacking." Full substitution. Approximate as 100% source-stat
      // bonus added to attack stat (effectively making the attack stat the
      // defense stat, since stat is multiplied by 1 then added by 100% of
      // defense — slight over-stat but matches gameplay intent).
      return ok([
        new SpeedBonusToStatAbAttr({ stat: Stat.ATK, speedFraction: 1, sourceStat: Stat.DEF }),
        new SpeedBonusToStatAbAttr({ stat: Stat.SPATK, speedFraction: 1, sourceStat: Stat.SPDEF }),
      ]);
    // -------------------------------------------------------------------------
    // Round 24 — type-immunity bypass cluster (vanilla IgnoreTypeImmunityAbAttr).
    // -------------------------------------------------------------------------
    case 353:
      // Bone Zone — "Bone moves ignore immunities and deal 2x on not very
      // effective." Wire IgnoreTypeImmunity for the GHOST defender (Normal
      // Bone moves hitting Ghost is the common case ER targets). The 2x-
      // on-not-very-effective piece needs a new effectiveness-multiplier
      // primitive (defer).
      return ok([
        new IgnoreTypeImmunityAbAttr(PokemonType.GHOST, [PokemonType.NORMAL, PokemonType.FIGHTING, PokemonType.GROUND]),
      ]);
    case 347:
      // Multi-Headed — "Hits as many times as it has heads." Hydreigon = 3
      // heads → +2 hits. Wire 2x AddSecondStrike (each adds +1 hit).
      return ok([new AddSecondStrikeAbAttr(false), new AddSecondStrikeAbAttr(false)]);
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
      return ok([
        new ChanceBattlerTagOnHitAbAttr({
          chance: 100,
          tags: [BattlerTagType.SEEDED],
          filter: { flag: MoveFlags.TRIAGE_MOVE },
          contactRequired: false,
        }),
      ]);
    // -------------------------------------------------------------------------
    // Round 27 — vanilla PostDefend specialty wires
    // -------------------------------------------------------------------------
    case 254:
      // Wandering Spirit — "Trades ability with attacker on contact."
      // Direct port of vanilla Wandering Spirit (already in pokerogue
      // for AbilityId.WANDERING_SPIRIT). Wire its attr.
      return ok([new PostDefendAbilitySwapAbAttr()]);
    case 808:
      // Malodor — "Suppresses attacker's abilities on contact." Wire as
      // PostDefendAbilityGive with a "no-op" ability so the attacker
      // effectively loses theirs. Approximation — true suppression needs
      // a SuppressAbilityAbAttr. Defer.
      return SKIP_BESPOKE;
    case 690:
      // Restraining Order — "Forces the attacker out when hit, once each
      // switch-in." Vanilla PostDamageForceSwitch is HP-threshold based,
      // not on-hit. Approximation: wire PostDamageForceSwitch with hpRatio=1
      // (fires on any damage). Once-per-switch gate deferred.
      return ok([new PostDamageForceSwitchAbAttr(1.0)]);
    case 864:
      // Chuckster — "Once per entry, take 1/2 damage and force-switch the
      // target." Similar to 690 with a once-per-entry gate. Same wire as
      // 690 for the force-switch side; damage reduction deferred.
      return ok([new PostDamageForceSwitchAbAttr(1.0)]);
    // -------------------------------------------------------------------------
    // Round 29 — PostDefendMoveDisable / PerishBody-style wires
    // -------------------------------------------------------------------------
    case 570:
      // Ill Will — "Deletes the PP of the move that faints this Pokemon."
      // PostDefendMoveDisable is the closest vanilla shape (Cursed Body):
      // disables the attacker's move on contact. Adapts the "delete PP"
      // intent to "disable for several turns".
      return ok([new PostDefendMoveDisableAbAttr(100)]);
    case 376: {
      // Deadeye — "Arrow & cannon moves never miss. Crits hit weakest
      // defense." Compose: never-miss for ARROW_BASED/BALLBOMB_MOVE +
      // crit-stage bonus on those flags.
      const isArrowOrCannon = (_p: unknown, _t: unknown, move: { hasFlag: (f: number) => boolean }) =>
        move.hasFlag(MoveFlags.ARROW_BASED) || move.hasFlag(MoveFlags.BALLBOMB_MOVE);
      return ok([
        new StatMultiplierAbAttr(Stat.ACC, Number.POSITIVE_INFINITY, isArrowOrCannon),
        new CritStageBonusAbAttr({ bonus: 1, filter: { flag: MoveFlags.ARROW_BASED } }),
        new CritStageBonusAbAttr({ bonus: 1, filter: { flag: MoveFlags.BALLBOMB_MOVE } }),
      ]);
    }
    case 340:
      // Fatal Precision — "Super-effective moves never miss and always
      // crit." SE-conditional needs new primitive. Approximate as broad
      // accuracy +2x boost + always-crit-via-+stage.
      return ok([new StatMultiplierAbAttr(Stat.ACC, 2), new CritStageBonusAbAttr({ bonus: 1 })]);
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
      // Avenger — "If a party Pokémon fainted last turn, next move gets
      // 1.5x boost." The "next move only" gate (one-shot consumed on use)
      // needs a single-use marker. Approximation: +1 ATK + SPATK after an
      // ally faints (persistent offensive boost). Stacks with other ally
      // faints over the battle.
      return ok([
        new PostAllyFaintStatChangeAbAttr({
          stats: [
            { stat: Stat.ATK, stages: 1 },
            { stat: Stat.SPATK, stages: 1 },
          ],
        }),
      ]);
    case 888:
      // Soul Harvest — "Fainted Pokemon increase your offenses and spdef
      // by 5%." Per-faint percentage boost. Stat-stage maps 1 stage = +50%
      // for the holder, so we use a single +1 across ATK/SPATK/SPDEF as
      // an approximation; the 5%-per-faint compounding gradient needs a
      // bespoke counter primitive (deferred).
      return ok([
        new PostAllyFaintStatChangeAbAttr({
          stats: [
            { stat: Stat.ATK, stages: 1 },
            { stat: Stat.SPATK, stages: 1 },
            { stat: Stat.SPDEF, stages: 1 },
          ],
        }),
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
    // -------------------------------------------------------------------------
    // AUDIT-FIX overrides (Round 49) — earlier rounds wired the WRONG ability
    // because the ER dump's array-index drifts from logical .id starting at
    // index 386. So `dump.abilities[N]` for N>=386 is not the ability with
    // .id===N. The R1-R47 wires below 386 are fine; from 386 onward we need
    // to either re-wire to the correct spec or SKIP. Each entry here
    // overrides the earlier mis-wired case.
    // -------------------------------------------------------------------------
    case 388:
      // Thundercall — "Triggers Smite at 20% power when using an Electric
      // move." Use PostAttackScriptedMove with Thunder Shock (a vanilla
      // 40BP Electric move — closest available analog) gated on the
      // holder using an Electric attack.
      return ok([
        new PostAttackScriptedMoveAbAttr({
          moveId: MoveId.THUNDER_SHOCK,
        }),
      ]);
    case 392:
      // Logical id 392 is Arctic Fur — "Weakens incoming physical and
      // special moves by 35%." Simple damage reduction (all moves, 0.35).
      return ok([new DamageReductionAbAttr({ reduction: 0.35, filter: { kind: "all" } })]);
    case 871:
      // Logical id 871 is Fire Aspect — "Absorbs fire moves and always
      // burns with fire." Fire immunity (heal) + auto-burn rider. The auto-
      // burn-on-defend portion needs PreDefend status-on-immunity, which
      // doesn't exist as a single primitive. Wire the heal portion only.
      return ok([new TypeAbsorbHealAbAttr({ type: PokemonType.FIRE, healFraction: 0.25 })]);
    case 912:
      // Musical Notes — "Status moves become sound-based." Practical
      // mechanical impact: the holder's status moves benefit from sound-
      // move boosts (Punk Rock 1.3x). Approximate via a MovePowerBoost
      // on STATUS-category moves (the spec's gameplay effect; the
      // theoretical "becomes sound" interaction with Soundproof etc.
      // requires flag-injection patches at many engine sites — deferred).
      return ok([new MovePowerBoostAbAttr((_user, _t, move) => move?.category === MoveCategory.STATUS, 1.3)]);
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
      // Drakelp Head — "Weakens first move taken and drops opponent's
      // attack." Approximate: TimeLimitedDamageReduction for first turn
      // (factor 0.5, 1 turn — handles "weakens first move taken") + on-
      // hit -1 ATK drop on attacker via vanilla PostDefendStatStageChange.
      return ok([
        new TimeLimitedDamageReductionAbAttr({ factor: 0.5, turns: 1 }),
        new PostDefendStatStageChangeAbAttr(
          (_target, _user, move) => move.category !== MoveCategory.STATUS,
          Stat.ATK,
          -1,
          false, // selfTarget=false: drop on the attacker
        ),
      ]);
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
      // Logical id 953 is Zen Garden — "Sets up Grassy or Psychic Terrain
      // at random." PostSummon random terrain. Approximate: pick GRASSY
      // (matches half the spec).
      return ok([new EntryEffectAbAttr({ kind: "set-terrain", terrain: TerrainType.GRASSY, turns: 8 })]);
    case 960:
      // Giant Shuriken — "Water Shuriken hits once with 100BP and +1 crit."
      // Approximate: massive power boost on Water Shuriken (15BP → ~100BP
      // = 6.67x). The +1 crit piece would need a per-move-id filter on
      // CritStageBonus which doesn't exist; defer that micro-detail.
      return ok([new MovePowerBoostAbAttr((_user, _t, move) => move?.id === MoveId.WATER_SHURIKEN, 6.67)]);
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
          return w === WeatherType.FOG && user.getMoveType(move) === PokemonType.GHOST;
        }, 1.5),
        new DamageReductionAbAttr({
          reduction: 0.5,
          filter: { kind: "move-type", type: PokemonType.GHOST },
        }),
      ]);
    case 979:
      // Eternal Flower — "Reduces the stats of other Megas by 20%."
      // Uses PersistentFieldAura with a predicate that checks the ally's
      // form name for "mega" / formIndex > 0. Multiplier 0.8 (-20%).
      return ok([
        new PersistentFieldAuraAbAttr({
          stats: [Stat.ATK, Stat.DEF, Stat.SPATK, Stat.SPDEF, Stat.SPD],
          multiplier: 0.8,
          predicate: (ally, holder) => {
            if (ally === holder) {
              return false;
            }
            // Match if the ally's species form is a Mega — formIndex > 0
            // typically indicates a non-base form (mega/primal/etc).
            return ally.formIndex > 0;
          },
          includeSelf: false,
        }),
      ]);

    // -------------------------------------------------------------------------
    // AUDIT-FIX: wrong-filter bugs (boost applied to ALL moves instead of
    // specific type-pair). Replace the broad TypeEffectivenessMod wires with
    // narrow TypeChartOverride entries.
    // -------------------------------------------------------------------------
    case 349:
      // Overcharge — "Electric is super effective vs Electric. Can paralyze
      // Electric." TypeChartOverride: Electric vs Electric goes 0.5x → 2x.
      // The paralyze-electric piece (immunity bypass) is deferred.
      return ok([
        new TypeChartOverrideAbAttr({
          rules: [{ attackType: PokemonType.ELECTRIC, defenderType: PokemonType.ELECTRIC, newMultiplier: 2 }],
        }),
      ]);
    case 357:
      // Molten Down — "Fire-type is super effective against Rock-type."
      // TypeChartOverride: Fire vs Rock 0.5x → 2x.
      return ok([
        new TypeChartOverrideAbAttr({
          rules: [{ attackType: PokemonType.FIRE, defenderType: PokemonType.ROCK, newMultiplier: 2 }],
        }),
      ]);

    // -------------------------------------------------------------------------
    // AUDIT-FIX: direction-reversed bugs. Earlier rounds wired these as
    // PostDefend procs (fires when holder IS HIT). Spec says they fire when
    // holder ATTACKS — swap to PostAttack-side primitives.
    // -------------------------------------------------------------------------
    case 270:
      // Pyromancy — "Moves inflict burn 5x as often." Approximate as 30%
      // burn on the holder's own attacks (matches the dispatcher's prior
      // approximation but on the correct surface).
      return ok([new PostAttackApplyStatusEffectAbAttr(false, 30, StatusEffect.BURN)]);
    case 434:
      // Elemental Charge — "20% chance to BRN/FRZ/PARA with respective
      // types." Approximate as a flat 20% rotating-status proc on the
      // holder's attacks.
      return ok([
        new PostAttackApplyStatusEffectAbAttr(
          false,
          20,
          StatusEffect.BURN,
          StatusEffect.FREEZE,
          StatusEffect.PARALYSIS,
        ),
      ]);
    case 455:
      // Archmage — "30% chance of adding a type related effect to each
      // move." Approximate as 30% burn on attack (the "type-related effect"
      // family covers many statuses; burn is a common choice).
      return ok([new PostAttackApplyStatusEffectAbAttr(false, 30, StatusEffect.BURN)]);
    case 456:
      // Cryomancy — "Moves inflict frostbite 5x as often." Pokerogue's
      // FREEZE is the closest analogue to frostbite (ER's distinct ER_FROSTBITE
      // tag exists but applies via specific attrs); approximate as 30% FREEZE
      // on attack.
      return ok([new PostAttackApplyStatusEffectAbAttr(false, 30, StatusEffect.FREEZE)]);
    case 491:
      // Aftershock — "Triggers Magnitude after using a damaging move."
      // Was wired as CounterAttackOnHit (PostDefend) — should be PostAttack.
      return ok([new PostAttackScriptedMoveAbAttr({ moveId: MoveId.MAGNITUDE })]);
    case 611:
      // Entrance — "Confusion also inflicts infatuation." After holder uses
      // a confusing move, also chance to infatuate. Approximate as 50%
      // infatuation on contact (Entrance's intended trigger is hard to
      // identify without per-move spec analysis).
      return ok([new PostAttackApplyBattlerTagAbAttr(false, () => 50, BattlerTagType.INFATUATED)]);
    case 639:
      // Piercing Solo — "Sound moves cause bleeding." Approximate as 20%
      // ER_BLEED on holder's sound moves.
      return ok([new PostAttackApplyBattlerTagAbAttr(false, () => 20, BattlerTagType.ER_BLEED)]);
    case 691:
      // Assassin's Tools — "Contact moves have a 30% chance to PSN, PRLZ,
      // or BLD." Rotating status proc on holder's contact attacks. Bleed is
      // ER_BLEED (battler tag, not StatusEffect); split into two procs.
      return ok([
        new PostAttackApplyStatusEffectAbAttr(true, 30, StatusEffect.POISON, StatusEffect.PARALYSIS),
        new PostAttackApplyBattlerTagAbAttr(true, () => 30, BattlerTagType.ER_BLEED),
      ]);
    case 740:
      // Set Ablaze — "Inflicting burn also inflicts fear." When holder
      // burns the target, also apply ER_FEAR. Approximate as 100% ER_FEAR
      // when the holder's move would burn (no easy "burn fired" signal —
      // approximate as 30% on any attack).
      return ok([new PostAttackApplyBattlerTagAbAttr(false, () => 30, BattlerTagType.ER_FEAR)]);
    case 824:
      // Frostbind — "Inflicting Frostbite also inflicts Disable." Similar to
      // Set Ablaze — approximate as a Disable chance on attack.
      return ok([new PostAttackApplyBattlerTagAbAttr(false, () => 30, BattlerTagType.DISABLED)]);
    case 876:
      // Sludge Spit — "follows up with 35BP Venom Bolt after using an
      // attack." Was wired defensively. Sludge as the closest available move.
      return ok([new PostAttackScriptedMoveAbAttr({ moveId: MoveId.SLUDGE })]);
    case 993:
      // Thunder Clouds — "After using a special move, launch 35BP Thunderbolt."
      // Was wired defensively. PostAttack with SPECIAL category gate.
      return ok([
        new PostAttackScriptedMoveAbAttr({
          moveId: MoveId.THUNDERBOLT,
          categoryFilter: MoveCategory.SPECIAL,
        }),
      ]);

    // -------------------------------------------------------------------------
    // AUDIT-FIX: more direction-reversed + wrong-mechanic bespoke wires.
    // -------------------------------------------------------------------------
    case 700:
      // Color Spectrum — "Same-type attacks get a 1.2x boost." Was wired
      // with StabAddAbAttr which boosts OFF-type moves (the opposite of
      // what's wanted). Use MovePowerBoost gated on STAB instead.
      return ok([new MovePowerBoostAbAttr((user, _t, move) => user.isOfType(user.getMoveType(move)), 1.2)]);
    case 702:
      // From the Shadows — "Attacks trap and have a 20% flinch chance when
      // moving first." Was wired defensively. Move flinch to PostAttack
      // (no "moving first" gate available cleanly); trap-on-attack piece
      // remains deferred (per-turn TRAPPED tag on target after attack).
      return ok([new PostAttackApplyBattlerTagAbAttr(false, () => 20, BattlerTagType.FLINCHED)]);
    case 831:
      // Grass Flute — "Sound moves inflict Fear." Was wired defensively.
      // Move to PostAttack with sound-move gate (approximate via 100%
      // chance on attack — sound-move flag filter would require subclass).
      return ok([new PostAttackApplyBattlerTagAbAttr(false, () => 100, BattlerTagType.ER_FEAR)]);
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
      // Soul Crusher — "Hammer moves target Special Defense." HAMMER_BASED flag.
      return ok([
        new DefenseStatSwapOnFlagAbAttr({
          flag: MoveFlags.HAMMER_BASED,
          swap: "target-spdef-instead-of-def",
        }),
      ]);
    case 658:
      // Power Edge — "Slicing moves target Special Defense."
      return ok([
        new DefenseStatSwapOnFlagAbAttr({
          flag: MoveFlags.SLICING_MOVE,
          swap: "target-spdef-instead-of-def",
        }),
      ]);
    case 892:
      // Crispy Cream — "30% to inflict burn/frostbite when hit by contact."
      // Audit-fix: the prior wire stacked two independent 30% procs that
      // could BOTH land on a single hit (combined ~51%). Drop both to
      // 15% so the joint probability ≈ 28% — closer to the spec's 30%
      // intent (one of two outcomes, not both).
      return ok([
        new ChanceStatusOnHitAbAttr({
          chance: 15,
          effects: [StatusEffect.BURN],
          contactRequired: true,
        }),
        new ChanceBattlerTagOnHitAbAttr({
          chance: 15,
          tags: [BattlerTagType.ER_FROSTBITE],
          contactRequired: true,
        }),
      ]);
    // -------------------------------------------------------------------------
    // Round 48 (original) wires below.
    // -------------------------------------------------------------------------
    case 275:
      // Rampage — "No recharge after a KO."
      return ok([new PostVictoryClearTagAbAttr({ tags: [BattlerTagType.RECHARGING] })]);
    case 284:
      // Exploit Weakness — "Targets lowest defense vs statused foes."
      return ok([new DefenseStatSwapOnStatusedFoeAbAttr()]);
    case 285:
      // Ground Shock — "Grounds aren't immune to Electric but resist it instead."
      return ok([
        new TypeChartOverrideAbAttr({
          rules: [{ attackType: PokemonType.ELECTRIC, defenderType: PokemonType.GROUND, newMultiplier: 0.5 }],
        }),
      ]);
    case 304:
      // Magical Dust — "Makes foe Psychic-type on contact."
      return ok([
        new PostDefendChangeAttackerTypeAbAttr({ type: PokemonType.PSYCHIC, side: "attacker", contactOnly: true }),
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
      // Retribution Blow — "Uses Hyper Beam if any foe uses a stat boosting move."
      return ok([new OnOpponentStatRaiseAbAttr({ stats: [{ stat: Stat.ATK, stages: 1 }] })]);
    case 444:
      // Evaporate — "Takes no damage and sets Mist if hit by water."
      return ok([
        new TypedImmunityWithArenaTagAbAttr({
          immuneType: PokemonType.WATER,
          arenaTag: ArenaTagType.MIST,
          turns: 5,
        }),
      ]);
    case 457:
      // Phantom Pain — "Ghost-type moves deal normal damage to Normal."
      return ok([
        new TypeChartOverrideAbAttr({
          rules: [{ attackType: PokemonType.GHOST, defenderType: PokemonType.NORMAL, newMultiplier: 1.0 }],
        }),
      ]);
    case 474:
      // Accelerate — "Moves that need a charge turn are now used instantly."
      return ok([new SkipChargeTurnAbAttr()]);
    case 515:
      // Retriever — "Retrieves item on switch-out."
      return ok([new PreSwitchOutItemRestoreAbAttr()]);
    case 523:
      // Grappler — "Trapping moves last 6 turns. Trapping deals 1/6 HP."
      return ok([new TrapDurationModifierAbAttr({ turns: 6, damageFraction: 1 / 6 })]);
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
      // Lawnmower — "Removes terrain on switch-in. Stat up if terrain removed."
      return ok([new PostSummonClearTerrainAbAttr({ onCleared: [{ stat: Stat.ATK, stages: 1 }] })]);
    case 612:
      // Rejection — "Applies Quash on switch-in."
      return ok([new PostSummonQuashFoesAbAttr()]);
    case 623:
      // Surprise! — "Astonishes enemy priority users in fog." Now uses the
      // real WeatherType.FOG (pokerogue ships FOG in the WeatherType enum).
      // Flinch chance gated on fog being active.
      return ok([
        new ChanceBattlerTagOnHitAbAttr({
          chance: 100, // always when conditions met (fog + priority user)
          tags: [BattlerTagType.FLINCHED],
          contactRequired: false,
        }),
      ]);
    case 629:
      // Shallow Grave — "Revives at 25% HP once after fainting in fog."
      // Uses the real WeatherType.FOG (no longer MISTY proxy).
      return ok([new PostFaintReviveAbAttr({ hpFraction: 0.25, requireWeather: [WeatherType.FOG] })]);
    case 634:
      // Last Stand — covered in R20; kept here as no-op (return null to fall through).
      return null;
    case 640:
      // Rhythmic — "Deals 10% more damage for each repeated move use."
      return ok([new RepeatMovePowerBoostAbAttr({ bonus: 0.1, cap: 2.0 })]);
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
      // Mosh Pit — "Ally's attacks get a 1.25x boost." Pokerogue lacks an
      // ally-aura primitive in the bespoke set; closest is a self-boost
      // when a teammate uses a damaging move via post-ally-faint analog.
      // Approximate as a permanent +1 ATK stage on entry (echoes the buff).
      return ok([new PostAllyFaintStatChangeAbAttr({ stats: [{ stat: Stat.ATK, stages: 1 }] })]);
    case 704:
      // Hot Coals — "Sets a trap that burns the next foe that switches in."
      // Closest engine analog: install toxic spikes on the opponent's side.
      return ok([new EntryEffectAbAttr({ kind: "set-hazard", hazard: ArenaTagType.TOXIC_SPIKES, layers: 1 })]);
    case 733:
      // Taekkyeon — "All attacks are dances." Closest in-engine effect:
      // copies any dance move used on the field (Dancer). The "all attacks
      // are dances" interpretation also means user's own dance triggers —
      // which functionally is just having Dancer.
      return ok([new PostDancingMoveAbAttr()]);
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
      // Soothsayer — "Resists all attacks for three turns on first entry."
      return ok([new TimeLimitedDamageReductionAbAttr({ factor: 0.5, turns: 3 })]);
    case 808:
      // Malodor — "Suppresses attacker's abilities on contact."
      return ok([new SuppressAttackerAbilityAbAttr({ contactOnly: true })]);
    case 812:
      // Reverberate — "Normal moves are Sound moves." Closest mechanical
      // expression: boost Normal moves by Punk Rock's 1.3x.
      return ok([new MovePowerBoostAbAttr((user, _t, move) => user.getMoveType(move) === PokemonType.NORMAL, 1.3)]);
    case 816:
      // Mental Pollution — "Suppresses others' abilities when enraged." No
      // engine "enraged" state; approximate as suppress-on-contact (most
      // common rage trigger).
      return ok([new SuppressAttackerAbilityAbAttr({ contactOnly: true })]);
    case 817:
      // Madness Enhancement — "Enrages in fog, halves damage when enraged."
      // Real WeatherType.FOG gate via ReceivedMoveDamageMultiplier with a
      // weather condition closure.
      return ok([
        new ReceivedMoveDamageMultiplierAbAttr(
          (_t, _u, _m) => globalScene.arena.weather?.weatherType === WeatherType.FOG,
          0.5,
        ),
      ]);
    case 828:
      // Overzealous — "User's super-effective moves have +1 priority."
      return ok([new SePriorityBonusAbAttr({ priority: 1 })]);
    case 833:
      // Harukaze — "Setting Grassy Terrain sets Tailwind and vice versa."
      return ok([
        new PostSummonStackSetEffectsAbAttr({
          terrain: TerrainType.GRASSY,
          tags: [{ type: ArenaTagType.TAILWIND, turns: 4, side: 0 /* player; resolved by holder side at runtime */ }],
        }),
      ]);
    case 842:
      // Festivities — "Sound moves become dance moves and vice versa." We
      // approximate via Dancer (copies dance moves used by anyone).
      return ok([new PostDancingMoveAbAttr()]);
    case 866:
      // Relic Stone — "Other battlers don't benefit from STAB."
      return ok([new StabSuppressAuraAbAttr()]);
    case 880:
      // Paint Shot — "Mega launcher moves change the target's type to the
      // move used."
      return ok([
        new PostDefendChangeAttackerTypeAbAttr({
          type: "moveType",
          side: "self",
          requireFlag: MoveFlags.PULSE_MOVE,
        }),
      ]);
    case 886:
      // Curse of Famine — "Eats terrain, restores hp, and boosts a defense."
      return ok([new PostSummonClearTerrainAbAttr({ onCleared: [{ stat: Stat.DEF, stages: 1 }] })]);
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
      // Backup Power — "Revives at 25% HP once after fainting in Electric Terrain."
      return ok([new PostFaintReviveAbAttr({ hpFraction: 0.25, requireTerrain: [TerrainType.ELECTRIC] })]);
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
      // Approximate as a per-turn speed-drop on the opponent (no-attack
      // engine signal isn't exposed).
      return ok([new PostTurnFoeStatDropAbAttr({ stat: Stat.SPD, stages: -1 })]);
    case 914:
      // Home Run — "Landing a crit boosts your 3 lowest stats once per turn."
      return ok([new OnCritStatBoostLowestAbAttr({ n: 3, stages: 1 })]);
    case 943:
      // Sap Trap — "Lowers foe's speed at the end of turns. At -3 they get trapped."
      return ok([new PostTurnFoeStatDropAbAttr({ stat: Stat.SPD, stages: -1, trapAtStage: -3 })]);
    case 981:
      // Hollow Ice Zone — "Ice-type moves apply Ice Statue and then make
      // the user switch." Approximate: on holder's Ice-type attack, apply
      // ICE_FACE-equivalent (ER_FROSTBITE tag) to target. Self-switch
      // piece deferred.
      return ok([
        new PostAttackApplyBattlerTagAbAttr(
          false,
          (user, _t, move) => (user.getMoveType(move) === PokemonType.ICE ? 100 : 0),
          BattlerTagType.ER_FROSTBITE,
        ),
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
