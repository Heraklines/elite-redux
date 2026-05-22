/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Elite Redux — Phase D bespoke abilities: barrel export.
//
// Hand-written `AbAttr` implementations for ER abilities that don't fit any
// archetype primitive shape. Grouped by mechanic (one file per cluster of
// similar abilities — see filenames). Each file's classes are wired into
// `archetype-dispatcher.ts`'s `dispatchBespoke()` per ER ability id.
//
// New bespoke clusters: add a file, re-export from here, dispatch in the
// `dispatchBespoke` function in `archetype-dispatcher.ts`.
// =============================================================================

// biome-ignore lint/performance/noBarrelFile: bespoke layer intentionally barrels for symmetry with archetype layer; small module set
export {
  PostTurnHurtNonTypedAbAttr,
  type PostTurnHurtNonTypedOptions,
} from "./post-turn-hurt-non-typed";
export {
  SetArenaTagOnHitAbAttr,
  type SetArenaTagOnHitOptions,
  SetTerrainOnHitAbAttr,
  type SetTerrainOnHitOptions,
} from "./set-arena-effect-on-hit";
export {
  StatBoostOnFlagAttackAbAttr,
  type StatBoostOnFlagAttackOptions,
} from "./stat-boost-on-flag-attack";
