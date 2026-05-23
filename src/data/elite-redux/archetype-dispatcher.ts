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
  BlockRecoilDamageAttr,
  PostDefendContactDamageAbAttr,
  PostReceiveCritStatStageChangeAbAttr,
  ProtectStatAbAttr,
  StatMultiplierAbAttr,
  UserFieldMoveTypePowerBoostAbAttr,
} from "#abilities/ab-attrs";
import { globalScene } from "#app/global-scene";
import { allAbilities } from "#data/data-lists";
import { PostTurnHurtNonTypedAbAttr } from "#data/elite-redux/abilities/post-turn-hurt-non-typed";
import { PpReductionOnContactAbAttr } from "#data/elite-redux/abilities/pp-reduction-on-contact";
import { SetArenaTagOnHitAbAttr, SetTerrainOnHitAbAttr } from "#data/elite-redux/abilities/set-arena-effect-on-hit";
import { StatBoostOnFlagAttackAbAttr } from "#data/elite-redux/abilities/stat-boost-on-flag-attack";
import { StatChangeOnCategoryAttackAbAttr } from "#data/elite-redux/abilities/stat-change-on-category-attack";
import { StatDebuffOnFlagAttackAbAttr } from "#data/elite-redux/abilities/stat-debuff-on-flag-attack";
import {
  ChanceBattlerTagOnHitAbAttr,
  type ChanceStatusFilter,
  ChanceStatusOnHitAbAttr,
} from "#data/elite-redux/archetypes/chance-status-on-hit";
import { ConditionalDamageAbAttr, type DamageCondition } from "#data/elite-redux/archetypes/conditional-damage";
import {
  CritDamageMultiplierAbAttr,
  CritImmunityAbAttr,
  CritStageBonusAbAttr,
} from "#data/elite-redux/archetypes/crit-mod";
import {
  DamageReductionAbAttr,
  type DamageReductionFilter,
} from "#data/elite-redux/archetypes/damage-reduction-generic";
import { type EntryEffect, EntryEffectAbAttr } from "#data/elite-redux/archetypes/entry-effect";
import { FlagDamageBoostAbAttr } from "#data/elite-redux/archetypes/flag-damage-boost";
import { HitMultiplierAbAttr, HitMultiplierPowerAbAttr } from "#data/elite-redux/archetypes/hit-multiplier";
import { TypeAbsorbHealAbAttr, TypeAbsorbStatBoostAbAttr } from "#data/elite-redux/archetypes/immunity-with-absorb";
import { LifestealOnHitAbAttr, LifestealOnKoAbAttr } from "#data/elite-redux/archetypes/lifesteal";
import { OnFaintEffectAbAttr } from "#data/elite-redux/archetypes/on-faint-effect";
import { PostAllyFaintStatChangeAbAttr } from "#data/elite-redux/archetypes/post-ally-faint";
import { CounterAttackOnHitAbAttr } from "#data/elite-redux/archetypes/counter-attack-on-hit";
import { SpeedBonusToStatAbAttr } from "#data/elite-redux/archetypes/speed-bonus-to-stat";
import { PassiveRecoveryAbAttr, type PassiveRecoveryCondition } from "#data/elite-redux/archetypes/passive-recovery";
import { PreFaintReviveAbAttr } from "#data/elite-redux/archetypes/pre-faint-revive";
import {
  type PriorityCondition,
  PriorityModifierAbAttr,
  type PriorityModifierFilter,
} from "#data/elite-redux/archetypes/priority-modifier";
import { StabAddAbAttr } from "#data/elite-redux/archetypes/stab-add";
import {
  type StatChange,
  StatTriggerOnEntryAbAttr,
  StatTriggerOnHitAbAttr,
  StatTriggerOnKoAbAttr,
  StatTriggerOnStatLoweredAbAttr,
} from "#data/elite-redux/archetypes/stat-trigger-on-event";
import {
  BattlerTagImmunityAbAttrEr,
  IntimidateImmunityAbAttrEr,
  StatusEffectImmunityAbAttrEr,
} from "#data/elite-redux/archetypes/status-immunity";
import { TypeConversionAbAttr, TypeConversionPowerBoostAbAttr } from "#data/elite-redux/archetypes/type-conversion";
import { TypeDamageBoostAbAttr } from "#data/elite-redux/archetypes/type-damage-boost";
import { buildTypeEffectivenessModAttrs } from "#data/elite-redux/archetypes/type-effectiveness-mod";
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
 * Dispatch a `type-damage-boost` classifier row. Optional `recoilPct` is
 * intentionally ignored — recoil is a separate effect that would need a
 * sibling AbAttr; the classifier emits it as a hint but the archetype layer
 * doesn't yet handle it. The damage boost still wires.
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
  return ok([
    new TypeDamageBoostAbAttr({
      type,
      multiplier,
      ...(typeof lowHpMultiplier === "number" ? { lowHpMultiplier } : {}),
      ...(typeof lowHpThreshold === "number" ? { lowHpThreshold } : {}),
    }),
  ]);
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
    const flag = ER_CLASSIFIER_FLAG_TO_MOVE_FLAG[value.flag];
    if (flag === undefined || flag === null) {
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

/** Dispatch a `chance-status-on-hit` classifier row. */
function dispatchChanceStatusOnHit(params: Record<string, unknown>): DispatchResult {
  const chance = params.chance;
  if (typeof chance !== "number" || chance < 0 || chance > 100) {
    return skip("chance-status-on-hit: missing/invalid chance");
  }
  // Prefer the vanilla StatusEffect path first; only fall back to the
  // battler-tag flavor when the status string is a tag concept (CONFUSION,
  // INFATUATION, FLINCH, DISABLE) or an ER-specific one (BLEED, FROSTBITE,
  // FEAR) routed through `lookupBattlerTagFromStatus`.
  const status = lookupStatusEffect(params.status);
  const contactRequired = params.onContactOnly;
  const contactOpt = typeof contactRequired === "boolean" ? { contactRequired } : {};
  const filter = lookupChanceStatusFilter(params.filter);
  if (filter === null) {
    return skip(`chance-status-on-hit: unparseable filter ${JSON.stringify(params.filter)}`);
  }
  const filterOpt = filter === undefined ? {} : { filter };
  if (status !== null) {
    return ok([
      new ChanceStatusOnHitAbAttr({
        chance,
        effects: [status],
        ...contactOpt,
        ...filterOpt,
      }),
    ]);
  }
  const tag = lookupBattlerTagFromStatus(params.status);
  if (tag !== null) {
    return ok([
      new ChanceBattlerTagOnHitAbAttr({
        chance,
        tags: [tag],
        ...contactOpt,
        ...filterOpt,
      }),
    ]);
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
  if (entry === undefined) {
    return skip(
      `composite-vanilla-mashup: no resolved-parts entry for er ability ${erAbilityId} (run er:classify-composites)`,
    );
  }
  if (entry.parts.length === 0) {
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
function dispatchBespoke(erAbilityId: number): DispatchResult {
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
      // Winter Throne — non-Ice foes take 1/8 dmg every turn. The "heals
      // self-Ice 1/8 each turn" piece is deferred — partial wire. (A second
      // `PassiveRecoveryAbAttr` could compose with this, but it'd fire for
      // every owner regardless of type; gating heal-on-self-type requires a
      // new condition kind.)
      return ok([
        new PostTurnHurtNonTypedAbAttr({
          safeTypes: [PokemonType.ICE],
          damageFraction: 1 / 8,
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
      // Coward — sets up Protect on switch-in (once per ability evaluation).
      // The `scripted-move` sub-effect is a configuration-only stub today: the
      // dispatcher records the wiring and the full per-turn Protect injection
      // is deferred to the later C-phase turn-queue integration. Partial wire.
      return ok([new EntryEffectAbAttr({ kind: "scripted-move", move: MoveId.PROTECT })]);
    case 431:
      // Dune Terror — sand reduces incoming damage by 35%. The "+20% Ground
      // moves" piece composes via `WeatherTypeBoostAbAttr` but isn't wired
      // here yet — partial wire. Multiplier is `1 - 0.35 = 0.65`.
      return ok([
        new WeatherDamageReductionAbAttr({
          weathers: [WeatherType.SANDSTORM],
          multiplier: 0.65,
        }),
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
      // Terastal Treasure — takes 40% less damage from all moves. The "-20%
      // Speed" tradeoff composes via a stat-multiplier primitive that doesn't
      // exist yet — partial wire.
      return ok([
        new DamageReductionAbAttr({
          reduction: 0.4,
          filter: { kind: "all" },
        }),
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
      // Hyper Cleanse — "Immune to status. Halves poison damage taken." Same
      // empty-list block-all pattern as Blood Stigma for the immunity piece.
      // The "halves poison damage" piece would compose via a type-keyed
      // DamageReduction (POISON), but the current filter union doesn't carry a
      // `type` variant; deferred. Partial wire.
      return ok([new StatusEffectImmunityAbAttrEr({ statuses: [] })]);
    case 1004:
      // Feathercoat — "Takes 10% less damage from attacks, 20% if resisted."
      // Wire the flat 10% reduction via DamageReductionAbAttr({all}). The
      // "20% if resisted" piece would need a new filter kind (not-very-
      // effective resist gate) — deferred. Partial wire.
      return ok([new DamageReductionAbAttr({ reduction: 0.1, filter: { kind: "all" } })]);
    case 944:
      // Dead Bark — "Adds Ghost type. Takes 15% less damage. 30% less damage
      // if SE." Round 12: extended from damage-only to also include the
      // entry-effect "add Ghost type" piece via the existing
      // `EntryEffectAbAttr({ kind: "add-self-type" })` primitive. The "30% if
      // SE" piece would need a stacked DamageReduction with a super-effective
      // override (existing super-effective filter would compose as a flat 30%
      // reduction but multiplying with the 15% all-moves piece would yield an
      // incorrect total); deferred. Partial wire.
      return ok([
        new EntryEffectAbAttr({ kind: "add-self-type", type: PokemonType.GHOST }),
        new DamageReductionAbAttr({ reduction: 0.15, filter: { kind: "all" } }),
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
      // Wire the all-moves StabAdd. The "+10% super-effective" piece is a
      // type-effectiveness override (super-effective multiplier rider) —
      // no archetype primitive exists for that yet; deferred. Partial wire.
      return ok([new StabAddAbAttr()]);
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
      // Deep Freeze — "Boosts Water and Ice by 1.25x. Halves Fire damage
      // taken." Wire all three pieces: two TypeDamageBoost (WATER, ICE)
      // and a DamageReduction(FIRE) — but the damage-reduction filter union
      // doesn't carry a `type` variant today, so the Fire half-damage piece
      // composes via the kind:"all" filter at 0.5 only when paired with a
      // type-keyed gate, which we lack. Partial wire — emit only the offense
      // boost.
      return ok([
        new TypeDamageBoostAbAttr({ type: PokemonType.WATER, multiplier: 1.25 }),
        new TypeDamageBoostAbAttr({ type: PokemonType.ICE, multiplier: 1.25 }),
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
      // Wire the entry-effect side via EntryEffectAbAttr (set-screen-or-room
      // AURORA_VEIL, 3 turns). The "immune to Hail damage" piece would compose
      // via a weather-status-immunity primitive that doesn't exist yet
      // (Ice-types are already hail-immune via the base type immunity, so this
      // matters only for non-Ice holders of the ability). Partial wire.
      return ok([new EntryEffectAbAttr({ kind: "set-screen-or-room", tag: ArenaTagType.AURORA_VEIL, turns: 3 })]);
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
    case 627:
      // Ethereal Rush — "This Pokémon's Speed gets a 1.5x boost in fog." Uses
      // the round-7 weather-stat-multiplier primitive — Stat.SPD * 1.5 gated
      // on WeatherType.FOG.
      return ok([
        new WeatherStatMultiplierAbAttr({
          stat: Stat.SPD,
          multiplier: 1.5,
          weathers: [WeatherType.FOG],
        }),
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
      // Sage Power — "Ups Special Attack by 50% and locks move." Wire the
      // SpAtk x1.5 piece via StatMultiplierAbAttr. The "locks move" piece
      // (Gorilla Tactics-style move-lock) composes via vanilla
      // `GorillaTacticsAbAttr` but the lock semantics are not exactly the same
      // — ER's text doesn't specify the lock-on-first-attack vs lock-globally
      // distinction. Defer for clarity. Partial wire.
      return ok([new StatMultiplierAbAttr(Stat.SPATK, 1.5)]);
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
      return ok([
        new ChanceStatusOnHitAbAttr({ chance: 30, effects: [StatusEffect.BURN], contactRequired: false }),
      ]);
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
      return ok([
        new ChanceBattlerTagOnHitAbAttr({ chance: 30, tags: [BattlerTagType.ER_FEAR] }),
      ]);
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
      return ok([
        new CritStageBonusAbAttr({ bonus: 1 }),
      ]);
    case 671:
      // Bad Omen — "Foes min roll. Takes 1/4 damage from crits."
      // DamageReductionFilter doesn't yet have a "crit-received" kind, and
      // the min-damage-roll piece needs a damage-roll-override primitive.
      // Defer both pieces — add to next-primitive backlog.
      return SKIP_BESPOKE;
    case 482:
      // Sand Guard — "Blocks priority and reduces special damage by 1/2 in sand."
      // Filter "category-in-weather" not yet supported by DamageReductionFilter.
      // Defer — needs filter-kind extension.
      return SKIP_BESPOKE;
    case 585:
      // Sun Basking — "Blocks priority and reduces physical damage by 1/2 in sun."
      // Same filter limitation as Sand Guard. Defer.
      return SKIP_BESPOKE;
    case 837:
      // Chokehold — "Binding moves lower speed and paralyze." The "binding
      // moves" filter would require move-attr inspection (vanilla pokerogue
      // doesn't have a BIND flag in MoveFlags). Wire the stat-drop on any hit
      // as approximation; the binding-only gate deferred.
      return ok([
        new StatTriggerOnHitAbAttr({ stats: [{ stat: Stat.SPD, stages: -1 }] }),
      ]);
    case 730:
      // Razor Sharp — "Critical hits also inflict bleeding." On-deal-crit
      // hook not yet primitive; wire a 20% ER_BLEED on any hit as approximation.
      return ok([
        new ChanceBattlerTagOnHitAbAttr({ chance: 20, tags: [BattlerTagType.ER_BLEED] }),
      ]);
    case 953:
      // Hypnotic Trance — "Hypnosis never misses and also causes Confusion."
      // The "Hypnosis never misses" piece needs a per-move accuracy override.
      // Wire only the confusion piece (any sleep-move hit also confuses) —
      // sleep-detect via status-cascade primitive deferred.
      return ok([
        new ChanceBattlerTagOnHitAbAttr({ chance: 100, tags: [BattlerTagType.CONFUSED] }),
      ]);
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
      return ok([
        new BattlerTagImmunityAbAttrEr({ tags: [BattlerTagType.CONFUSED] }),
      ]);
    case 398:
      // Fungal Infection — "Contact moves inflict Leech Seed on the target."
      return ok([
        new ChanceBattlerTagOnHitAbAttr({ chance: 100, tags: [BattlerTagType.SEEDED] }),
      ]);
    case 426:
      // Clueless — "Negates Weather, Rooms and Terrains." Cloud-Nine-style
      // weather suppression. Vanilla SuppressWeatherEffectAbAttr is not
      // exported via the dispatcher import surface yet — defer until the
      // import surface is extended.
      return SKIP_BESPOKE;
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
      return ok([
        new BattlerTagImmunityAbAttrEr({ tags: [BattlerTagType.CONFUSED] }),
      ]);
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
    case 369:
      // Bad Company — "Not implemented right now. Has no effect." Genuinely
      // no-op per ER source. Empty wire.
      return ok([]);
    // -------------------------------------------------------------------------
    // Round 15 — flag-damage-boost cluster (the "X moves become special and
    // deal 30% more damage" family). Each wires the 1.3x flag boost; the
    // category-swap (physical → special) is deferred pending a new primitive.
    // -------------------------------------------------------------------------
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
    case 599:
      // (Dead Power was wired in round 12 already — sentinel to keep
      // ordering consistent with the inventory.)
      return SKIP_BESPOKE;
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
    case 564:
      // Tactical Retreat — "Flees when stats are lowered." Switch-on-stat-
      // lowered needs a new event-trigger primitive (PostStatStageChange).
      // Defer.
      return SKIP_BESPOKE;
    case 555:
      // Egoist — "Raises its own stats when foes raise theirs." Needs an
      // observer hook on opponent stat-change events. Defer.
      return SKIP_BESPOKE;
    case 588:
      // Iron Serpent — "Ups super-effective by 33%." Defensive-side
      // super-effective multiplier change. Vanilla SolidRock-like attrs
      // exist but invert direction. Defer until super-effective-mod primitive.
      return SKIP_BESPOKE;
    case 586:
      // Winged King — same shape as Iron Serpent. Defer.
      return SKIP_BESPOKE;
    case 634:
      // Last Stand — "Def and SpDef increase as HP drops. Max 1.6x." Needs
      // HP-curve stat-multiplier primitive. Defer.
      return SKIP_BESPOKE;
    // -------------------------------------------------------------------------
    // Round 16 — more compositions in the flag-boost / chance-status / proc clusters.
    // -------------------------------------------------------------------------
    case 687:
      // Vitality Strike — "Heals for 10% of the damage dealt by punching moves."
      return ok([
        new LifestealOnHitAbAttr({ healFraction: 0.1, filter: { flag: MoveFlags.PUNCHING_MOVE } }),
      ]);
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
      return ok([
        new ChanceBattlerTagOnHitAbAttr({ chance: 20, tags: [BattlerTagType.FLINCHED] }),
      ]);
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
    case 884:
      // Locust Swarm — "Changes into Hivemind form until 1/4 HP or less."
      // HP-threshold form change. Form-change-on-hp-threshold needs a new
      // primitive bridging into pokemonFormChanges. Defer.
      return SKIP_BESPOKE;
    case 885:
      // Revelation — same shape as 884 Locust Swarm. Defer.
      return SKIP_BESPOKE;
    case 1005:
      // Power Outage — "Boosts first Electric attack by 2x then loses
      // Electric type." First-use + type-loss combo. Defer (needs uses-
      // counter primitive + type-remove on-use).
      return SKIP_BESPOKE;
    case 1008:
      // Daredevil — "+1 Atk after using recoil move. 1/2 recoil damage."
      // Recoil-event hook missing. Defer.
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
    case 937:
      // Sumo Wrestler — "Uses 20BP Circle Throw at the end of each 2nd
      // turn." Turn-counter scripted-move. Defer.
      return SKIP_BESPOKE;
    case 940:
      // Cool Exit — "Uses Chilly Reception at the end of your 2nd turn."
      // Same shape as 937. Defer.
      return SKIP_BESPOKE;
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
      return ok([
        new ChanceBattlerTagOnHitAbAttr({ chance: 100, tags: [BattlerTagType.INFESTATION] }),
      ]);
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
      const halfHpGate = (pokemon: { hp: number; getMaxHp(): number }) =>
        pokemon.hp / pokemon.getMaxHp() <= 0.5;
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
      const halfHpGate = (pokemon: { hp: number; getMaxHp(): number }) =>
        pokemon.hp / pokemon.getMaxHp() <= 0.5;
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
    case 1030:
      // Sleek Scales — "Uses +15% of its Speed when defending."
      // Defensive variant: bonus to DEF + SPDEF.
      return ok([
        new SpeedBonusToStatAbAttr({ stat: Stat.DEF, speedFraction: 0.15 }),
        new SpeedBonusToStatAbAttr({ stat: Stat.SPDEF, speedFraction: 0.15 }),
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
