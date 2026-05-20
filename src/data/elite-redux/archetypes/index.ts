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
  TypeAbsorbHealAbAttr,
  type TypeAbsorbHealOptions,
  TypeAbsorbStatBoostAbAttr,
  type TypeAbsorbStatBoostOptions,
} from "./immunity-with-absorb";
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
  type PriorityCondition,
  PriorityModifierAbAttr,
  type PriorityModifierFilter,
  type PriorityModifierOptions,
} from "./priority-modifier";
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
export { TypeDamageBoostAbAttr, type TypeDamageBoostAbAttrOptions } from "./type-damage-boost";
