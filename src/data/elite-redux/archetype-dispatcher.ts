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

import { type AbAttr, BlockRecoilDamageAttr, PostDefendContactDamageAbAttr } from "#abilities/ab-attrs";
import { allAbilities } from "#data/data-lists";
import { PostTurnHurtNonTypedAbAttr } from "#data/elite-redux/abilities/post-turn-hurt-non-typed";
import { SetArenaTagOnHitAbAttr, SetTerrainOnHitAbAttr } from "#data/elite-redux/abilities/set-arena-effect-on-hit";
import { StatBoostOnFlagAttackAbAttr } from "#data/elite-redux/abilities/stat-boost-on-flag-attack";
import { StatDebuffOnFlagAttackAbAttr } from "#data/elite-redux/abilities/stat-debuff-on-flag-attack";
import {
  ChanceBattlerTagOnHitAbAttr,
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
import { PassiveRecoveryAbAttr, type PassiveRecoveryCondition } from "#data/elite-redux/archetypes/passive-recovery";
import {
  type PriorityCondition,
  PriorityModifierAbAttr,
  type PriorityModifierFilter,
} from "#data/elite-redux/archetypes/priority-modifier";
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
 * (CONFUSION, INFATUATION, FLINCH, DISABLE, TAUNT) to their {@linkcode
 * BattlerTagType} value. Returns `null` for inputs that aren't battler-tag
 * concepts — those flow to `lookupStatusEffect` (vanilla StatusEffect) or
 * skip entirely (ER-specific BLEED, FROSTBITE, FEAR).
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
    default:
      return null;
  }
}

/** Dispatch a `chance-status-on-hit` classifier row. */
function dispatchChanceStatusOnHit(params: Record<string, unknown>): DispatchResult {
  const chance = params.chance;
  if (typeof chance !== "number" || chance < 0 || chance > 100) {
    return skip("chance-status-on-hit: missing/invalid chance");
  }
  // Prefer the vanilla StatusEffect path first; only fall back to the
  // battler-tag flavor when the status string is a tag concept (CONFUSION,
  // INFATUATION, FLINCH, DISABLE). The skip path remains for ER-specific
  // entries (BLEED, FROSTBITE, FEAR) that aren't in either vocabulary.
  const status = lookupStatusEffect(params.status);
  const contactRequired = params.onContactOnly;
  const contactOpt = typeof contactRequired === "boolean" ? { contactRequired } : {};
  if (status !== null) {
    return ok([
      new ChanceStatusOnHitAbAttr({
        chance,
        effects: [status],
        ...contactOpt,
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
    default:
      return SKIP_BESPOKE;
  }
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
