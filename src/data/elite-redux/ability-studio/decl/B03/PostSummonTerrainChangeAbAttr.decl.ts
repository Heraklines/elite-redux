/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// B03 chunk 3. Tier A, event-effect on entry, no closure. Same shape as the golden precedent
// PostSummonWeatherChangeAbAttr (`decl/precedents`).
//
//   canApply   `arena.canSetTerrain(terrainType)` ("the terrain can be set": effect-side feasibility)
//   apply      unless simulated: `arena.trySetTerrain(terrainType, false, holder)`
//
// One constructor argument, one param. The class is also extended by two private ER subclasses (`ErTerrainSummonAbAttr`
// in init-elite-redux-vanilla-rebalance.ts adds an 8-turn patch, `SetTerrainOnEntryAbAttr` in an archetype); they are
// separate classes with their own declaration, not covered here.
import { PostSummonTerrainChangeAbAttr } from "#abilities/ab-attrs";
import { defineDecl } from "#data/elite-redux/ability-studio/define-decl";
import { enumCodec, enumOptions } from "#data/elite-redux/ability-studio/param-codecs";
import { TerrainType } from "#data/terrain";

export default defineDecl(PostSummonTerrainChangeAbAttr, {
  tier: "A",
  kind: "event-effect",
  when: "event.on-entry",
  label: "Set the terrain when I enter",
  summary: params =>
    `When I enter the battle, the terrain becomes ${params.terrain}. Example: Electric Surge sets Electric Terrain; choosing None clears the terrain.`,
  synonyms: [
    "electric surge",
    "grassy surge",
    "misty surge",
    "psychic surge",
    "summon terrain",
    "terrain setter",
    "clear terrain",
  ],
  examples: ["Set Electric Terrain when I enter the battle", "Clear any terrain when I enter the battle"],
  params: [
    {
      id: "terrain",
      ctorIndex: 0,
      path: "terrainType",
      control: "select",
      label: "Terrain (None clears the current terrain)",
      editable: true,
      default: "ELECTRIC",
      options: enumOptions(TerrainType),
      codec: enumCodec(TerrainType, "terrain"),
    },
  ],
  conditions: [],
  guards: [],
  feasibility: ["The terrain must be settable: it is not already the same terrain", "It does nothing in a preview"],
  effect: { id: "effect.set-terrain", params: ["terrain"] },
  reusableAlone: { when: true, if: true, do: true },
  flags: { rng: "none", state: "none", simulated: "respects" },
  probes: [{ name: "entry with the default field", axes: {} }],
  status: "decomposed",
  notes:
    "Tier A, 4 attrs of 4 abilities, no closure, exactly this class (not the ER subclasses): Electric Surge (226 attr 0, Electric), Teraform Zero (309 attr 1, None: clears the terrain), Reap and Sow (6054, Grassy) and Surges Up (6061, Electric). Psychic, Misty and Grassy Surge, Hadron Engine and Psychic Supremacy (20000 attr 2) are `ErTerrainSummonAbAttr` instances (8-turn patch) and belong to that class. Electric Surge is NOT patched to 8 turns in init-elite-redux-vanilla-rebalance.ts (the other three vanilla surges are), recorded as a suspected game inconsistency, not fixed. `canApply` is `arena.canSetTerrain`, which is feasibility (true when the stored terrain differs from the requested one), so it stays in the class. `trySetTerrain` can still refuse inside `apply` (a protected Toxic Terrain is not overwritten by an ordinary one), which is effect-side.",
});
