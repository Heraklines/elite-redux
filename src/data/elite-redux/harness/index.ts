/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Elite Redux — Phase C Task C0: harness barrel export.
//
// Import surface for the battle harness:
//
//   ```ts
//   import {
//     runHarness,
//     entryScenario,
//     triplePassiveScenario,
//   } from "#data/elite-redux/harness";
//   ```
//
// Re-exports the runtime APIs and types from `battle-harness.ts` and the
// scenario factory functions from `scenarios.ts`.
// =============================================================================

// biome-ignore lint/performance/noBarrelFile: harness is intentionally a barrel for Phase C tests; small module set, negligible perf impact
export type {
  AbilityFired,
  AbilitySlot,
  AttrCall,
  HarnessPokemon,
  HarnessPokemonSpec,
  HarnessResult,
  HarnessSpec,
  HarnessTrigger,
} from "./battle-harness";
// biome-ignore lint/performance/noBarrelFile: see above
export { attrCallsByType, firedForRole, makeHarnessPokemon, runHarness } from "./battle-harness";
// biome-ignore lint/performance/noBarrelFile: see above
export {
  betweenTurnsScenario,
  entryScenario,
  entryWithOpponentScenario,
  pokemonSpec,
  postBattleInitScenario,
  postFaintScenario,
  statStageChangeScenario,
  suppressedActiveScenario,
  triplePassiveScenario,
} from "./scenarios";
