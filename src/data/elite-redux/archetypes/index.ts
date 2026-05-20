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
export type { EntryEffect, EntryEffectKind } from "./entry-effect";
// biome-ignore lint/performance/noBarrelFile: see above
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
// biome-ignore lint/performance/noBarrelFile: see above
export { FlagDamageBoostAbAttr, type FlagDamageBoostAbAttrOptions } from "./flag-damage-boost";
// biome-ignore lint/performance/noBarrelFile: see above
export { TypeDamageBoostAbAttr, type TypeDamageBoostAbAttrOptions } from "./type-damage-boost";
